import assert from 'node:assert/strict';
import { test } from 'node:test';
const s=await import('../motor_bench_host/experiment_store.js').catch(()=>({}));
const f=await import('../motor_bench_host/recording_format.js').catch(()=>({}));
const context={session:1,firmware:'1.0',mode:'demo',bindings:[{channelId:0,kind:2,canBus:1,motorId:1,outerLoop:2}],inventory:[],control:{source:0},pidSnapshots:[]};
test('recording has bounded samples and preserves identity, units and mode',()=>{
  assert.equal(typeof s.ExperimentStore,'function');
  const store=new s.ExperimentStore({maxSamples:2,maxRecords:2,maxEvents:2,maxDurationMs:100});
  store.start('转速',context,1000);store.append({channelId:0,online:true,enabled:true,ref:100,speed:98,torque:10,angle:0,temperature:30},context,1001);
  store.append({channelId:0,online:false,ref:0,speed:0},context,1002);
  const record=store.get(store.list()[0].id);assert.equal(record.samples.length,2);assert.equal(record.stopReason,'样本容量已满');
  assert.equal(record.samples[0].speedUnit,'rpm');assert.equal(record.samples[0].motorId,1);assert.equal(record.mode,'demo');
  assert.equal(record.samples[1].online,false);
  store.start('后续',context,2000);store.tick(2101);assert.equal(store.active,null);
  store.start('第三次',context,3000);assert.equal(store.list().length,2);
});
test('CSV keeps context and quotes strings, neutralizing spreadsheet formulas',()=>{
  assert.equal(typeof f.recordCsv,'function');
  const store=new s.ExperimentStore();store.start('=HYPERLINK("x")',context,1000);
  store.append({channelId:0,online:true,enabled:false,ref:0,speed:0,torque:0,angle:0,temperature:30},context,1001);store.stop('完成',1002);
  const record=store.get(store.list()[0].id);const csv=f.recordCsv(record);
  assert.match(csv,/speedUnit/);assert.match(csv,/firmware/);assert.match(csv,/demo/);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/host-receive/);
  assert.deepEqual(f.parseRecording(JSON.stringify(record)).samples[0],record.samples[0]);
  assert.throws(()=>f.parseRecording(JSON.stringify({...record,context:null})),/上下文/);
  assert.throws(()=>f.parseRecording(JSON.stringify({...record,samples:[{...record.samples[0],elapsedMs:5000}]})),/时间/);
});
test('playback is a pure time slice with separate units and no command dependency',()=>{
  assert.equal(typeof f.replayWindow,'function');
  const record={samples:[{elapsedMs:10,channelId:0,speedUnit:'rpm',ref:100,speed:99},{elapsedMs:20,channelId:1,speedUnit:'rad/s',ref:2,speed:1},{elapsedMs:30,channelId:0,speedUnit:'rpm',ref:0,speed:0}]};
  assert.deepEqual(f.replayWindow(record,25,20).map(s=>s.elapsedMs),[10,20]);
  assert.deepEqual(f.groupSpeedUnits(record.samples).map(g=>g.unit),['rpm','rad/s']);
});
test('event capacity closes the recording instead of discarding its experimental beginning',()=>{
  const store=new s.ExperimentStore({maxEvents:2});store.start('事件容量',context,1000);
  store.recordEvent('first',{},1001);store.recordEvent('second',{},1002);store.recordEvent('third',{},1003);
  assert.equal(store.active,null);assert.deepEqual(store.get(store.list()[0].id).events.map(e=>e.message),['first','second']);
  assert.equal(store.list()[0].stopReason,'事件容量已满');
});
test('record imports reject damaged identity, source and receive-time context before plotting',()=>{
  const store=new s.ExperimentStore();store.start('导入校验',context,1000);
  store.append({channelId:0,online:true},context,1001);store.stop('完成',1002);
  const record=store.get(store.list()[0].id),sample=record.samples[0];
  const parse=patch=>f.parseRecording(JSON.stringify({...record,samples:[{...sample,...patch}]}));
  for(const patch of [{kind:{toString:null}},{kind:9},{canBus:0},{motorId:256},{outerLoop:3},{identitySource:'unverified'},{identitySource:'unknown'},{source:{}},{receivedAt:2000}])assert.throws(()=>parse(patch));
  assert.equal(parse({identitySource:'unknown',kind:null,canBus:null,motorId:null,outerLoop:null}).samples[0].identitySource,'unknown');
});
