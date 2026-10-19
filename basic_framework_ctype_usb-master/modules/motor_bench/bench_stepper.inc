/* Shares the V2 session and monotonically increasing request sequence. */
static uint8_t mb_pulse_div;
static void PulseReport(uint32_t sequence,uint8_t command,uint8_t result){
    uint32_t mask=__get_PRIMASK();__disable_irq();StepPulseState s=StepPulseSnapshot();__set_PRIMASK(mask);
    uint8_t out[33]={0};V2Write32(out,mb_v2_session);V2Write32(out+4,sequence);out[8]=command;out[9]=result;
    out[10]=s.configured|(s.enabled<<1)|(s.running<<2)|(s.enable_high<<3)|(s.invert<<4);out[11]=s.reason;
    V2Write32(out+12,s.pulses_per_rev);V2Write32(out+16,s.max_hz);memcpy(out+20,&s.rpm,4);
    memcpy(out+24,&s.position,4);V2Write32(out+28,s.remaining);
#if defined(STM32F427xx)
    out[32]=1;
#elif defined(STM32F407xx)
    out[32]=2;
#endif
    MotorBenchSendTypedFrame(0x95,out,sizeof(out));
}
static uint8_t PulseHandle(uint8_t type,const uint8_t *b,uint8_t n){
    if(type<0x14||type>0x17)return 0;
    if(n<8)return 1;
    uint32_t seq=V2Read32(b+4);uint8_t result=MB_ERR_BAD_PARAM;
    if(mb_v2_session&&V2Read32(b)==mb_v2_session&&seq&&seq>mb_v2_sequence){
        mb_v2_sequence=seq;
        uint32_t mask=__get_PRIMASK();__disable_irq();
        if(!StepPulseAvailable())result=MB_ERR_UNSUPPORTED;
        else if(type==0x17&&n==8)result=MB_OK;
        else if(type==0x16&&n==9&&b[8]<=1)result=(!b[8]||(mb_link_online&&!mb_control.source&&mb_test.state!=1))?StepPulseEnable(b[8]):MB_ERR_NOT_ENABLED;
        else if(mb_test.state==1||!mb_link_online||mb_control.source)result=MB_ERR_NOT_ENABLED;
        else if(type==0x14&&n==18)result=StepPulseConfigure(V2Read32(b+8),V2Read32(b+12),b[16],b[17]);
        else if(type==0x15&&n==17){float rpm;int32_t steps;memcpy(&rpm,b+9,4);memcpy(&steps,b+13,4);result=StepPulseMove(b[8],rpm,steps);}
        __set_PRIMASK(mask);
    }
    PulseReport(seq,type,result);return 1;
}
static void PulseTick(void){if(mb_v2_session&&StepPulseAvailable()&&++mb_pulse_div>=25){mb_pulse_div=0;PulseReport(0,0x17,0);}}
