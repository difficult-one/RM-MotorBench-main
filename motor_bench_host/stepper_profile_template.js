const field=()=>({address:null,type:'i32',wordOrder:'highFirst',scale:1});
const sequence=()=>[{address:null,type:'u16',wordOrder:'highFirst',scale:1,value:null}];
export const STEPPER_PROFILE_TEMPLATE={version:1,protocol:'modbus-rtu',name:'填写电机和驱动器型号',source:'填写厂家通信手册名称、版本和页码',verified:false,maxRpm:300,maxSteps:1000000,enable:sequence(),disable:sequence(),speed:field(),position:field(),speedStart:sequence(),positionStart:sequence(),feedbackSpeed:field(),feedbackPosition:field()};
