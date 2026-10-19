#include "stepper_pulse.h"
#include <math.h>
#include <limits.h>
static const StepPulseIO *pins;
static volatile StepPulseState state;
static uint32_t half_period;
static uint8_t high, bounded;
static int8_t sign;
void StepPulseInit(const StepPulseIO *io){pins=io;}
int StepPulseAvailable(void){return pins!=0;}
static void idle(void){pins->timer(0);pins->pulse(0);high=0;state.running=0;state.rpm=0;state.remaining=0;}
void StepPulseStop(uint8_t reason){if(!pins)return;idle();if(state.configured)pins->enable(!state.enable_high);state.enabled=0;state.reason=reason;}
uint8_t StepPulseConfigure(uint32_t ppr,uint32_t hz,int en,int invert){
    if(!pins)return 5;
    if(ppr<200||ppr>1000000||hz<1||hz>10000||(en!=0&&en!=1)||(invert!=0&&invert!=1))return 1;
    if(state.enabled||state.running)return 4;
    state.enable_high=en;state.invert=invert;state.pulses_per_rev=ppr;state.max_hz=hz;
    pins->prepare(en);state.configured=1;StepPulseStop(5);return 0;
}
uint8_t StepPulseEnable(int enabled){
    if(!pins||!state.configured)return 3;
    if(enabled!=0&&enabled!=1)return 1;
    StepPulseStop(1);state.enabled=enabled;pins->enable(enabled?state.enable_high:!state.enable_high);return 0;
}
uint8_t StepPulseMove(int relative,float rpm,int32_t steps){
    if(!isfinite(rpm)||fabsf(rpm)>3000||relative<0||relative>1)return 1;
    if(!pins||!state.configured||!state.enabled)return 4;
    if(state.running)return 2;
    if(relative&&(steps==0||steps>10000000||steps< -10000000||rpm<=0))return 1;
    float hz=fabsf(rpm)*(float)state.pulses_per_rev/60.0f;
    if(hz>state.max_hz||(hz>0&&hz<1))return 1;
    if(hz==0){idle();return 0;}
    sign=relative?(steps<0?-1:1):(rpm<0?-1:1);
    half_period=(uint32_t)(500000.0f/hz+0.5f);
    bounded=(uint8_t)relative;state.remaining=relative?(uint32_t)(steps<0?-steps:steps):0;
    state.rpm=(float)sign*60000000.0f/(2.0f*half_period*state.pulses_per_rev);
    pins->direction((sign>0)^state.invert);pins->pulse(0);high=0;state.running=1;state.reason=0;
    /* First edge follows direction/enable setup by at least 1 ms. */
    pins->timer(half_period<1000?1000:half_period);return 0;
}
void StepPulseInterrupt(void){
    if(!pins||!state.enabled||!state.running)return;
    if(high){pins->pulse(0);high=0;if(bounded&&state.remaining==0){idle();state.reason=3;return;}}
    else{
        if((sign>0&&state.position==INT32_MAX)||(sign<0&&state.position==INT32_MIN)){StepPulseStop(4);return;}
        pins->pulse(1);high=1;state.position+=sign;if(bounded)state.remaining--;
    }
    pins->timer(half_period);
}
StepPulseState StepPulseSnapshot(void){return state;}
