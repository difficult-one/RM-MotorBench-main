import {test} from 'node:test';import assert from 'node:assert/strict';
import {DemoPort} from '../motor_bench_host/demo_port.js';import {FrameParser,FrameType as F} from '../motor_bench_host/protocol.js';import * as v from '../motor_bench_host/protocol_v2.js';import {sequenceTarget} from '../motor_bench_host/test_sequence.js';
test('a clock tick between control and telemetry does not corrupt ramp target timing',async()=>{
  const port=new DemoPort({},()=>{});clearInterval(port.timer);const frames=[],parser=new FrameParser();port.on('data',b=>frames.push(...parser.push(b)));let clock=100;port.ms=()=>clock++;
  try{
    port.write(v.buildHello(123));await new Promise(r=>queueMicrotask(r));const caps=v.parseCapabilities(frames.find(f=>f.type===F.CAPABILITIES).payload);
    const cfg={channelId:0,mode:'ramp',amplitude:6000,baselineMs:500,phaseMs:400,tailMs:500};port.write(v.buildTestStart(caps.boardSession,1,cfg));await new Promise(r=>queueMicrotask(r));
    const ack=v.parseTestAck(frames.find(f=>f.type===F.TEST_ACK).payload);clock=ack.startedAt+700;frames.length=0;port.tickTest();port.telemetry();await new Promise(r=>queueMicrotask(r));
    const data=v.parseTimedTelemetry(frames.find(f=>f.type===F.TELEMETRY).payload);assert.equal(data.items[0].ref,sequenceTarget(cfg,data.boardMs-ack.startedAt));
  }finally{port.close(()=>{});}
});
