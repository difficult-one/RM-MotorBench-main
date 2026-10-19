import { parseDocument, textField } from './workspace_formats.js';
export const SAMPLE_FIELDS=['elapsedMs','receivedAt','boardMs','boardSession','channelId','kind','canBus','motorId','outerLoop','identitySource','targetUnit','speedUnit','torqueUnit','source','online','enabled','ref','speed','torque','angle','temperature'];
export function parseRecording(text) {
  const r=parseDocument(text,25000000);
  if(r.type!=='motor-bench-recording'||r.version!==1||r.timeBasis!=='host-receive')throw Error('记录类型、时间基准或版本不支持');
  textField(r.name,'记录名称');textField(r.notes??'','备注',1000,true);
  textField(r.id,'记录标识',80);textField(r.stopReason,'结束原因',200);
  if(!r.context||typeof r.context!=='object'||Array.isArray(r.context)||r.context.mode!==r.mode||!Number.isInteger(r.context.session)||typeof r.context.firmware!=='string'||!Array.isArray(r.context.bindings)||!Array.isArray(r.context.inventory))throw Error('记录上下文无效');
  if(!['real','demo'].includes(r.mode)||!Number.isFinite(r.startedAt)||!Number.isFinite(r.endedAt)||r.endedAt<r.startedAt||r.endedAt-r.startedAt>605000)throw Error('记录模式或时间无效');
  if(!Array.isArray(r.samples)||r.samples.length>60000||!Array.isArray(r.events)||r.events.length>1000)throw Error('记录超过容量');
  let previous=0;
  for(const sample of r.samples){
    if(sample.boardMs!=null||sample.boardSession!=null){for(const key of ['boardMs','boardSession'])if(!Number.isInteger(sample[key])||sample[key]<0||sample[key]>0xffffffff)throw Error('板端时间或会话无效');}
    if(!Number.isInteger(sample.channelId)||sample.channelId<0||sample.channelId>7||!Number.isFinite(sample.elapsedMs)||sample.elapsedMs<previous||sample.elapsedMs>r.endedAt-r.startedAt||!Number.isFinite(sample.receivedAt)||Math.abs(sample.receivedAt-r.startedAt-sample.elapsedMs)>1)throw Error('样本通道或时间无效');previous=sample.elapsedMs;
    if(!['unknown','user','confirmed'].includes(sample.identitySource))throw Error('样本身份来源无效');
    const identity=['kind','canBus','motorId','outerLoop'];
    if(sample.identitySource==='unknown'){
      if(identity.some(key=>sample[key]!==null))throw Error('未知身份必须保留空身份字段');
    }else{
      const {kind,canBus,motorId,outerLoop}=sample;
      if(!Number.isInteger(kind)||kind<1||kind>4||!Number.isInteger(canBus)||canBus<1||canBus>2||!Number.isInteger(motorId)||motorId<1||motorId>(kind===1?7:kind===4?255:8)||!(kind===4?[2]:[0,1,2,4]).includes(outerLoop))throw Error('样本电机身份或控制环无效');
    }
    if(sample.source!==null&&(!Number.isInteger(sample.source)||sample.source<0||sample.source>3))throw Error('样本控制来源无效');
    for(const key of ['ref','speed','torque','angle','temperature'])if(sample[key]!==null&&(typeof sample[key]!=='number'||!Number.isFinite(sample[key])))throw Error('记录包含无效数值');
    for(const key of ['targetUnit','speedUnit','torqueUnit','identitySource'])textField(sample[key],key,40);
    if(typeof sample.online!=='boolean'||typeof sample.enabled!=='boolean')throw Error('样本状态无效');
  }
  for(const e of r.events){if(!Number.isFinite(e.elapsedMs)||e.elapsedMs<0||e.elapsedMs>r.endedAt-r.startedAt)throw Error('事件时间无效');textField(e.message,'事件',2000);}
  if(JSON.stringify(r.context??{}).length>100000)throw Error('记录上下文过大');
  return r;
}
const csvCell=value=>{
  if(value===null||value===undefined)return '';
  if(typeof value==='number'||typeof value==='boolean')return String(value);
  let text=String(value);if(/^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function recordCsv(record) {
  const columns=['rowType','name','notes','mode','firmware','session','timeBasis',...SAMPLE_FIELDS,'event','details'];
  const row=data=>columns.map(key=>csvCell(data[key])).join(',');
  const rows=[columns.join(','),row({rowType:'metadata',name:record.name,notes:record.notes,mode:record.mode,firmware:record.context.firmware,session:record.context.session,timeBasis:record.timeBasis,details:JSON.stringify(record.context)})];
  for(const sample of record.samples)rows.push(row({rowType:'sample',mode:record.mode,firmware:record.context.firmware,session:record.context.session,timeBasis:record.timeBasis,...sample}));
  for(const e of record.events)rows.push(row({rowType:'event',elapsedMs:e.elapsedMs,event:e.message,details:JSON.stringify(e.data??{})}));
  return '\ufeff'+rows.join('\r\n');
}
export const replayWindow=(record,end,windowMs)=>record.samples.filter(s=>s.elapsedMs>=end-windowMs&&s.elapsedMs<=end);
export function groupSpeedUnits(samples) {
  const groups=new Map();for(const s of samples){if(!groups.has(s.speedUnit))groups.set(s.speedUnit,[]);groups.get(s.speedUnit).push(s);}
  return [...groups].map(([unit,samples])=>({unit,samples}));
}
export function cursorSamples(samples,time) {
  const latest=new Map();for(const sample of samples)if(sample.elapsedMs<=time)latest.set(sample.channelId,sample);
  return [...latest.values()].map(s=>time-s.elapsedMs>1000?{...s,ref:null,speed:null}:s);
}
