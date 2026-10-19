import {test} from 'node:test';import assert from 'node:assert/strict';
const m=await import('../motor_bench_host/test_sequence.js').catch(()=>({}));
const cfg={channelId:0,mode:'step',amplitude:100,baselineMs:500,phaseMs:1000,tailMs:500};
test('step, ramp and reversal have finite explicit zero tails and completion',()=>{
  assert.equal(typeof m.sequenceTarget,'function');
  assert.equal(m.sequenceTarget(cfg,499),0);assert.equal(m.sequenceTarget(cfg,500),100);assert.equal(m.sequenceTarget(cfg,1500),0);assert.equal(m.sequenceTarget(cfg,2000),null);
  assert.equal(m.sequenceTarget({...cfg,mode:'ramp'},1000),50);assert.equal(m.sequenceTarget({...cfg,mode:'ramp'},1500),100);assert.equal(m.sequenceTarget({...cfg,mode:'ramp'},2500),0);
  const rev={...cfg,mode:'reversal'};assert.equal(m.sequenceTarget(rev,1600),0);assert.equal(m.sequenceTarget(rev,2000),-100);assert.equal(m.sequenceTarget(rev,3000),0);assert.equal(m.sequenceDuration(rev),3500);
});
test('sequence limits depend on motor and reject unsupported loops and invalid timings',()=>{
  assert.equal(typeof m.validateSequence,'function');
  assert.equal(m.validateSequence(cfg,{kind:2,outerLoop:2}).amplitude,100);
  for(const bad of [{amplitude:6001},{phaseMs:30001},{baselineMs:0},{mode:'forever'},{channelId:8}])assert.throws(()=>m.validateSequence({...cfg,...bad},{kind:2,outerLoop:2}));
  assert.throws(()=>m.validateSequence(cfg,{kind:4,outerLoop:2}));assert.throws(()=>m.validateSequence(cfg,{kind:2,outerLoop:4}));
});
