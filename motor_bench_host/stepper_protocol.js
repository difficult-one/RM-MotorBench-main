import { buildFrame } from './protocol.js';
export const PulseFrame = { CONFIG:0x14, MOVE:0x15, ENABLE:0x16, QUERY:0x17, REPORT:0x95 };
export const PulseCapability = 16;
export const PulseReason = ['未运行','用户停止','主机失联','定量运动完成','计数范围耗尽','配置改变'];
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function validatePulseConfig(c) {
  if(!c||!integer(c.pulsesPerRev,200,1000000)||!integer(c.maxHz,1,10000)||typeof c.enableHigh!=='boolean'||typeof c.invert!=='boolean')throw Error('步进配置无效：每圈脉冲 200–1000000，最高频率 1–10000 Hz，极性须明确');
  return {pulsesPerRev:c.pulsesPerRev,maxHz:c.maxHz,enableHigh:c.enableHigh,invert:c.invert};
}
export function validatePulseMove(c,config) {
  if(!['speed','relative'].includes(c.mode)||typeof c.rpm!=='number'||!Number.isFinite(c.rpm)||Math.abs(c.rpm)>3000)throw Error('转速应为 ±3000 rpm 范围内的有限数值');
  if(c.mode==='relative'&&(!integer(c.steps,-10000000,10000000)||c.steps===0||c.rpm<=0))throw Error('相对运动须指定非零整数脉冲数（±10000000）和正转速');
  const hz=Math.abs(c.rpm)*config.pulsesPerRev/60;
  if(!Number.isFinite(hz)||hz>config.maxHz||(hz>0&&hz<1))throw Error('目标脉冲频率超出 1 Hz 至配置上限，请调整转速或每圈脉冲数');
  return c;
}
export function buildPulseCommand(session,sequence,c) {
  if(!integer(session,1,0xffffffff)||!integer(sequence,1,0xffffffff))throw Error('步进链路会话或序号无效');
  const type={pulseConfig:20,pulseMove:21,pulseEnable:22,pulseQuery:23}[c.type];
  if(!type)throw Error('未知步进指令');
  const b=Buffer.alloc({20:18,21:17,22:9,23:8}[type]);b.writeUInt32LE(session);b.writeUInt32LE(sequence,4);
  if(type===20){validatePulseConfig(c);b.writeUInt32LE(c.pulsesPerRev,8);b.writeUInt32LE(c.maxHz,12);b[16]=+c.enableHigh;b[17]=+c.invert;}
  if(type===21){if(!['speed','relative'].includes(c.mode)||!Number.isFinite(c.rpm))throw Error('步进运动无效');b[8]=c.mode==='relative'?1:0;b.writeFloatLE(c.rpm,9);b.writeInt32LE(c.mode==='relative'?c.steps:0,13);}
  if(type===22){if(typeof c.enable!=='boolean')throw Error('使能值须为布尔值');b[8]=+c.enable;}
  return buildFrame(type,b);
}
export function parsePulseReport(b) {
  if(b.length!==33||b[8]<20||b[8]>23||b[9]>6||(b[10]&~31)||b[11]>5)return null;
  const result={boardSession:b.readUInt32LE(0),sequence:b.readUInt32LE(4),command:b[8],result:b[9],configured:!!(b[10]&1),enabled:!!(b[10]&2),running:!!(b[10]&4),enableHigh:!!(b[10]&8),invert:!!(b[10]&16),reason:b[11],pulsesPerRev:b.readUInt32LE(12),maxHz:b.readUInt32LE(16),rpm:b.readFloatLE(20),position:b.readInt32LE(24),remaining:b.readUInt32LE(28),board:b[32]};
  if(!Number.isFinite(result.rpm)||result.remaining>10000000||result.board>2)return null;
  if(result.configured)try{validatePulseConfig(result);}catch{return null;}
  return result;
}
