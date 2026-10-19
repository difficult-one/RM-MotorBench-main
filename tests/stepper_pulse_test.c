#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "stepper_pulse.h"
static int edges, level, enable_level, dir;
static unsigned timer;
static void prepare(int high){enable_level=!high;}
static void pulse(int high){if(high&&!level)edges++;level=high;}
static void direction(int high){dir=high;}
static void enable(int high){enable_level=high;}
static void clock_us(unsigned us){timer=us;}
int main(void){
  StepPulseIO io={prepare,pulse,direction,enable,clock_us};StepPulseInit(&io);
  assert(StepPulseConfigure(3200,10000,1,0)==0);assert(!enable_level);
  assert(StepPulseMove(1,60,3)==4);assert(StepPulseEnable(1)==0);
  assert(StepPulseMove(1,60,-3)==0);assert(dir==0);assert(timer>=1000);
  for(int i=0;i<6;i++)StepPulseInterrupt();
  StepPulseState s=StepPulseSnapshot();assert(edges==3&&s.position==-3&&!s.running&&s.reason==3&&s.enabled&&!level&&!timer);
  assert(StepPulseMove(0,60,0)==0);StepPulseInterrupt();assert(dir==1&&level);
  assert(StepPulseMove(0,-60,0)==2); /* no direction change during an active pulse */
  StepPulseStop(2);s=StepPulseSnapshot();assert(!s.enabled&&!s.running&&!level&&!timer);
  for(int i=0;i<5;i++)StepPulseInterrupt();
  assert(edges==4);
  assert(StepPulseConfigure(200,10000,0,1)==0);assert(enable_level);
  assert(StepPulseEnable(1)==0);assert(!enable_level);
  assert(StepPulseMove(1,3000,2)==0);assert(dir==0);
  StepPulseInterrupt();StepPulseStop(1);assert(enable_level&&!level);
  assert(StepPulseMove(0,NAN,0)==1);
  assert(StepPulseConfigure(0,10000,1,0)==1);
  assert(StepPulseConfigure(1000000,10000,1,0)==0);StepPulseEnable(1);
  assert(StepPulseMove(0,3000,0)==1);StepPulseStop(1);
  puts("PASS pulse: exact edges, signed motion, setup delay, stop, polarity, bounds");
}
