import {EventEmitter} from 'node:events';
import {withCrc,encodeValue,validateProfile} from './modbus_rtu.js';
import {validatePulseConfig,validatePulseMove} from './stepper_protocol.js';
const f=address=>({address,type:'i32',scale:1,wordOrder:'highFirst'});
const action=(address,value)=>({address,value,type:'u16',scale:1,wordOrder:'highFirst'});
/** Deliberately simulation-only. Never use these addresses with physical motors. */
export const DEMO_STEPPER_PROFILE={version:1,protocol:'modbus-rtu',name:'RS-485 演示 · 模拟数据',source:'内置模拟设备，寄存器不对应任何厂家',verified:true,demoOnly:true,maxRpm:300,maxSteps:1000000,enable:[action(1,1)],disable:[action(1,0)],speed:f(10),position:f(12),speedStart:[action(2,1)],positionStart:[action(2,2)],feedbackSpeed:f(20),feedbackPosition:f(22)};
export class ModbusStepperDemo extends EventEmitter {
  constructor(){super();this.isOpen=true;this.registers=new Map();this.position=0;this.speed=0;this.enabled=false;this.last=Date.now();this.target=null;}
  write(b,callback){
    let reply;
    if(b[1]===3){const now=Date.now(),delta=(now-this.last)*this.speed*200/60000;this.last=now;this.position+=delta;if(this.target!==null&&((this.speed>=0&&this.position>=this.target)||(this.speed<0&&this.position<=this.target))){this.position=this.target;this.speed=0;this.target=null;}
      const count=b.readUInt16BE(4),out=Buffer.alloc(3+count*2);out[0]=b[0];out[1]=3;out[2]=count*2;const words=encodeValue(b.readUInt16BE(2)===20?Math.round(this.speed):Math.round(this.position),f(0));words.slice(0,count).forEach((v,i)=>out.writeUInt16BE(v,3+i*2));reply=withCrc(out);
    }else{
      const address=b.readUInt16BE(2),values=b[1]===6?[b.readUInt16BE(4)]:Array.from({length:b.readUInt16BE(4)},(_,i)=>b.readUInt16BE(7+i*2));values.forEach((v,i)=>this.registers.set(address+i,v));
      if(address===1){this.enabled=!!values[0];if(!this.enabled){this.speed=0;this.target=null;}}
      if(address===2&&this.enabled){const signed=a=>{const n=(this.registers.get(a)??0)*65536+(this.registers.get(a+1)??0);return n>=0x80000000?n-0x100000000:n;};this.speed=signed(10);if(values[0]===2){const steps=signed(12);this.target=this.position+steps;this.speed=Math.abs(this.speed)*Math.sign(steps);}else this.target=null;this.last=Date.now();}
      reply=withCrc(b.subarray(0,6));
    }
    setTimeout(()=>{callback?.();if(this.isOpen)this.emit('data',reply);},2);return true;
  }
  close(callback){this.isOpen=false;this.emit('close');callback?.();}
}
export class PulseDemo {
  constructor(board){this.board=board;this.state={configured:false,enabled:false,running:false,enableHigh:true,invert:false,reason:0,pulsesPerRev:3200,maxHz:10000,rpm:0,position:0,remaining:0};this.last=Date.now();this.fraction=0;}
  stop(reason=1){Object.assign(this.state,{enabled:false,running:false,rpm:0,remaining:0,reason});}
  tick(){const s=this.state,now=Date.now(),delta=(now-this.last)*Math.abs(s.rpm)*s.pulsesPerRev/60000+this.fraction;this.last=now;if(s.running){let count=Math.floor(delta);this.fraction=delta-count;if(this.bounded)count=Math.min(count,s.remaining);s.position+=count*Math.sign(s.rpm);if(this.bounded){s.remaining-=count;if(!s.remaining)Object.assign(s,{running:false,rpm:0,reason:3});}}this.report(0,23,0);}
  report(seq,command,result){const s=this.state,b=Buffer.alloc(33);b.writeUInt32LE(this.board.boardSession);b.writeUInt32LE(seq,4);b[8]=command;b[9]=result;b[10]=+s.configured|(+s.enabled<<1)|(+s.running<<2)|(+s.enableHigh<<3)|(+s.invert<<4);b[11]=s.reason;b.writeUInt32LE(s.pulsesPerRev,12);b.writeUInt32LE(s.maxHz,16);b.writeFloatLE(s.rpm,20);b.writeInt32LE(s.position,24);b.writeUInt32LE(s.remaining,28);this.board.frame(0x95,b);}
  handle(type,b){
    if(type<20||type>23)return false;if(b.length<8)return true;const seq=b.readUInt32LE(4),s=this.state;let result=1;
    if(this.board.boardSession&&b.readUInt32LE()===this.board.boardSession&&seq>this.board.wireSequence){this.board.wireSequence=seq;
      try{
        if(type===23&&b.length===8)result=0;
        else if(type===22&&b.length===9&&b[8]<=1){if(!s.configured)result=3;else{this.stop();s.enabled=!!b[8];result=0;}}
        else if(this.board.test.state===1||this.board.source.source)result=4;
        else if(type===20&&b.length===18){if(s.enabled)result=4;else{Object.assign(s,validatePulseConfig({pulsesPerRev:b.readUInt32LE(8),maxHz:b.readUInt32LE(12),enableHigh:!!b[16],invert:!!b[17]}),{configured:true,reason:5});result=0;}}
        else if(type===21&&b.length===17){if(!s.enabled)result=4;else if(s.running)result=2;else{const c={mode:b[8]===1?'relative':'speed',rpm:b.readFloatLE(9),steps:b.readInt32LE(13)};validatePulseMove(c,s);s.rpm=c.mode==='relative'?Math.sign(c.steps)*c.rpm:c.rpm;s.remaining=c.mode==='relative'?Math.abs(c.steps):0;s.running=s.rpm!==0;s.reason=0;this.bounded=c.mode==='relative';this.last=Date.now();this.fraction=0;result=0;}}
      }catch{result=1;}
    }this.report(seq,type,result);return true;
  }
}
// Validate simulation data at module load so the demo follows production rules.
validateProfile(DEMO_STEPPER_PROFILE);
