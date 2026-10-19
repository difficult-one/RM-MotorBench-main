import assert from 'node:assert/strict';
import { test } from 'node:test';
const f = await import('../motor_bench_host/workspace_formats.js').catch(() => ({}));
const scene = { version:1,type:'motor-bench-scene',name:'台架A',motors:[{kind:2,canBus:1,motorId:1,outerLoop:2,note:'前轮'}],bindings:[{channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2,enable:true,ref:1000}],control:{source:0},enabled:true };
test('scene imports project only stopped configuration and reject duplicate physical identities', () => {
  assert.equal(typeof f.parseScene,'function');
  const parsed = f.parseScene(JSON.stringify(scene));
  assert.equal(parsed.enabled,undefined); assert.equal(parsed.bindings[0].enable,undefined); assert.equal(parsed.bindings[0].ref,undefined);
  assert.throws(()=>f.parseScene(JSON.stringify({...scene,motors:[...scene.motors,...scene.motors]})),/重复/);
  assert.throws(()=>f.parseScene(JSON.stringify({...scene,bindings:[{...scene.bindings[0],channelId:8}]})),/通道/);
  assert.throws(()=>f.parseScene(JSON.stringify({...scene,version:2})),/版本/);
});
test('scene preview names rebindings without dispatching or silently removing unrelated motors', () => {
  assert.equal(typeof f.sceneDiff,'function');
  const diff=f.sceneDiff(f.parseScene(JSON.stringify(scene)),{inventory:[],bindings:[],telemetry:{0:{online:true}}});
  assert.deepEqual(diff.add.map(m=>m.motorId),[1]); assert.deepEqual(diff.unbind,[0]); assert.equal(diff.bind[0].channelId,0);
  assert.equal(diff.remove,undefined);
  const swapped=f.parseScene(JSON.stringify({...scene,motors:[...scene.motors,{kind:2,canBus:1,motorId:2,outerLoop:2}],bindings:[{channelId:0,kind:2,canBus:1,motorId:2,outerLoop:2},{channelId:1,kind:2,canBus:1,motorId:1,outerLoop:2}]}));
  assert.deepEqual(new Set(f.sceneDiff(swapped,{inventory:swapped.motors,bindings:[scene.bindings[0]],telemetry:{}}).unbind),new Set([0]));
});
test('PID presets are named, validated, versioned local drafts', () => {
  assert.equal(typeof f.parsePreset,'function');
  const preset={type:'motor-bench-pid',version:1,name:'低负载',kind:2,loop:0,pid:{Kp:20,Ki:1,Kd:0,MaxOut:15000,IntegralLimit:10000,improve:0}};
  assert.equal(f.parsePreset(JSON.stringify(preset)).pid.Kp,20);
  assert.throws(()=>f.parsePreset(JSON.stringify({...preset,pid:{...preset.pid,Kp:700}})),/Kp/);
  assert.throws(()=>f.parsePreset(JSON.stringify({...preset,name:''})),/名称/);
});
