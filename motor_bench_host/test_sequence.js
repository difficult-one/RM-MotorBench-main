import {targetSpec} from './motor_rules.js';
export const TEST_MODES=['step','ramp','reversal'];
export function sequenceDuration(c){return c.baselineMs+c.phaseMs*(c.mode==='step'?1:2)+(c.mode==='reversal'?500:0)+c.tailMs;}
export function validateSequence(c,binding={kind:3,outerLoop:2}){
  if(!c||!TEST_MODES.includes(c.mode)||!Number.isInteger(c.channelId)||c.channelId<0||c.channelId>7)throw Error('测试类型或通道无效');
  if(![1,2,3,4].includes(binding.kind)||binding.outerLoop!==2)throw Error('自动测试仅支持已确认的速度环');
  if(typeof c.amplitude!=='number'||!Number.isFinite(c.amplitude)||c.amplitude<=0||c.amplitude>targetSpec(binding.kind,2).limit)throw Error('测试幅度超出型号限幅');
  for(const[key,min,max]of[['baselineMs',500,10000],['phaseMs',200,30000],['tailMs',500,10000]])if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw Error(`${key}超出允许时长`);
  if(sequenceDuration(c)>120000)throw Error('测试总时长超过120秒');
  return {channelId:c.channelId,mode:c.mode,amplitude:c.amplitude,baselineMs:c.baselineMs,phaseMs:c.phaseMs,tailMs:c.tailMs};
}
export function sequenceTarget(c,elapsed){
  if(elapsed>=sequenceDuration(c))return null;
  if(elapsed<c.baselineMs)return 0;
  const t=elapsed-c.baselineMs;
  if(c.mode==='step')return t<c.phaseMs?c.amplitude:0;
  if(c.mode==='ramp')return t<c.phaseMs?c.amplitude*t/c.phaseMs:t<2*c.phaseMs?c.amplitude:0;
  return t<c.phaseMs?c.amplitude:t<c.phaseMs+500?0:t<2*c.phaseMs+500?-c.amplitude:0;
}
export function sequenceSegments(c){
  if(c.mode==='step')return [{start:c.baselineMs,end:c.baselineMs+c.phaseMs,target:c.amplitude,step:true}];
  if(c.mode==='ramp')return [{start:c.baselineMs+c.phaseMs,end:c.baselineMs+2*c.phaseMs,target:c.amplitude,step:false}];
  return [{start:c.baselineMs,end:c.baselineMs+c.phaseMs,target:c.amplitude,step:true},{start:c.baselineMs+c.phaseMs+500,end:c.baselineMs+2*c.phaseMs+500,target:-c.amplitude,step:true}];
}
