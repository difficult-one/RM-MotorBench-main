import {test} from 'node:test';
import assert from 'node:assert/strict';
const p=await import('../motor_bench_host/protocol_v2.js').catch(()=>({}));
test('capability handshake and binding request have fixed LE wire identities',()=>{
  assert.equal(typeof p.buildHello,'function');
  assert.deepEqual([...p.buildHello(0x12345678).subarray(3,-2)],[0x78,0x56,0x34,0x12]);
  assert.deepEqual([...p.buildBindV2(1,2,{channelId:3,kind:2,canBus:1,motorId:4,outerLoop:2}).subarray(3,-2)],[1,0,0,0,2,0,0,0,3,2,1,4,2]);
  const body=Buffer.from([2,15,0,0,0,1,0,0,0,232,3,0,0,8,123,0,0,0]);
  assert.deepEqual(p.parseCapabilities(body),{version:2,flags:15,boardSession:1,boardMs:1000,channelMax:8,helloNonce:123});
  assert.equal(p.parseCapabilities(body.subarray(1)),null);assert.throws(()=>p.buildHello(0));
});
test('channel reports reject truncation, duplicates and invalid motor identities',()=>{
  assert.equal(typeof p.parseChannelReport,'function');
  const b=Buffer.from([1,0,0,0,2,0,0,0,1,0,2,1,4,2]);
  assert.equal(p.parseChannelReport(b).items[0].motorId,4);
  assert.equal(p.parseChannelReport(b.subarray(0,-1)),null);
  assert.equal(p.parseChannelReport(Buffer.concat([Buffer.from([1,0,0,0,2,0,0,0,2]),b.subarray(9),b.subarray(9)])),null);
  b[10]=99;assert.equal(p.parseChannelReport(b),null);
});
test('test requests and status carry bounded timing, terminal reason and matching sequence',()=>{
  assert.equal(typeof p.buildTestStart,'function');
  const frame=p.buildTestStart(1,10,{channelId:0,mode:'reversal',amplitude:100,baselineMs:500,phaseMs:1000,tailMs:500});
  assert.equal(frame[2],26);assert.equal(frame[12],2);assert.equal(frame.readFloatLE(13),100);
  assert.throws(()=>p.buildTestStart(1,10,{channelId:0,mode:'step',amplitude:NaN,baselineMs:500,phaseMs:1000,tailMs:500}));
  const status=Buffer.alloc(23);status.writeUInt32LE(1);status.writeUInt32LE(5000,4);status[8]=7;status[9]=2;status[10]=0;status.writeUInt32LE(10,11);status.writeUInt32LE(1000,15);status.writeUInt32LE(4000,19);
  assert.deepEqual(p.parseBoardStatus(status),{boardSession:1,boardMs:5000,stopReason:7,testState:2,channelId:0,testId:10,startedAt:1000,durationMs:4000});
});
