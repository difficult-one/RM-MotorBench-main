import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {WebSocket} from '../motor_bench_host/node_modules/ws/wrapper.mjs';
import {attachBridge} from '../motor_bench_host/bridge.js';import {evaluateTest} from '../motor_bench_host/test_metrics.js';
import {DemoPort} from '../motor_bench_host/demo_port.js';import {FrameType as F} from '../motor_bench_host/protocol.js';
let dropStartAck=false;const originalFrame=DemoPort.prototype.frame;
DemoPort.prototype.frame=function(type,bytes){if(dropStartAck&&type===F.TEST_ACK&&bytes[9]===F.TEST_START){dropStartAck=false;return;}return originalFrame.call(this,type,bytes);};
const server=http.createServer(),bridge=attachBridge(server,{baud:115200});server.listen(0,'127.0.0.1');await once(server,'listening');
const clients=[];let id=0;
async function until(predicate){const end=Date.now()+7000;while(Date.now()<end){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for V2 service behavior');}
async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/socket`);ws.messages=[];ws.on('message',raw=>ws.messages.push(JSON.parse(raw)));clients.push(ws);await once(ws,'open');ws.keeper=setInterval(()=>ws.send(JSON.stringify({type:'keepAlive'})),200);return ws;}
async function command(ws,cmd,type='commandResult'){const requestId=`v2-${++id}`;ws.send(JSON.stringify({...cmd,requestId}));return until(()=>ws.messages.find(m=>m.requestId===requestId&&(m.type===type||(m.type==='commandResult'&&!m.ok))));}
const cfg={channelId:0,mode:'step',amplitude:300,baselineMs:500,phaseMs:1000,tailMs:500};
try{
  const owner=await connect();assert.equal((await command(owner,{type:'startDemo'})).ok,true);
  const snapshot=(await command(owner,{type:'getSnapshot'})).ok;assert(snapshot);
  const caps=await until(()=>owner.messages.find(m=>m.type==='capabilities'&&(m.data.flags&15)===15));assert.equal(caps.data.version,2);
  await until(()=>owner.messages.find(m=>m.type==='bindings'&&m.data.items.length===5));
  const channels=await command(owner,{type:'queryBindings'},'channelReport');assert.equal(channels.data.items.length,5);
  await until(()=>owner.messages.find(m=>m.type==='telemetry'&&m.data.items.some(s=>s.channelId===0&&s.boardSession===caps.data.boardSession)));
  const idleCancel=await command(owner,{type:'sequenceCancel'},'testAck');assert.equal(idleCancel.type,'testAck','idle cancellation accepts its correlated ACK');assert.equal(idleCancel.data.result,0);
  const started=await command(owner,{type:'sequenceStart',...cfg},'testAck');assert.equal(started.data.result,0);
  assert.equal((await command(owner,{type:'setRef',channelId:0,ref:99})).ok,false);
  const observer=await connect();assert.equal((await command(observer,{type:'sequenceStart',...cfg})).ok,false);
  const ended=await until(()=>owner.messages.find(m=>m.type==='records'&&m.items.some(r=>r.name.includes('自动测试')&&r.endedAt)));
  const record=await command(owner,{type:'recordGet',id:ended.items[0].id},'recordData');assert.equal(record.data.context.test.outcome,'completed');
  assert.equal(record.data.context.test.startedAt,started.data.startedAt);assert(record.data.samples.every(s=>Number.isInteger(s.boardMs)));
  assert.equal(evaluateTest(record.data).valid,true);
  await until(()=>owner.messages.find(m=>m.type==='boardStatus'&&m.data.testState===2&&m.data.stopReason===7));
  const resumed=await command(owner,{type:'sequenceStart',...cfg},'testAck');assert.equal(resumed.data.result,0);
  const taken=await command(observer,{type:'claimControl',takeover:true});assert.equal(taken.ok,true);
  await until(()=>observer.messages.find(m=>m.type==='boardStatus'&&m.data.testId===resumed.data.testId&&m.data.testState===4));
  dropStartAck=true;const offset=observer.messages.length;
  const lostAck=command(observer,{type:'sequenceStart',...cfg,phaseMs:200},'testAck');
  await until(()=>observer.messages.slice(offset).find(m=>m.type==='boardStatus'&&m.data.testState===2));
  const next=await command(observer,{type:'sequenceStart',...cfg,phaseMs:3000},'testAck');assert.equal(next.data.result,0);
  await new Promise(r=>setTimeout(r,1500));
  const latest=observer.messages.filter(m=>m.type==='boardStatus'&&m.data.testId===next.data.testId).at(-1);assert.equal(latest.data.testState,1,'retired missing ACK cannot abort a later test');
  const cancelOffset=observer.messages.length;const canceled=await command(observer,{type:'sequenceCancel'},'testAck');assert.equal(canceled.data.result,0);await lostAck;
  await until(()=>observer.messages.slice(cancelOffset).find(m=>m.type==='telemetry'&&m.data.items.some(s=>s.channelId===0&&!s.enabled)));
  const ramp=await command(observer,{type:'sequenceStart',...cfg,mode:'ramp',amplitude:6000,phaseMs:400},'testAck');assert.equal(ramp.data.result,0);
  const rampDone=await until(()=>observer.messages.find(m=>m.type==='boardStatus'&&m.data.testId===ramp.data.testId&&m.data.testState===2));assert(rampDone);
  await command(observer,{type:'recordList'});const summaries=observer.messages.filter(m=>m.type==='records').at(-1);const rampRecord=await command(observer,{type:'recordGet',id:summaries.items[0].id},'recordData');assert.equal(evaluateTest(rampRecord.data).valid,true,'short ramp uses the same time for target and telemetry');
  console.log('PASS: V2 service negotiation, authoritative channels, bounded test records/metrics, ownership and no resume');
}finally{
  for(const ws of clients){clearInterval(ws.keeper);ws.close();}await bridge.close();server.close();await once(server,'close');
}
