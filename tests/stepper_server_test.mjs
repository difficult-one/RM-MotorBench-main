import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {WebSocket} from '../motor_bench_host/node_modules/ws/wrapper.mjs';import {attachBridge} from '../motor_bench_host/bridge.js';
test('real bridge confirms pulse demo, independent RS485 demo, ownership and global stop',async()=>{
 const server=http.createServer(),bridge=attachBridge(server,{baud:115200});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/socket`),reports=[];ws.on('message',b=>reports.push(JSON.parse(b)));
 const wait=async fn=>{const end=Date.now()+4000;while(Date.now()<end){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('report timeout');};
 let seq=0;const send=async command=>{const requestId=`stepper-${++seq}`;ws.send(JSON.stringify({...command,requestId}));const r=await wait(()=>reports.find(r=>r.type==='commandResult'&&r.requestId===requestId&&(!r.ok||r.stage==='service'||r.stage==='board')));assert.equal(r.ok,true,r.message);return r;};
 try{
  await new Promise(r=>ws.once('open',r));await wait(()=>reports.some(r=>r.type==='snapshot'));
  await send({type:'rs485Demo'});await send({type:'rs485Enable'});await send({type:'rs485Move',mode:'speed',rpm:30});
  await send({type:'startDemo'});await wait(()=>reports.some(r=>r.type==='capabilities'&&(r.data.flags&16)));
  await send({type:'pulseConfig',pulsesPerRev:3200,maxHz:10000,enableHigh:true,invert:false});
  await send({type:'pulseEnable',enable:true});await send({type:'pulseMove',mode:'relative',rpm:60,steps:320});
  await wait(()=>reports.some(r=>r.type==='pulseStatus'&&r.data.reason===3&&r.data.position===320));
  await send({type:'stopAll'});await wait(()=>reports.some(r=>r.type==='rs485Status'&&r.data.stopConfirmed&&!r.data.commandEnabled));
  assert.ok(reports.some(r=>r.type==='pulseStatus'&&!r.data.enabled));
  await send({type:'rs485Enable'});await send({type:'rs485Move',mode:'speed',rpm:30});
  ws.send(JSON.stringify({type:'sequenceStart',requestId:'auto-lock',channelId:0,mode:'step',amplitude:100,baselineMs:500,phaseMs:3000,tailMs:500}));
  await wait(()=>reports.find(r=>r.type==='testAck'&&r.requestId==='auto-lock'&&r.data.result===0));
  await send({type:'rs485Stop'});await send({type:'rs485Close'});
 }finally{ws.close();await bridge.close();await new Promise(r=>server.close(r));}
});
