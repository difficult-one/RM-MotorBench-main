import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {Rs485Stepper} from '../motor_bench_host/rs485_stepper.js';
import {withCrc} from '../motor_bench_host/modbus_rtu.js';
const field=address=>({address,type:'i32',scale:1,wordOrder:'highFirst'});
export const profile={version:1,protocol:'modbus-rtu',name:'Test fixture',source:'Controlled test fixture, not a vendor profile',verified:true,maxRpm:300,maxSteps:10000,enable:[{address:1,type:'u16',scale:1,wordOrder:'highFirst',value:1}],disable:[{address:1,type:'u16',scale:1,wordOrder:'highFirst',value:0}],speed:field(10),position:field(12),speedStart:[{address:2,type:'u16',scale:1,wordOrder:'highFirst',value:1}],positionStart:[{address:2,type:'u16',scale:1,wordOrder:'highFirst',value:2}],feedbackSpeed:field(20),feedbackPosition:field(22)};
class Port extends EventEmitter{
  constructor(){super();this.isOpen=true;this.writes=[];this.delay=0;}
  write(b,callback){this.writes.push(Buffer.from(b));const reply=b[1]===3?withCrc(Buffer.from([b[0],3,4,0,0,0,0])):withCrc(b.subarray(0,6));setTimeout(()=>{callback?.();if(this.isOpen){this.emit('data',reply.subarray(0,2));this.emit('data',reply.subarray(2));}},this.delay);}
  close(cb){this.isOpen=false;this.emit('close');cb?.();}
}
const config={path:'TEST',baud:115200,slave:1,parity:'none',stopBits:1};
test('opening first disables; motion requires enable; feedback comes from device replies',async()=>{
 const port=new Port(),s=new Rs485Stepper({openPort:async()=>port,pollMs:100000});
 try{await s.open(config,profile);assert.equal(port.writes[0].readUInt16BE(4),0);assert.equal(s.snapshot().stopConfirmed,true);await assert.rejects(s.move({mode:'speed',rpm:30}),/使能/);await s.enable();await s.move({mode:'relative',rpm:30,steps:-120});assert.equal(port.writes.at(-1).readUInt16BE(4),2);assert.equal(s.snapshot().feedbackPosition,0);await s.stop();assert.equal(s.snapshot().commandEnabled,false);}finally{await s.close();}
});
test('emergency cancellation prevents a delayed motion sequence from writing its start register',async()=>{
 const port=new Port(),s=new Rs485Stepper({openPort:async()=>port,pollMs:100000});
 try{await s.open(config,profile);await s.enable();port.delay=30;const before=port.writes.length,motion=s.move({mode:'relative',rpm:30,steps:120});await new Promise(r=>setTimeout(r,5));const stop=s.stop();await assert.rejects(motion,/取消/);await stop;assert.ok(!port.writes.slice(before).some(b=>b.readUInt16BE(2)===2));assert.equal(port.writes.at(-1).readUInt16BE(4),0);}finally{await s.close();}
});
test('corrupt replies fault the session and cannot be followed by new motion',async()=>{
 const port=new Port(),s=new Rs485Stepper({openPort:async()=>port,pollMs:100000});
 await s.open(config,profile);port.write=(b,cb)=>{cb?.();setTimeout(()=>port.emit('data',Buffer.from('0106000100010000','hex')),0);};
 await assert.rejects(s.enable(),/CRC/);assert.equal(s.snapshot().stopConfirmed,false);await assert.rejects(s.enable(),/重新连接/);await s.close();
});
