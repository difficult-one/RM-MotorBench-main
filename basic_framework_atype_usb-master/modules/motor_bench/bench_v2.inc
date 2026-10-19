/* Private protocol extension. Included once after the legacy transport helpers. */
static uint32_t mb_v2_session, mb_v2_sequence;
static uint32_t mb_v2_nonce, mb_retired_sessions[8];
static uint8_t mb_retired_next;
static MB_SessionRandom_t mb_session_random;
void MotorBenchSetSessionRandom(MB_SessionRandom_t random){mb_session_random=random;}
static struct {
    uint8_t state, channel, mode;
    uint32_t id, started, baseline, phase, tail, duration;
    float amplitude;
} mb_test = {.channel = 255};

static uint32_t V2Read32(const uint8_t *b) { uint32_t v; memcpy(&v,b,4); return v; }
static void V2Write32(uint8_t *b, uint32_t v) { memcpy(b,&v,4); }
static void MotorBenchV2SendStatus(void) {
    uint8_t b[23] = {0};V2Write32(b,mb_v2_session);V2Write32(b+4,HAL_GetTick());
    b[8]=mb_stop_reason;b[9]=mb_test.state;b[10]=mb_test.channel;
    V2Write32(b+11,mb_test.id);V2Write32(b+15,mb_test.started);V2Write32(b+19,mb_test.duration);
    MotorBenchSendTypedFrame(MB_FRAME_BOARD_STATUS,b,sizeof(b));
}
static void MotorBenchV2Reset(void) {
    mb_v2_session=mb_v2_sequence=mb_v2_nonce=0;mb_stop_reason=0;
    memset(&mb_test,0,sizeof(mb_test));mb_test.channel=255;
}
static void MotorBenchV2StopNotice(uint8_t reason) {
    mb_stop_reason=reason;if(mb_test.state==1)mb_test.state=4;
}
static void MotorBenchV2LinkReset(uint8_t reason) {
    MotorBenchStopAllReason(reason);mb_v2_session=mb_v2_sequence=mb_v2_nonce=0;
}
static void V2Finish(uint8_t state,uint8_t reason) {
    mb_test.state=state;MotorBenchStopAllReason(reason);
}
static void MotorBenchV2TickAt(uint32_t now) {
    if(mb_test.state!=1)return;
    MB_TelemetryItem_s m;
    if(!mb_link_online){V2Finish(4,2);return;}
    if(mb_control.source){V2Finish(4,5);return;}
    if(MotorBenchGetMeasure(mb_test.channel,&m)!=MB_OK||!(m.status&1)){V2Finish(4,4);return;}
    if(!(m.status&2)){V2Finish(4,6);return;}
    uint32_t elapsed=now-mb_test.started;
    if(elapsed>=mb_test.duration){V2Finish(2,7);return;}
    float ref=0;
    if(elapsed>=mb_test.baseline){
        uint32_t t=elapsed-mb_test.baseline;
        if(mb_test.mode==0){if(t<mb_test.phase)ref=mb_test.amplitude;}
        else if(mb_test.mode==1){
            if(t<mb_test.phase)ref=mb_test.amplitude*(float)t/(float)mb_test.phase;
            else if(t<2*mb_test.phase)ref=mb_test.amplitude;
        }else{
            if(t<mb_test.phase)ref=mb_test.amplitude;
            else if(t>=mb_test.phase+500&&t<2*mb_test.phase+500)ref=-mb_test.amplitude;
        }
    }
    if(MotorBenchSetRef(mb_test.channel,ref)!=MB_OK)V2Finish(4,6);
}
static void MotorBenchV2Tick(void){MotorBenchV2TickAt(HAL_GetTick());}
static uint8_t V2Start(const uint8_t *b,uint8_t n,uint32_t sequence) {
    if(n!=26||b[8]>=MB_CHANNEL_MAX||b[9]>2)return MB_ERR_BAD_PARAM;
    if(mb_test.state==1||!mb_link_online||mb_control.source)return MB_ERR_NOT_ENABLED;
    MB_MotorChannel_s *ch=&mb_channels[b[8]];
    if(!ch->is_used||ch->outer_loop!=SPEED_LOOP||ch->kind<1||ch->kind>4)return MB_ERR_BAD_PARAM;
    for(int i=0;i<MB_CHANNEL_MAX;i++)if(mb_channels[i].is_used&&mb_channels[i].status_bit_enable)return MB_ERR_NOT_ENABLED;
    MB_TelemetryItem_s m;if(MotorBenchGetMeasure(b[8],&m)!=MB_OK||!(m.status&1))return MB_ERR_NOT_ENABLED;
    float amplitude;memcpy(&amplitude,b+10,4);
    float limit=ch->kind==MB_MOTOR_DM?40.0f:ch->kind==MB_MOTOR_M2006?7000.0f:6000.0f;
    uint32_t baseline=V2Read32(b+14),phase=V2Read32(b+18),tail=V2Read32(b+22);
    if(!isfinite(amplitude)||amplitude<=0||amplitude>limit||baseline<500||baseline>10000||tail<500||tail>10000||phase<200||phase>30000)return MB_ERR_BAD_PARAM;
    uint32_t duration=baseline+phase*(b[9]?2:1)+(b[9]==2?500:0)+tail;
    if(duration>120000)return MB_ERR_BAD_PARAM;
    uint8_t result=MotorBenchSetEnable(b[8],1);if(result!=MB_OK)return result;
    MotorBenchSetRef(b[8],0);mb_test.state=1;mb_test.channel=b[8];mb_test.mode=b[9];mb_test.amplitude=amplitude;
    mb_test.id=sequence;mb_test.started=HAL_GetTick();mb_test.baseline=baseline;mb_test.phase=phase;mb_test.tail=tail;mb_test.duration=duration;
    return MB_OK;
}
static void MotorBenchV2BeforeCommand(uint8_t type) {
    if(mb_test.state!=1)return;
    if(type==MB_FRAME_HEARTBEAT||type==MB_FRAME_QUERY||type==MB_FRAME_INVENTORY_QUERY||type==MB_FRAME_PID_QUERY||(type>=MB_FRAME_HELLO&&type<=MB_FRAME_TEST_CANCEL))return;
    MotorBenchStopAllReason(type==MB_FRAME_ALL_STOP?1:type==MB_FRAME_MOTOR_ENABLE?6:5);
}
#include "bench_stepper.inc"
static uint8_t MotorBenchV2Handle(uint8_t type,const uint8_t *b,uint8_t n) {
    if(PulseHandle(type,b,n))return 1;
    if(type<MB_FRAME_HELLO||type>MB_FRAME_TEST_CANCEL)return 0;
    if(type==MB_FRAME_HELLO){
        if(n!=4||!V2Read32(b))return 1;
        uint32_t nonce=V2Read32(b);
        if(nonce!=mb_v2_nonce||!mb_v2_session){
            MotorBenchStopAllReason(9);mb_v2_session=0;mb_v2_sequence=0;mb_v2_nonce=0;
            for(int attempt=0;attempt<4&&mb_session_random;attempt++){
                uint32_t candidate=0;if(!mb_session_random(&candidate))break;
                uint8_t fresh=candidate!=0;
                for(int i=0;i<8;i++)if(mb_retired_sessions[i]==candidate)fresh=0;
                if(fresh){mb_v2_session=candidate;mb_v2_nonce=nonce;mb_retired_sessions[mb_retired_next++%8]=candidate;break;}
            }
        }
        uint8_t out[18]={2};V2Write32(out+1,mb_v2_session?(15|(StepPulseAvailable()?16:0)):0);V2Write32(out+5,mb_v2_session);V2Write32(out+9,HAL_GetTick());out[13]=MB_CHANNEL_MAX;V2Write32(out+14,nonce);
        MotorBenchSendTypedFrame(MB_FRAME_CAPABILITIES,out,sizeof(out));MotorBenchV2SendStatus();return 1;
    }
    if(n<8)return 1;
    uint32_t sequence=V2Read32(b+4);
    uint8_t result=MB_ERR_BAD_PARAM;
    if(mb_v2_session&&V2Read32(b)==mb_v2_session&&sequence&&sequence>mb_v2_sequence){
        mb_v2_sequence=sequence;
        if(type==MB_FRAME_BIND_V2&&n==13){
            uint8_t valid=b[8]<8&&b[9]>=1&&b[9]<=4&&b[10]>=1&&b[10]<=2&&b[11]>=1&&b[11]<=(b[9]==1?7:b[9]==4?255:8)&&
                (b[9]==4?b[12]==2:(b[12]==0||b[12]==1||b[12]==2||b[12]==4));
            if(valid){
                if(mb_test.state==1)V2Finish(4,5);
                result=mb_link_online?MotorBenchBind(b[8],(MB_MotorKind_e)b[9],b[10],b[11],(Closeloop_Type_e)b[12]):MB_ERR_NOT_ENABLED;
            }
        }else if(type==MB_FRAME_CHANNEL_QUERY&&n==8){
            uint8_t out[9+MB_CHANNEL_MAX*5]={0};V2Write32(out,mb_v2_session);V2Write32(out+4,sequence);
            for(int i=0;i<MB_CHANNEL_MAX;i++)if(mb_channels[i].is_used){
                MB_MotorChannel_s *ch=&mb_channels[i];uint8_t *p=out+9+out[8]*5;
                p[0]=i;p[1]=ch->kind;p[2]=ch->can_bus;p[3]=ch->motor_id;p[4]=ch->outer_loop;out[8]++;
            }
            MotorBenchSendTypedFrame(MB_FRAME_CHANNEL_REPORT,out,9+out[8]*5);return 1;
        }else if(type==MB_FRAME_TEST_START){if(StepPulseSnapshot().enabled)result=MB_ERR_NOT_ENABLED;else result=V2Start(b,n,sequence);}
        else if(type==MB_FRAME_TEST_CANCEL&&n==8){if(mb_test.state==1)V2Finish(3,8);result=MB_OK;}
    }
    if(type==MB_FRAME_BIND_V2){
        uint8_t out[14]={0};V2Write32(out,mb_v2_session);V2Write32(out+4,sequence);out[8]=result;
        if(n>=13)memcpy(out+9,b+8,5);
        MotorBenchSendTypedFrame(MB_FRAME_BIND_ACK,out,sizeof(out));
    }else if(type==MB_FRAME_TEST_START||type==MB_FRAME_TEST_CANCEL){
        uint8_t out[18]={0};V2Write32(out,mb_v2_session);V2Write32(out+4,sequence);out[8]=result;out[9]=type;
        V2Write32(out+10,mb_test.id);V2Write32(out+14,mb_test.started);MotorBenchSendTypedFrame(MB_FRAME_TEST_ACK,out,sizeof(out));
    }
    MotorBenchV2SendStatus();return 1;
}
