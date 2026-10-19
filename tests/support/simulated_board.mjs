// Browser regression fixture only. The serialport package is replaced before the bridge loads.
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { FrameParser, FrameType as F, PID_DEFAULTS, buildFrame, buildTelemetry, buildHeartbeatAck } from '../../motor_bench_host/protocol.js';
const motors = [], channels = new Map();
let source = { source: 0, channelId: 0, maxRef: 0, channels: [0,1,2,3], reverseMask: 0 };
class SimulatedPort extends EventEmitter {
  static async list() { return [{ path: 'REGRESSION_ONLY', manufacturer: '模拟串口 · 无硬件' }]; }
  constructor(options, callback) {
    super(); if (options.path !== 'REGRESSION_ONLY') throw Error('Test fixture refuses physical serial paths');
    this.isOpen = true; this.parser = new FrameParser();
    queueMicrotask(() => callback(null));
    this.timer = setInterval(() => this.telemetry(), 50);
  }
  frame(type, bytes) { setImmediate(() => { if (this.isOpen) this.emit('data', buildFrame(type, bytes)); }); }
  telemetry() {
    const items = [...channels.values()].map(c => ({ channelId: c.channelId, enabled: c.enabled, online: true, ref: c.ref, speed: c.enabled ? c.ref * 0.98 : 0, torque: 12, angle: 45, temperature: 32 }));
    for (let i = 0; i < items.length; i += 2) setImmediate(() => { if (this.isOpen) this.emit('data', buildTelemetry(items.slice(i,i+2))); });
  }
  control(result = 0) {
    const bytes = Buffer.alloc(source.source >= 2 ? 21 : 12); bytes[0] = result; bytes[1] = source.source; bytes[2] = source.channelId;
    bytes[3] = bytes[4] = bytes[5] = 1; bytes.writeFloatLE(source.maxRef,8);
    if (bytes.length === 21) { source.channels.forEach((id,i) => bytes[12+i] = id); bytes[16] = source.reverseMask; }
    this.frame(F.CONTROL_REPORT, bytes);
  }
  write(bytes, callback) {
    for (const { type, payload: b } of this.parser.push(bytes)) {
      if (type === F.HEARTBEAT) setImmediate(() => { if (this.isOpen) this.emit('data', buildHeartbeatAck({ inventory: motors.length })); });
      if (type === F.QUERY) { this.control(); this.telemetry(); }
      if (type === F.INVENTORY_QUERY) this.frame(F.INVENTORY_REPORT, Buffer.from([motors.length, ...motors.flatMap(m => [m.kind,m.canBus,m.motorId,2])]));
      if (type === F.MOTOR_ADD || type === F.MOTOR_REMOVE) {
        if (type === F.MOTOR_ADD) motors.push({ kind: b[0],canBus:b[1],motorId:b[2] });
        else { const index = motors.findIndex(m => m.kind === b[0] && m.canBus === b[1] && m.motorId === b[2]); if(index >= 0) motors.splice(index,1); for(const [id,c] of channels) if(c.kind===b[0]&&c.canBus===b[1]&&c.motorId===b[2]) channels.delete(id); }
        this.frame(F.MOTOR_ADD_ACK, Buffer.from([0,b[0],b[1],b[2],255,10]));
      }
      if (type === F.MOTOR_BIND) { if(!channels.has(b[0])) channels.set(b[0],{channelId:b[0],kind:b[1],canBus:b[2],motorId:b[3],outerLoop:b[4],enabled:false,ref:0,pids:structuredClone(PID_DEFAULTS[b[1]])}); this.telemetry(); }
      if (type === F.MOTOR_UNBIND) { const ok = channels.delete(b[1]); this.frame(F.UNBIND_ACK,Buffer.from([b[1],ok?0:1])); }
      if (type === F.MOTOR_ENABLE && channels.has(b[0])) { channels.get(b[0]).enabled=!!b[1]; channels.get(b[0]).ref=0; this.telemetry(); }
      if (type === F.MOTOR_SET && channels.has(b[0])) { channels.get(b[0]).ref=b.readFloatLE(1); this.telemetry(); }
      if (type === F.ALL_STOP) { for(const c of channels.values()) {c.enabled=false;c.ref=0;} this.telemetry(); }
      if (type === F.CONTROL_SOURCE) {
        source = b[0]>=2 ? {source:b[0],channelId:255,channels:[...b.subarray(1,5)],maxRef:b.readFloatLE(6),reverseMask:b[5]}
          : {...source,source:b[0],channelId:b[1],maxRef:b.readFloatLE(2)};
        this.control();
      }
      if (type === F.PID_QUERY) {
        const c=channels.get(b[3]); if(!c) continue; const bytes=Buffer.alloc(49); bytes[0]=b[3];bytes[1]=c.kind;
        ['speed','current','angle'].forEach((loop,i)=>{ const v=c.pids[loop];bytes.writeUInt16LE(Math.round(v.Kp*100),4+i*2);bytes.writeUInt16LE(Math.round(v.Ki*100),10+i*2);bytes.writeUInt16LE(Math.round(v.Kd*100),16+i*2);bytes.writeInt32LE(v.MaxOut,22+i*4);bytes.writeInt32LE(v.IntegralLimit,34+i*4);bytes[46+i]=v.improve; });
        this.frame(F.PID_REPORT,bytes);
      }
      if (type === F.PID_SET) {const c=channels.get(b[0]); if(!c)continue;c.enabled=false;c.ref=0;c.pids[['speed','current','angle'][b[1]]]={Kp:b.readUInt16LE(4)/100,Ki:b.readUInt16LE(6)/100,Kd:b.readUInt16LE(8)/100,MaxOut:b.readInt32LE(10),IntegralLimit:b.readInt32LE(14),improve:b[2]};this.frame(F.PID_SET_ACK,Buffer.from([b[0],b[1],0,0]));this.telemetry();}
    }
    callback?.(); return true;
  }
  drain(callback) { callback(); }
  close(callback) { clearInterval(this.timer);this.isOpen=false;this.emit('close');callback?.(); }
}
globalThis.__workbenchSerial = SimulatedPort;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(s,c,n){if(s==='serialport')return {url:'data:text/javascript,export const SerialPort=globalThis.__workbenchSerial;',shortCircuit:true};return n(s,c);}`)}`);
