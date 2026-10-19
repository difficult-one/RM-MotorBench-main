import {test} from 'node:test';import assert from 'node:assert/strict';
const m=await import('../motor_bench_host/test_metrics.js').catch(()=>({}));
function record(){return {context:{test:{channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2,boardSession:1,startedAt:1000,mode:'step',amplitude:100,baselineMs:500,phaseMs:1000,tailMs:500,outcome:'completed'}},samples:Array.from({length:21},(_,i)=>({boardSession:1,boardMs:1000+i*100,channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2,online:true,speed:i<5||i>=15?0:i===5?80:i===6?110:i===7?104:100,ref:i>=5&&i<15?100:0}))};}
test('dynamic metrics use board time and hand-calculated step error, overshoot and settling',()=>{
  assert.equal(typeof m.evaluateTest,'function');const r=m.evaluateTest(record());assert.equal(r.valid,true);assert.equal(r.segments[0].overshootPercent,10);assert.equal(r.segments[0].steadyError,0);assert.equal(r.segments[0].settlingMs,300);assert.equal(r.unit,'rpm');
});
test('metrics refuse gaps, missing tails, invalid identity, host-only time and incomplete execution',()=>{
  assert.equal(typeof m.evaluateTest,'function');
  const mutations=[r=>r.samples.splice(8,1),r=>r.samples.pop(),r=>{r.samples[8].online=false;},r=>{r.samples[8].kind=4;},r=>{delete r.samples[8].boardMs;},r=>{r.context.test.outcome='aborted';},r=>{r.samples[8].boardSession=2;}];
  for(const mutate of mutations){const r=record();mutate(r);assert.equal(m.evaluateTest(r).valid,false);}
});
test('a corrupted middle timestamp cannot disappear when slicing the test time window',()=>{
  const r=record();r.samples=Array.from({length:41},(_,i)=>({...r.samples[Math.floor(i/2)],boardMs:1000+i*50}));
  r.samples[16]={...r.samples[16],boardMs:999,online:false,speed:NaN};
  assert.equal(m.evaluateTest(r).valid,false);
});
test('unstable zero baseline is not accepted as a valid step response',()=>{
  const r=record();r.samples[4].speed=50;assert.equal(m.evaluateTest(r).valid,false);
});
test('reverse response has a signed overshoot and board-clock wrap remains valid',()=>{
  const r=record();r.context.test.mode='reversal';r.samples=Array.from({length:36},(_,i)=>({boardSession:1,boardMs:1000+i*100,channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2,online:true,ref:i>=5&&i<15?100:i>=20&&i<30?-100:0,speed:i>=5&&i<15?100:i===20?-80:i===21?-120:i>=22&&i<30?-100:0}));
  let result=m.evaluateTest(r);assert.equal(result.valid,true);assert.equal(result.segments[1].overshootPercent,20);assert.equal(result.segments[1].settlingMs,200);
  const wrapped=record();wrapped.context.test.startedAt=0xffffffff-499;wrapped.samples.forEach((s,i)=>s.boardMs=(wrapped.context.test.startedAt+i*100)>>>0);result=m.evaluateTest(wrapped);assert.equal(result.valid,true);assert.equal(result.segments[0].settlingMs,300);
});
