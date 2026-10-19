import { EventEmitter } from 'node:events';
import { FrameParser, FrameType as F, PID_DEFAULTS, buildFrame, buildHeartbeatAck, buildTelemetry } from './protocol.js';
import {randomBytes} from 'node:crypto';
import {withTelemetryTime,decodeTestStart} from './protocol_v2.js';
import {validateSequence,sequenceDuration,sequenceTarget} from './test_sequence.js';
import {PulseDemo} from './stepper_demo.js';
/** An in-process protocol peer; never imports serialport or accesses hardware. */
export class DemoPort extends EventEmitter {
  constructor(_options, callback) {
    super();this.isOpen=true;this.parser=new FrameParser();this.startedAt=Date.now();
    this.motors=[...Array.from({length:4},(_,i)=>({kind:2,canBus:2,motorId:i+1,outerLoop:2})),{kind:4,canBus:1,motorId:1,outerLoop:2}];
    this.initialBindings=this.motors.map((m,channelId)=>({...m,channelId}));
    this.channels=new Map(this.initialBindings.map(b=>[b.channelId,{...b,enabled:false,ref:0,speed:0,pids:structuredClone(PID_DEFAULTS[b.kind])}]));
    this.source={source:0,channelId:0,maxRef:0,channels:[0,1,2,3],reverseMask:0};
    this.boardSession=0;this.helloNonce=0;this.wireSequence=0;this.test={state:0,channelId:255,testId:0,startedAt:0,durationMs:0};this.stopReason=0;
    this.pulse=new PulseDemo(this);
    queueMicrotask(()=>callback(null));this.timer=setInterval(()=>{this.tickTest();this.telemetry();this.control();this.status();this.pulse.tick();},20);
  }
  frame(type,bytes){queueMicrotask(()=>{if(this.isOpen)this.emit('data',buildFrame(type,bytes));});}
  telemetry(){
    const sampledAt=this.ms();this.tickTest(sampledAt);
    const items=[...this.channels.values()].map(c=>{
      c.speed+=(c.enabled?c.ref-c.speed:-c.speed)*0.15;
      return {channelId:c.channelId,online:true,enabled:c.enabled,ref:c.ref,speed:c.speed,torque:c.enabled?Math.abs(c.ref-c.speed)*0.01:0,angle:0,temperature:28};
    });
    for(let i=0;i<items.length;i+=2){const frame=withTelemetryTime(buildTelemetry(items.slice(i,i+2)),this.boardSession,sampledAt);queueMicrotask(()=>{if(this.isOpen)this.emit('data',frame);});}
  }
  ms(){return (Date.now()-this.startedAt)>>>0;}
  status(){const t=this.test,b=Buffer.alloc(23);b.writeUInt32LE(this.boardSession);b.writeUInt32LE(this.ms(),4);b[8]=this.stopReason;b[9]=t.state;b[10]=t.channelId;b.writeUInt32LE(t.testId,11);b.writeUInt32LE(t.startedAt,15);b.writeUInt32LE(t.durationMs,19);this.frame(F.BOARD_STATUS,b);}
  halt(reason,state){this.pulse?.stop(reason===2?2:1);for(const c of this.channels.values()){c.enabled=false;c.ref=0;}this.stopReason=reason;if(this.test.state===1)this.test.state=state??4;this.status();}
  tickTest(now=this.ms()){if(this.test.state!==1)return;const c=this.channels.get(this.test.channelId);if(!c?.enabled){this.halt(6);return;}const ref=sequenceTarget(this.test.config,(now-this.test.startedAt)>>>0);if(ref===null)this.halt(7,2);else c.ref=ref;}
  v2(type,b){
    if(type<F.HELLO||type>F.TEST_CANCEL)return false;
    if(type===F.HELLO){
      if(b.length!==4||!b.readUInt32LE())return true;const nonce=b.readUInt32LE();
      if(nonce!==this.helloNonce||!this.boardSession){this.halt(9);this.boardSession=randomBytes(4).readUInt32LE()||1;this.helloNonce=nonce;this.wireSequence=0;}
      const out=Buffer.alloc(18);out[0]=2;out.writeUInt32LE(31,1);out.writeUInt32LE(this.boardSession,5);out.writeUInt32LE(this.ms(),9);out[13]=8;out.writeUInt32LE(nonce,14);this.frame(F.CAPABILITIES,out);this.status();return true;
    }
    if(b.length<8)return true;const seq=b.readUInt32LE(4);let result=1;
    if(b.readUInt32LE()===this.boardSession&&this.boardSession&&seq>this.wireSequence){
      this.wireSequence=seq;
      if(type===F.CHANNEL_QUERY&&b.length===8){const out=Buffer.alloc(9+this.channels.size*5);out.writeUInt32LE(this.boardSession);out.writeUInt32LE(seq,4);out[8]=this.channels.size;[...this.channels.values()].forEach((c,i)=>out.set([c.channelId,c.kind,c.canBus,c.motorId,c.outerLoop],9+i*5));this.frame(F.CHANNEL_REPORT,out);return true;}
      if(type===F.BIND_V2&&b.length===13){
        const c={channelId:b[8],kind:b[9],canBus:b[10],motorId:b[11],outerLoop:b[12]};
        const motor=this.motors.find(m=>m.kind===c.kind&&m.canBus===c.canBus&&m.motorId===c.motorId);
        if(motor&&c.channelId<8&&(c.kind===4?[2]:[0,1,2,4]).includes(c.outerLoop)){
          if(this.test.state===1)this.halt(5);
          result=this.channels.has(c.channelId)||[...this.channels.values()].some(m=>m.kind===c.kind&&m.canBus===c.canBus&&m.motorId===c.motorId)?2:0;
          if(!result)this.channels.set(c.channelId,{...c,enabled:false,ref:0,speed:0,pids:structuredClone(PID_DEFAULTS[c.kind])});
        }
      }
      if(type===F.TEST_START){try{
        const cfg=decodeTestStart(b),c=this.channels.get(cfg?.channelId);validateSequence(cfg,c??{});
        if(this.pulse.state.enabled||this.test.state===1||this.source.source!==0||[...this.channels.values()].some(c=>c.enabled))result=4;
        else{c.enabled=true;c.ref=0;this.test={state:1,channelId:c.channelId,testId:seq,startedAt:this.ms(),durationMs:sequenceDuration(cfg),config:cfg};result=0;}
      }catch{result=1;}}
      if(type===F.TEST_CANCEL&&b.length===8){if(this.test.state===1)this.halt(8,3);result=0;}
    }
    if(type===F.BIND_V2){const out=Buffer.alloc(14);out.writeUInt32LE(this.boardSession);out.writeUInt32LE(seq,4);out[8]=result;if(b.length>=13)b.copy(out,9,8,13);this.frame(F.BIND_ACK,out);}
    if(type===F.TEST_START||type===F.TEST_CANCEL){const out=Buffer.alloc(18);out.writeUInt32LE(this.boardSession);out.writeUInt32LE(seq,4);out[8]=result;out[9]=type;out.writeUInt32LE(this.test.testId,10);out.writeUInt32LE(this.test.startedAt,14);this.frame(F.TEST_ACK,out);}
    this.status();return true;
  }
  control(result=0){const s=this.source,b=Buffer.alloc(s.source>=2?21:12);b[0]=result;b[1]=s.source;b[2]=s.channelId;b[3]=b[4]=b[5]=1;b.writeFloatLE(s.maxRef,8);if(b.length===21){s.channels.forEach((id,i)=>b[12+i]=id);b[16]=s.reverseMask;}this.frame(F.CONTROL_REPORT,b);}
  write(bytes,callback){
    for(const {type,payload:b} of this.parser.push(bytes)){
      if(this.pulse.handle(type,b))continue;
      if(this.v2(type,b))continue;
      if(this.test.state===1&&![F.HEARTBEAT,F.QUERY,F.INVENTORY_QUERY,F.PID_QUERY].includes(type))this.halt(type===F.ALL_STOP?1:type===F.MOTOR_ENABLE?6:5);
      if(type===F.HEARTBEAT)queueMicrotask(()=>{if(this.isOpen)this.emit('data',buildHeartbeatAck({fwMinor:3,inventory:this.motors.length,uptime:Math.floor((Date.now()-this.startedAt)/1000)}));});
      if(type===F.INVENTORY_QUERY)this.frame(F.INVENTORY_REPORT,Buffer.from([this.motors.length,...this.motors.flatMap(m=>[m.kind,m.canBus,m.motorId,m.outerLoop])]));
      if(type===F.QUERY){this.control();this.telemetry();}
      if(type===F.MOTOR_ADD||type===F.MOTOR_REMOVE){
        if(type===F.MOTOR_ADD)this.motors.push({kind:b[0],canBus:b[1],motorId:b[2],outerLoop:2});
        else{this.motors=this.motors.filter(m=>m.kind!==b[0]||m.canBus!==b[1]||m.motorId!==b[2]);for(const[id,c]of this.channels)if(c.kind===b[0]&&c.canBus===b[1]&&c.motorId===b[2])this.channels.delete(id);}
        this.frame(F.MOTOR_ADD_ACK,Buffer.from([0,b[0],b[1],b[2],255,8-this.motors.length]));
      }
      if(type===F.MOTOR_BIND&&!this.channels.has(b[0]))this.channels.set(b[0],{channelId:b[0],kind:b[1],canBus:b[2],motorId:b[3],outerLoop:b[4],enabled:false,ref:0,speed:0,pids:structuredClone(PID_DEFAULTS[b[1]])});
      if(type===F.MOTOR_UNBIND)this.frame(F.UNBIND_ACK,Buffer.from([b[1],this.channels.delete(b[1])?0:1]));
      if(type===F.MOTOR_ENABLE&&this.channels.has(b[0])){const c=this.channels.get(b[0]);c.enabled=!!b[1];c.ref=0;}
      if(type===F.MOTOR_SET&&this.channels.get(b[0])?.enabled)this.channels.get(b[0]).ref=b.readFloatLE(1);
      if(type===F.ALL_STOP)this.halt(1);
      if(type===F.CONTROL_SOURCE){this.source=b[0]>=2?{source:b[0],channelId:255,channels:[...b.subarray(1,5)],reverseMask:b[5],maxRef:b.readFloatLE(6)}:{...this.source,source:b[0],channelId:b[1],maxRef:b.readFloatLE(2)};this.control();}
      if(type===F.CHASSIS_ENABLE){for(const id of this.source.channels){const c=this.channels.get(id);if(c){c.enabled=!!b[0];c.ref=0;}}this.control();}
      if(type===F.PID_QUERY){const c=this.channels.get(b[3]);if(!c)continue;const out=Buffer.alloc(49);out[0]=b[3];out[1]=c.kind;['speed','current','angle'].forEach((name,i)=>{const v=c.pids[name];out.writeUInt16LE(Math.round(v.Kp*100),4+i*2);out.writeUInt16LE(Math.round(v.Ki*100),10+i*2);out.writeUInt16LE(Math.round(v.Kd*100),16+i*2);out.writeInt32LE(v.MaxOut,22+i*4);out.writeInt32LE(v.IntegralLimit,34+i*4);out[46+i]=v.improve;});this.frame(F.PID_REPORT,out);}
      if(type===F.PID_SET){const c=this.channels.get(b[0]);if(!c)continue;c.enabled=false;c.ref=0;c.pids[['speed','current','angle'][b[1]]]={Kp:b.readUInt16LE(4)/100,Ki:b.readUInt16LE(6)/100,Kd:b.readUInt16LE(8)/100,MaxOut:b.readInt32LE(10),IntegralLimit:b.readInt32LE(14),improve:b[2]};this.frame(F.PID_SET_ACK,Buffer.from([b[0],b[1],0,0]));}
    }
    callback?.();return true;
  }
  drain(callback){callback();}
  close(callback){clearInterval(this.timer);this.isOpen=false;this.emit('close');callback?.();}
}
