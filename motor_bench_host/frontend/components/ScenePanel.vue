<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Bench } from '../bench';
import { parseScene, sceneDiff } from '../../workspace_formats.js';
import { motorLabel,motorKey } from '../../motor_rules.js';
import { LoopLabel } from '../../shared.js';
import { loadLibrary,saveLibrary,downloadFile,readFile,waitUntil } from '../workspace_storage';
const props=defineProps<{bench:Bench}>(), state=props.bench.state;
const key='motor-bench:scenes:v1',stored=loadLibrary(key,parseScene);
const items=ref<any[]>(stored.items),message=ref(stored.warning),name=ref('台架配置'),selected=ref(-1),preview=ref<any>(null),applying=ref(false);
const diff=computed(()=>preview.value?sceneDiff(preview.value,state):null);
const unbinding=computed<number[]>(()=>diff.value?[...new Set<number>([...diff.value.unbind,...diff.value.bind.map((b:any)=>b.channelId)])]:[]);
const previewRows=computed(()=>!preview.value?[]:[...new Set<number>([...preview.value.bindings.map((b:any)=>b.channelId),...unbinding.value])].sort((a,b)=>a-b).map(channelId=>({channelId,target:preview.value.bindings.find((b:any)=>b.channelId===channelId)})));
function save(scene:any){const parsed=parseScene(JSON.stringify(scene));const list=[...items.value];const index=list.findIndex(s=>s.name===parsed.name);if(index>=0)list[index]=parsed;else list.push(parsed);saveLibrary(key,list);items.value=list;selected.value=list.findIndex(s=>s.name===parsed.name);return parsed;}
function perform(fn:()=>void){try{fn();}catch(error){message.value=(error as Error).message;}}
function choose(){preview.value=items.value[selected.value]??null;if(preview.value)name.value=preview.value.name;}
function describeBinding(channelId:number){const b=state.bindings.find(b=>b.channelId===channelId);return b?`${motorLabel(b)} / ${LoopLabel[b.outerLoop as keyof typeof LoopLabel]}`:'空闲或身份未知';}
function capture(){perform(()=>{const motors=state.inventory.map(m=>{let note='';try{note=localStorage.getItem(`motor-bench:name:${motorKey(m)}`)??'';}catch{/* optional */}return {...m,note};});preview.value=save({type:'motor-bench-scene',version:1,name:name.value,motors,bindings:state.bindings,control:state.control??{source:0}});message.value='已保存配置；不包含运行使能、目标和板端PID写入';});}
async function imported(event:Event){try{const text=await readFile(event);if(!text)return;preview.value=parseScene(text);selected.value=-1;name.value=preview.value.name;message.value='已读取文件，仅预览；点击保存或应用后才执行对应操作';}catch(error){message.value=(error as Error).message;}}
async function apply(){
  if(!preview.value||!diff.value||diff.value.conflicts.length)return;
  const scene=preview.value,plan=diff.value,session=state.session;applying.value=true;state.busy=true;
  const check=()=>{if(state.session!==session||!props.bench.writable.value)throw Error('会话或控制权改变，配置应用已中止');};
  try{
    check();const stoppedAt=Date.now(),ids=Object.keys(state.telemetry).map(Number);
    await props.bench.command({type:'stopAll'});
    if(ids.length)await waitUntil(()=>ids.every(id=>!state.telemetry[id]||(!state.telemetry[id].enabled&&(state.telemetry[id].receivedAt??0)>=stoppedAt)));
    // Explicit unbind also proves a previously unknown channel free in the legacy protocol.
    for(const id of new Set([...plan.unbind,...plan.bind.map((b:any)=>b.channelId)])){check();await props.bench.command({type:'unbind',channelId:id},'unbindAck');}
    for(const m of plan.add){check();await props.bench.command({type:'addMotor',kind:m.kind,canBus:m.canBus,motorId:m.motorId},'motorAck');}
    check();await props.bench.command({type:'scanMotors'});await waitUntil(()=>scene.motors.every((m:any)=>state.inventory.some(p=>motorKey(p)===motorKey(m))));
    for(const b of plan.bind){check();await props.bench.command({type:'bind',...b});await waitUntil(()=>state.bindings.some(p=>!p.identified&&p.channelId===b.channelId&&motorKey(p)===motorKey(b)&&p.outerLoop===b.outerLoop));}
    check();await props.bench.command({type:'controlSource',...scene.control},'controlReport');
    for(const m of scene.motors)try{localStorage.setItem(`motor-bench:name:${motorKey(m)}`,m.note);}catch{/* optional */}
    message.value='配置应用完成。电机保持停机，运行需要另行使能；PID模板不会自动写入板端。';
  }catch(error){message.value=`${(error as Error).message}。已完成的登记或绑定不会自动回滚，请核对板端状态。`;}
  finally{applying.value=false;state.busy=false;}
}
</script>
<template>
  <section class="scene-panel"><div class="section-head"><div><h2>场景配置</h2><p class="subtle">保存登记清单、通道、控制来源及备注，换台架时先预览差异。</p></div><span class="badge">{{ items.length }} / 20 本地模板</span></div>
    <div class="template-toolbar"><label>配置名称<input v-model="name" maxlength="80"/></label><button class="quiet" :disabled="!state.inventoryKnown" @click="capture">保存当前配置</button><label class="file-button">导入配置 JSON<input type="file" accept=".json,application/json" @change="imported"/></label></div>
    <div v-if="items.length" class="template-toolbar"><label>本地场景<select v-model.number="selected" @change="choose"><option :value="-1">选择场景</option><option v-for="(item,index) in items" :key="item.name" :value="index">{{ item.name }}</option></select></label><button class="quiet" :disabled="selected<0" @click="perform(()=>{preview=save({...items[selected],name:name+' 副本'});name=preview.name})">复制场景</button><button class="quiet" :disabled="selected<0" @click="perform(()=>{const list=items.filter((_,index)=>index!==selected);saveLibrary(key,list);items=list;selected=-1;preview=null})">删除本地场景</button></div>
    <div v-if="preview && diff" class="config-preview"><h3>预览：{{ preview.name }}</h3><p class="subtle">{{ preview.motors.length }} 颗电机 / {{ preview.bindings.length }} 通道。应用先全停；保留未列出的其他登记，不写运行目标或PID。</p><ul><li v-for="m in preview.motors" :key="motorKey(m)">{{ motorLabel(m) }}{{ m.note?` · ${m.note}`:'' }}</li></ul><table class="scene-binding-table"><thead><tr><th>通道</th><th>当前身份</th><th>应用后的身份与环</th></tr></thead><tbody><tr v-for="row in previewRows" :key="row.channelId"><td>{{ row.channelId }}</td><td>{{ describeBinding(row.channelId) }}</td><td><template v-if="row.target">{{ motorLabel(row.target) }} / {{ LoopLabel[row.target.outerLoop as keyof typeof LoopLabel] }}</template><span v-else class="warning">解绑后空闲</span></td></tr></tbody></table><p>控制来源：{{ ["网页控制","单电机遥控","麦克纳姆底盘","四轮全向底盘"][preview.control.source] }}<span v-if="preview.control.source"> · 限幅 {{ preview.control.maxRef }}<span v-if="preview.control.source===1"> · 通道 {{ preview.control.channelId }}</span><span v-else> · FL/FR/RL/RR：{{ preview.control.channels.join(" / ") }} · 反向位掩码 {{ preview.control.reverseMask }}</span></span></p><p>新增登记 {{ diff.add.length }} 颗，绑定 {{ diff.bind.map((b:any)=>b.channelId).join('、') || '无变化' }}；应用时先解绑通道 {{ unbinding.join("、") || "无" }}，再按表绑定。</p><p v-for="conflict in diff.conflicts" :key="conflict" class="warning">{{ conflict }}。请先在设备页处理冲突后重新预览。</p><div class="run-actions"><button class="quiet" @click="perform(()=>{preview=save({...preview,name})})">保存预览到模板库</button><button class="quiet" @click="downloadFile('motor-bench-scene.json',JSON.stringify(preview,null,2))">导出配置 JSON</button><button class="primary" :disabled="!bench.writable.value || state.busy || !!diff.conflicts.length || applying" @click="apply">{{ applying?'正在应用…':'全停并应用登记与绑定' }}</button></div></div>
    <p v-if="message" class="warning" role="status">{{ message }}</p>
  </section>
</template>
