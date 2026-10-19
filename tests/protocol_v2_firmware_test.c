#include <stdint.h>
#include <string.h>
#include <assert.h>
static uint8_t capture[32768]; static unsigned capture_used;
static void capture_tx(uint8_t *b, uint16_t n) { assert(capture_used+n<=sizeof(capture));memcpy(capture+capture_used,b,n);capture_used+=n; }
#define MB_CAPTURE_TX
#define MB_V2_LIBRARY
#include "firmware_behavior_test.c"
#include "stepper_pulse.h"
static int pulse_edges,pulse_high;
static void pulse_prepare(int high){(void)high;}
static void pulse_pin(int high){if(high&&!pulse_high)pulse_edges++;pulse_high=high;}
static void pulse_level(int high){(void)high;}
static void pulse_timer(uint32_t us){(void)us;}
static void put32(uint8_t *b,uint32_t v){for(int i=0;i<4;i++)b[i]=(uint8_t)(v>>(8*i));}
static uint32_t get32(const uint8_t *b){return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24;}
static uint8_t *find_frame(uint8_t type){drain();uint8_t *found=NULL;for(unsigned i=0;i+5<=capture_used;){assert(capture[i]==0xa5);unsigned n=capture[i+2]+5;assert(i+n<=capture_used&&capture[i+n-1]==0x5a);assert(crc_8(capture+i+1,n-3)==capture[i+n-2]);if(capture[i+1]==type)found=capture+i+3;i+=n;}return found;}
static void clear_capture(void){drain();capture_used=0;}
static void tick(uint32_t now){test_tick=now;for(int i=0;i<10;i++)MotorBenchTask();}
static uint32_t seq,wire_session,random_counter=1000;
static uint8_t session_random(uint32_t *out){*out=++random_counter;return 1;}
static void start(uint8_t mode,uint32_t now){
    uint8_t b[26]={0};put32(b,wire_session);put32(b+4,++seq);b[8]=0;b[9]=mode;float amp=100;memcpy(b+10,&amp,4);put32(b+14,500);put32(b+18,1000);put32(b+22,500);
    test_tick=now;clear_capture();receive(0x12,b,sizeof(b));uint8_t *ack=find_frame(0x94);assert(ack&&ack[8]==0);assert(get32(ack+10)==seq&&get32(ack+14)==now);
}
static MB_TelemetryItem_s measure(void){MB_TelemetryItem_s m;assert(MotorBenchGetMeasure(0,&m)==0);return m;}
int main(void){
    lifecycle_suite();MotorBenchInitUSB();MotorBenchSetMotorFactory(factory,destroy);MotorBenchSetRemoteReader(remote);
    MotorBenchSetSessionRandom(session_random);
    uint8_t hello[4];put32(hello,123);receive(0x0f,hello,4);uint8_t *caps=find_frame(0x8f);assert(caps&&caps[0]==2&&get32(caps+1)==15&&get32(caps+14)==123);wire_session=get32(caps+5);assert(wire_session!=0);
    clear_capture();receive(1,NULL,0);uint8_t ch;assert(MotorBenchAddMotor(MB_MOTOR_M3508,1,1,&ch)==0);
    uint8_t bind[13]={0};put32(bind,wire_session);put32(bind+4,++seq);bind[8]=0;bind[9]=2;bind[10]=1;bind[11]=1;bind[12]=255;clear_capture();receive(0x10,bind,13);uint8_t *ack=find_frame(0x90);assert(ack&&ack[8]==1);
    bind[12]=2;put32(bind+4,++seq);clear_capture();receive(0x10,bind,13);ack=find_frame(0x90);assert(ack&&ack[8]==0&&ack[9]==0);
    uint8_t query[8];put32(query,wire_session);put32(query+4,++seq);clear_capture();receive(0x11,query,8);uint8_t *list=find_frame(0x91);assert(list&&list[8]==1&&list[9]==0&&list[10]==2&&list[12]==1);
    DaemonReload(created->daemon); /* A registered motor is offline until feedback arrives. */
    start(0,1000);tick(1499);assert(measure().ref==0&&(measure().status&2));tick(1500);assert(measure().ref==100);tick(2500);assert(measure().ref==0);tick(3000);assert(!(measure().status&2));uint8_t *status=find_frame(0x92);assert(status&&status[8]==7&&status[9]==2);
    uint8_t *telemetry=find_frame(0x81);assert(telemetry&&get32(telemetry+24)==wire_session&&get32(telemetry+28)==3000);
    /* A delayed or repeated start is rejected instead of restarting output. */
    uint8_t old[26]={0};put32(old,wire_session);put32(old+4,seq);old[8]=0;float a=100;memcpy(old+10,&a,4);put32(old+14,500);put32(old+18,1000);put32(old+22,500);clear_capture();receive(0x12,old,26);assert(find_frame(0x94)[8]!=0&&!(measure().status&2));
    start(1,4000);tick(5000);assert(measure().ref==50);tick(5500);assert(measure().ref==100);tick(7000);assert(!(measure().status&2));
    start(2,8000);tick(8500);assert(measure().ref==100);tick(9600);assert(measure().ref==0);tick(10000);assert(measure().ref==-100);tick(11500);assert(!(measure().status&2));
    start(0,12000);put32(query+4,++seq);receive(0x13,query,8);status=find_frame(0x92);assert(status[8]==8&&status[9]==3&&!(measure().status&2));
    start(0,13000);created->daemon->temp_count=0;tick(13500);status=find_frame(0x92);assert(status[8]==4&&status[9]==4&&!(measure().status&2));DaemonReload(created->daemon);tick(13600);assert(!(measure().status&2));
    start(0,14000);receive(5,NULL,0);tick(14100);status=find_frame(0x92);assert(status[8]==1&&status[9]==4&&!(measure().status&2));
    start(0,15000);for(unsigned i=0;i<160;i++)DaemonTask();tick(16600);status=find_frame(0x92);assert(status[8]==2&&!(measure().status&2));
    receive(1,NULL,0);clear_capture();receive(0x12,old,26);assert(find_frame(0x94)[8]!=0&&!(measure().status&2));
    /* Replaying a retired HELLO must mint a new board session, not revive old START. */
    put32(hello,456);receive(0x0f,hello,4);put32(hello,123);clear_capture();receive(0x0f,hello,4);wire_session=get32(find_frame(0x8f)+5);assert(wire_session!=get32(old));
    receive(0x12,old,26);assert(find_frame(0x94)[8]!=0&&!(measure().status&2));
    DaemonReload(created->daemon);seq=0;start(0,17000);hUsbDeviceFS.dev_state=0;tick(17010);assert(!(measure().status&2));
    hUsbDeviceFS.dev_state=USBD_STATE_CONFIGURED;receive(1,NULL,0);tick(17100);status=find_frame(0x92);assert(status&&status[8]==10);assert(!(measure().status&2));
    /* Stop reasons also describe ordinary manual/remote operation, outside a test. */
    DaemonReload(created->daemon);uint8_t enable[2]={0,1},disable[2]={0,0};receive(4,enable,2);receive(4,disable,2);tick(17200);assert(find_frame(0x92)[8]==6);
    receive(4,enable,2);created->daemon->temp_count=0;tick(17210);assert(!(measure().status&2)&&find_frame(0x92)[8]==4);
    DaemonReload(created->daemon);uint8_t source[6]={1,0};float limit=1000;memcpy(source+2,&limit,4);receive(0x0d,source,6);tick(17300);receive(4,enable,2);assert(measure().status&2);remote_online=0;tick(17310);assert(!(measure().status&2)&&find_frame(0x92)[8]==3);
    /* Group stop has the same user-disable cause and preserves an earlier fault. */
    remote_online=1;for(uint8_t i=1;i<4;i++){assert(MotorBenchAddMotor(MB_MOTOR_M3508,1,i+1,&ch)==0);assert(MotorBenchBind(i,MB_MOTOR_M3508,1,i+1,SPEED_LOOP)==0);DaemonReload(created->daemon);}
    uint8_t chassis[10]={2,0,1,2,3,0},group_enable=1,group_disable=0;memcpy(chassis+6,&limit,4);receive(0x0d,chassis,10);tick(17400);receive(0x0e,&group_enable,1);assert(measure().status&2);
    receive(0x0e,&group_disable,1);tick(17410);assert(!(measure().status&2)&&find_frame(0x92)[8]==6);
    receive(5,NULL,0);receive(0x0e,&group_disable,1);tick(17420);assert(find_frame(0x92)[8]==1);
    /* Exercise the actual pulse protocol, core and stop lifecycle together. */
    static const StepPulseIO pulse_io={pulse_prepare,pulse_pin,pulse_level,pulse_level,pulse_timer};
    StepPulseInit(&pulse_io);uint8_t web[6]={0};receive(0x0d,web,6);
    put32(hello,789);clear_capture();receive(0x0f,hello,4);caps=find_frame(0x8f);assert(get32(caps+1)==31);wire_session=get32(caps+5);seq=0;
    uint8_t pc[18]={0};put32(pc,wire_session);put32(pc+4,++seq);put32(pc+8,3200);put32(pc+12,10000);pc[16]=1;
    clear_capture();receive(0x14,pc,18);assert(find_frame(0x95)[9]==0&&StepPulseSnapshot().configured);
    uint8_t pe[9]={0};put32(pe,wire_session);put32(pe+4,++seq);pe[8]=1;receive(0x16,pe,9);assert(StepPulseSnapshot().enabled);
    uint8_t pm[17]={0};put32(pm,wire_session);put32(pm+4,++seq);pm[8]=1;float rpm=60;int32_t count=-3;memcpy(pm+9,&rpm,4);memcpy(pm+13,&count,4);
    receive(0x15,pm,17);for(int i=0;i<6;i++)StepPulseInterrupt();assert(pulse_edges==3&&StepPulseSnapshot().position==-3&&StepPulseSnapshot().reason==3);
    receive(5,NULL,0);assert(!StepPulseSnapshot().enabled&&!pulse_high);
    /* The previous enable sequence cannot rearm output after ALL_STOP. */
    clear_capture();receive(0x16,pe,9);assert(find_frame(0x95)[9]!=0&&!StepPulseSnapshot().enabled);
    put32(pe+4,++seq);put32(pe,wire_session+1);clear_capture();receive(0x16,pe,9);assert(find_frame(0x95)[9]!=0&&!StepPulseSnapshot().enabled);
    put32(pe,wire_session);put32(pe+4,++seq);receive(0x16,pe,9);assert(StepPulseSnapshot().enabled);
    put32(pm+4,++seq);pm[8]=0;receive(0x15,pm,17);assert(StepPulseSnapshot().running);
    for(unsigned i=0;i<160;i++)DaemonTask();
    assert(!StepPulseSnapshot().enabled&&!pulse_high);
    puts("PASS: pulse capabilities, session/sequence ACK, bounded edges, emergency and link timeout");
    puts("PASS: V2 capabilities, correlated binding/list, board time, bounded step/ramp/reversal, cancel, replay rejection and loss stops");
}
