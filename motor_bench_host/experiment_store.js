import { randomUUID } from 'node:crypto';
import { targetSpec } from './motor_rules.js';
import { textField } from './workspace_formats.js';
export class ExperimentStore {
  constructor({maxRecords=5,maxSamples=60000,maxEvents=1000,maxDurationMs=600000,onStop=()=>{}}={}) {
    Object.assign(this,{maxRecords,maxSamples,maxEvents,maxDurationMs,onStop});this.records=[];this.active=null;
  }
  start(name,context,now=Date.now()) {
    if(this.active)throw Error('已有记录正在采集');textField(name,'记录名称');
    const r={id:randomUUID(),type:'motor-bench-recording',version:1,name,notes:'',mode:context.mode,timeBasis:'host-receive',startedAt:now,endedAt:null,stopReason:'',context:structuredClone(context),samples:[],events:[]};
    this.records.push(r);while(this.records.length>this.maxRecords)this.records.shift();this.active=r;return r.id;
  }
  append(item,context,now=Date.now()) {
    if(!this.active)return;this.tick(now);if(!this.active)return;
    const b=context.bindings.find(b=>b.channelId===item.channelId), r=this.active;
    const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
    r.samples.push({elapsedMs:now-r.startedAt,receivedAt:now,channelId:item.channelId,kind:b?.kind??null,canBus:b?.canBus??null,motorId:b?.motorId??null,outerLoop:b?.outerLoop??null,
      identitySource:!b?'unknown':b.identified?'user':'confirmed',targetUnit:b?targetSpec(b.kind,b.outerLoop).unit:'待确认',speedUnit:b?(b.kind===4?'rad/s':'rpm'):'待确认',torqueUnit:!b?'待确认':b.kind===4?'协议映射量·未校准':'电流原始量',source:context.control?.source??null,
      boardMs:item.boardMs??null,boardSession:item.boardSession??null,
      online:!!item.online,enabled:!!item.enabled,ref:number(item.ref),speed:number(item.speed),torque:number(item.torque),angle:number(item.angle),temperature:number(item.temperature)});
    if(r.samples.length>=this.maxSamples)this.stop('样本容量已满',now);
  }
  recordEvent(message,data={},now=Date.now()) {if(!this.active)return;const r=this.active;r.events.push({elapsedMs:Math.max(0,now-r.startedAt),message,data:structuredClone(data)});if(r.events.length>=this.maxEvents)this.stop('事件容量已满',now);}
  tick(now=Date.now()){if(this.active&&now-this.active.startedAt>=this.maxDurationMs)this.stop('记录时长已达上限',now);}
  stop(reason='用户停止记录',now=Date.now()){if(!this.active)return;this.active.endedAt=now;this.active.stopReason=reason;this.active=null;this.onStop();}
  list(){return this.records.map(r=>({id:r.id,name:r.name,notes:r.notes,mode:r.mode,startedAt:r.startedAt,endedAt:r.endedAt,samples:r.samples.length,events:r.events.length,stopReason:r.stopReason})).reverse();}
  get(id){const r=this.records.find(r=>r.id===id);if(!r)throw Error('记录不存在或已因容量限制移出');return r;}
  update(id,name,notes){const r=this.get(id);r.name=textField(name,'记录名称');r.notes=textField(notes,'备注',1000,true);}
  remove(id){if(this.active?.id===id)throw Error('请先结束记录再删除');this.get(id);this.records=this.records.filter(r=>r.id!==id);}
}
