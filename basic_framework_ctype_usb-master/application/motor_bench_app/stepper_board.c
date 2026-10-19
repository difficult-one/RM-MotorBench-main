#include "main.h"
#include "stepper_pulse.h"
/* One opt-in pulse axis. These pins are taken from unused PWM outputs only
 * when the web client explicitly applies a stepper configuration. */
#if defined(STM32F427xx)
#define STEP_PORT GPIOA
#define STEP_PIN GPIO_PIN_0
#define DIR_PIN GPIO_PIN_1
#define EN_PIN GPIO_PIN_2
#else
#define STEP_PORT GPIOE
#define STEP_PIN GPIO_PIN_9
#define DIR_PIN GPIO_PIN_11
#define EN_PIN GPIO_PIN_13
#endif
static uint32_t remaining_us;
static void PulseWrite(int high){HAL_GPIO_WritePin(STEP_PORT,STEP_PIN,high?GPIO_PIN_SET:GPIO_PIN_RESET);}
static void DirectionWrite(int high){HAL_GPIO_WritePin(STEP_PORT,DIR_PIN,high?GPIO_PIN_SET:GPIO_PIN_RESET);}
static void EnableWrite(int high){HAL_GPIO_WritePin(STEP_PORT,EN_PIN,high?GPIO_PIN_SET:GPIO_PIN_RESET);}
static void ScheduleSlice(void){
    uint32_t slice=remaining_us>60000?60000:remaining_us;
    remaining_us-=slice;TIM7->ARR=slice-1;TIM7->CNT=0;TIM7->EGR=TIM_EGR_UG;TIM7->SR=0;
}
static void TimerWrite(uint32_t us){
    TIM7->CR1=0;TIM7->DIER=0;
    if(!us){remaining_us=0;TIM7->SR=0;return;}
    remaining_us=us;ScheduleSlice();TIM7->DIER=TIM_DIER_UIE;TIM7->CR1=TIM_CR1_OPM|TIM_CR1_CEN;
}
static void Prepare(int high){
    __HAL_RCC_GPIOA_CLK_ENABLE();__HAL_RCC_GPIOE_CLK_ENABLE();__HAL_RCC_TIM7_CLK_ENABLE();
    TIM7->CR1=0;TIM7->DIER=0;
    uint32_t clock=HAL_RCC_GetPCLK1Freq();if((RCC->CFGR&RCC_CFGR_PPRE1)!=0)clock*=2;
    TIM7->PSC=clock/1000000u-1u;
    PulseWrite(0);DirectionWrite(0);EnableWrite(!high);
    GPIO_InitTypeDef gpio={0};gpio.Pin=STEP_PIN|DIR_PIN|EN_PIN;gpio.Mode=GPIO_MODE_OUTPUT_PP;
    gpio.Pull=GPIO_NOPULL;gpio.Speed=GPIO_SPEED_FREQ_VERY_HIGH;HAL_GPIO_Init(STEP_PORT,&gpio);
    HAL_NVIC_SetPriority(TIM7_IRQn,5,0);HAL_NVIC_ClearPendingIRQ(TIM7_IRQn);HAL_NVIC_EnableIRQ(TIM7_IRQn);
}
void TIM7_IRQHandler(void){
    if(!(TIM7->SR&TIM_SR_UIF))return;
    TIM7->SR=0;
    if(remaining_us){ScheduleSlice();TIM7->CR1=TIM_CR1_OPM|TIM_CR1_CEN;return;}
    StepPulseInterrupt();
}
void StepperBoardInit(void){
    static const StepPulseIO io={Prepare,PulseWrite,DirectionWrite,EnableWrite,TimerWrite};
    StepPulseInit(&io);
}
