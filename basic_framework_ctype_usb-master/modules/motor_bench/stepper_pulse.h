#ifndef STEPPER_PULSE_H
#define STEPPER_PULSE_H
#include <stdint.h>
typedef struct {
    void (*prepare)(int enable_high);
    void (*pulse)(int high);
    void (*direction)(int high);
    void (*enable)(int high);
    void (*timer)(uint32_t half_period_us);
} StepPulseIO;
typedef struct {
    uint8_t configured, enabled, running, enable_high, invert, reason;
    uint32_t pulses_per_rev, max_hz, remaining;
    int32_t position;
    float rpm;
} StepPulseState;
/* Call command/snapshot functions with the timer interrupt masked. */
void StepPulseInit(const StepPulseIO *io);
int StepPulseAvailable(void);
uint8_t StepPulseConfigure(uint32_t ppr,uint32_t max_hz,int enable_high,int invert);
uint8_t StepPulseEnable(int enabled);
uint8_t StepPulseMove(int relative,float rpm,int32_t steps);
void StepPulseStop(uint8_t reason);
void StepPulseInterrupt(void);
StepPulseState StepPulseSnapshot(void);
#endif
