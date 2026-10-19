import {buildFrame,FrameType as F,parseTelemetry} from './protocol.js';
import {validateSequence,TEST_MODES} from './test_sequence.js';
const uint=(v,max=0xffffffff)=>Number.isInteger(v)&&v>=0&&v<=max;
const identity=b=>uint(b.channelId,7)&&uint(b.kind,4)&&b.kind>=1&&[1,2].includes(b.canBus)&&uint(b.motorId,b.kind===1?7:b.kind===4?255:8)&&b.motorId>=1&&(b.kind===4?[2]:[0,1,2,4]).includes(b.outerLoop);
const binding=b=>({channelId:b[0],kind:b[1],canBus:b[2],motorId:b[3],outerLoop:b[4]});
function header(session,sequence,length){if(!uint(session)||!session||!uint(sequence)||!sequence)throw Error('链路会话或指令序号无效');const b=Buffer.alloc(length);b.writeUInt32LE(session);b.writeUInt32LE(sequence,4);return b;}
export function buildHello(session){if(!uint(session)||!session)throw Error('链路会话无效');const b=Buffer.alloc(4);b.writeUInt32LE(session);return buildFrame(F.HELLO,b);}
export function parseCapabilities(b){if(b.length!==18||b[0]!==2||b[13]!==8)return null;return {version:b[0],flags:b.readUInt32LE(1),boardSession:b.readUInt32LE(5),boardMs:b.readUInt32LE(9),channelMax:b[13],helloNonce:b.readUInt32LE(14)};}
export function buildBindV2(session,seq,m){if(!identity(m))throw Error('绑定身份无效');const b=header(session,seq,13);b.set([m.channelId,m.kind,m.canBus,m.motorId,m.outerLoop],8);return buildFrame(F.BIND_V2,b);}
export function parseBindAck(b){if(b.length!==14||b[8]>6)return null;const m=binding(b.subarray(9));if(b[8]===0&&!identity(m))return null;return {boardSession:b.readUInt32LE(0),sequence:b.readUInt32LE(4),result:b[8],...m};}
export const buildChannelQuery=(session,seq)=>buildFrame(F.CHANNEL_QUERY,header(session,seq,8));
export function parseChannelReport(b){
  if(b.length<9||b[8]>8||b.length!==9+5*b[8])return null;
  const items=Array.from({length:b[8]},(_,i)=>binding(b.subarray(9+i*5)));
  if(items.some(m=>!identity(m))||new Set(items.map(m=>m.channelId)).size!==items.length||new Set(items.map(m=>`${m.kind}:${m.canBus}:${m.motorId}`)).size!==items.length)return null;
  return {boardSession:b.readUInt32LE(0),sequence:b.readUInt32LE(4),items};
}
export function buildTestStart(session,seq,c){validateSequence(c);const b=header(session,seq,26);b[8]=c.channelId;b[9]=TEST_MODES.indexOf(c.mode);b.writeFloatLE(c.amplitude,10);b.writeUInt32LE(c.baselineMs,14);b.writeUInt32LE(c.phaseMs,18);b.writeUInt32LE(c.tailMs,22);return buildFrame(F.TEST_START,b);}
export function decodeTestStart(b){if(b.length!==26)return null;return {boardSession:b.readUInt32LE(0),sequence:b.readUInt32LE(4),channelId:b[8],mode:TEST_MODES[b[9]],amplitude:b.readFloatLE(10),baselineMs:b.readUInt32LE(14),phaseMs:b.readUInt32LE(18),tailMs:b.readUInt32LE(22)};}
export const buildTestCancel=(session,seq)=>buildFrame(F.TEST_CANCEL,header(session,seq,8));
export function parseTestAck(b){if(b.length!==18||b[8]>6||![F.TEST_START,F.TEST_CANCEL].includes(b[9]))return null;return {boardSession:b.readUInt32LE(0),sequence:b.readUInt32LE(4),result:b[8],command:b[9],testId:b.readUInt32LE(10),startedAt:b.readUInt32LE(14)};}
export function parseBoardStatus(b){if(b.length!==23||b[8]>10||b[9]>4||(b[10]>7&&b[10]!==255))return null;return {boardSession:b.readUInt32LE(0),boardMs:b.readUInt32LE(4),stopReason:b[8],testState:b[9],channelId:b[10],testId:b.readUInt32LE(11),startedAt:b.readUInt32LE(15),durationMs:b.readUInt32LE(19)};}
export function withTelemetryTime(frame,session,ms){const b=Buffer.concat([frame.subarray(3,-2),Buffer.alloc(8)]);b.writeUInt32LE(session,b.length-8);b.writeUInt32LE(ms>>>0,b.length-4);return buildFrame(F.TELEMETRY,b);}
export function parseTimedTelemetry(b){
  if(b.length<3||b[0]>2)return null;const length=3+b[0]*21;if(b.length!==length&&b.length!==length+8)return null;
  const parsed=parseTelemetry(b);if(b.length===length+8)Object.assign(parsed,{boardSession:b.readUInt32LE(length),boardMs:b.readUInt32LE(length+4)});return parsed;
}
