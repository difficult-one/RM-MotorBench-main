import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCommand } from '../motor_bench_host/command_validation.js';
const now = Date.now();
const context = {
  inventory: [{kind:2,canBus:1,motorId:1,outerLoop:2}],
  bindings: [{channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2}],
  telemetry: new Map([[0,{channelId:0,online:true,enabled:true,receivedAt:now-2000}]]),
  control: {source:0,channelId:0},
};
test('fresh board heartbeats do not authorize control from expired motor telemetry', () => {
  assert.throws(() => validateCommand({type:'enable',channelId:0,enable:true}, context), /反馈/);
  assert.throws(() => validateCommand({type:'setRef',channelId:0,ref:100}, context), /反馈/);
});
test('a stop remains available with expired motor feedback', () => {
  assert.doesNotThrow(() => validateCommand({type:'enable',channelId:0,enable:false}, context));
});
