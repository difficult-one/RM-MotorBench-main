import { motorKey, registrationError, targetSpec } from './motor_rules.js';
export function parseDocument(text, maxLength = 100000) {
  if (typeof text !== 'string' || text.length > maxLength) throw Error('文件过大或内容无效');
  let value; try { value = JSON.parse(text); } catch { throw Error('JSON 格式无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('文件必须为 JSON 对象');
  return value;
}
export function textField(value, label, max = 80, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw Error(`${label}无效，最多 ${max} 字`);
  return value.trim();
}
const int = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) throw Error(`${name}无效`); return value; };
function motor(value) {
  const kind = int(value?.kind,1,4,'型号'), canBus = int(value.canBus,1,2,'总线');
  const motorId = int(value.motorId,1,kind===1?7:kind===4?255:8,'电机ID');
  const outerLoop = value.outerLoop ?? 2;
  if (!(kind===4?[2]:[0,1,2,4]).includes(outerLoop)) throw Error('控制环不受该型号支持');
  return {kind,canBus,motorId,outerLoop};
}
export function parseScene(text) {
  const value=parseDocument(text);
  if(value.type!=='motor-bench-scene'||value.version!==1)throw Error('配置类型或版本不支持');
  const name=textField(value.name,'配置名称');
  if(!Array.isArray(value.motors)||value.motors.length>8||!Array.isArray(value.bindings)||value.bindings.length>8)throw Error('配置最多8颗电机及8通道');
  const motors=[];
  for(const entry of value.motors){const m=motor(entry);if(motors.some(p=>motorKey(p)===motorKey(m)))throw Error('电机身份重复');const error=registrationError(m,motors);if(error)throw Error(error);motors.push({...m,note:textField(entry.note??'','备注',40,true)});}
  const bindings=value.bindings.map(entry=>{
    const b={...motor(entry),channelId:int(entry.channelId,0,7,'通道')};
    if(!motors.some(m=>motorKey(m)===motorKey(b)))throw Error('绑定引用未登记电机');return b;
  });
  if(new Set(bindings.map(b=>b.channelId)).size!==bindings.length||new Set(bindings.map(motorKey)).size!==bindings.length)throw Error('绑定通道或电机重复');
  const control={source:int(value.control?.source??0,0,3,'控制来源')};
  if(control.source){
    const ids=control.source===1?[value.control.channelId]:value.control.channels;
    if(!Array.isArray(ids)||ids.length!==(control.source===1?1:4)||new Set(ids).size!==ids.length)throw Error('遥控通道必须完整且不同');
    const members=ids.map(id=>{const b=bindings.find(b=>b.channelId===id);if(!b||b.outerLoop!==2)throw Error('遥控必须引用已配置速度环');return b;});
    if(control.source>=2&&members.some(b=>b.kind>3||b.kind!==members[0].kind))throw Error('底盘须为同型号DJI速度环');
    const maxRef=value.control.maxRef;if(typeof maxRef!=='number'||!Number.isFinite(maxRef)||maxRef<=0||maxRef>targetSpec(members[0].kind).limit)throw Error('遥控限幅无效');
    Object.assign(control,{maxRef},control.source===1?{channelId:ids[0]}:{channels:[...ids],reverseMask:int(value.control.reverseMask??0,0,15,'反向配置')});
  }
  return {type:'motor-bench-scene',version:1,name,motors,bindings,control};
}
export function sceneDiff(scene, current) {
  const inventory=current.inventory??[], bindings=current.bindings??[], telemetry=current.telemetry??{};
  const add=scene.motors.filter(m=>!inventory.some(p=>motorKey(p)===motorKey(m)));
  const bind=scene.bindings.filter(b=>!bindings.some(p=>p.channelId===b.channelId&&motorKey(p)===motorKey(b)&&p.outerLoop===b.outerLoop&&!p.identified));
  const unbind=new Set(bind.filter(b=>telemetry[b.channelId]||bindings.some(p=>p.channelId===b.channelId)).map(b=>b.channelId));
  for(const b of bind)for(const p of bindings)if(motorKey(b)===motorKey(p)&&p.channelId!==b.channelId)unbind.add(p.channelId);
  const conflicts=[];const combined=[...inventory];for(const m of add){const error=registrationError(m,combined);if(error)conflicts.push(error);else combined.push(m);}
  return {add,bind,unbind:[...unbind],conflicts};
}
export function parsePreset(text) {
  const value=parseDocument(text);
  if(value.type!=='motor-bench-pid'||value.version!==1)throw Error('PID预设类型或版本不支持');
  const name=textField(value.name,'预设名称'),kind=int(value.kind,1,4,'型号'),loop=int(value.loop,0,2,'PID环');
  const pid={};for(const key of ['Kp','Ki','Kd','MaxOut','IntegralLimit']){const v=value.pid?.[key];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>(key==='MaxOut'||key==='IntegralLimit'?2147483647:655.35))throw Error(`${key}无效或超出范围`);pid[key]=v;}
  pid.improve=int(value.pid?.improve??0,0,255,'PID标志');
  return {type:'motor-bench-pid',version:1,name,kind,loop,pid};
}
