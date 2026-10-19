<script setup lang="ts">
import {computed,onUnmounted,ref} from 'vue';
import type {Bench} from '../bench';
import {parseRecording,recordCsv,replayWindow} from '../../recording_format.js';
import {downloadFile,readFile} from '../workspace_storage';
import TracePlot from './TracePlot.vue';
import TestResults from './TestResults.vue';
const props=defineProps<{bench:Bench}>(),state=props.bench.state;
const name=ref('转速测试'),message=ref(''),record=ref<any>(null),position=ref(0),windowSeconds=ref(10),playing=ref(false),note=ref(''),title=ref('');
const origin=ref<'service'|'file'>('file');
const duration=computed(()=>record.value?Math.max(0,record.value.endedAt-record.value.startedAt):0);
const samples=computed(()=>record.value?replayWindow(record.value,position.value,windowSeconds.value*1000).filter((s:any)=>s.outerLoop===2):[]);
const events=computed(()=>record.value?.events.filter((e:any)=>e.elapsedMs<=position.value).slice(-20).reverse()??[]);
function view(value:any,source:'service'|'file'){record.value=parseRecording(JSON.stringify(value));origin.value=source;position.value=0;playing.value=false;note.value=record.value.notes;title.value=record.value.name;}
async function load(id:string){try{const report=await props.bench.command({type:'recordGet',id},'recordData');view(report.data,'service');message.value='正在只读回放，回放操作不发送电机控制指令';}catch(error){message.value=(error as Error).message;}}
async function imported(event:Event){try{const text=await readFile(event,25000000);if(text){view(parseRecording(text),'file');message.value='已导入离线记录，仅本页回放，不写入服务记录库';}}catch(error){message.value=(error as Error).message;}}
async function saveNote(){try{const updated=parseRecording(JSON.stringify({...record.value,name:title.value,notes:note.value}));if(origin.value==='service')await props.bench.command({type:'recordUpdate',id:updated.id,name:title.value,notes:note.value});record.value=updated;message.value=origin.value==='file'?'已保存本页名称和备注，请导出 JSON 保留':'已保存名称和备注';}catch(error){message.value=(error as Error).message;}}
const timer=setInterval(()=>{if(playing.value){position.value=Math.min(duration.value,position.value+100);if(position.value>=duration.value)playing.value=false;}},100);onUnmounted(()=>clearInterval(timer));
</script>
<template>
  <section class="records-panel"><div class="section-head"><div><h1>测试记录</h1><p class="subtle">记录主机接收数据和操作上下文，离线回放只读。</p></div><span v-if="state.activeRecordingId" class="badge warning">正在记录</span></div>
    <div class="template-toolbar"><label>实验名称<input v-model="name" maxlength="80"/></label><button class="primary" :disabled="!bench.writable.value||!!state.activeRecordingId||state.busy" @click="bench.act({type:'recordStart',name})">开始记录</button><button class="quiet" :disabled="!state.activeRecordingId||!state.isController||state.busy" @click="bench.act({type:'recordStop'})">结束记录</button><label class="file-button">导入记录 JSON<input type="file" accept=".json,application/json" @change="imported"/></label><button class="quiet" :disabled="!state.synced" @click="bench.act({type:'recordList'})">刷新记录</button></div>
    <p class="subtle">开始/结束记录不改变电机运行。服务内存保留最近 5 条，每条最多 60000 样本、1000 事件或 10 分钟；满额/失联自动结束。重启服务会丢失，请及时导出 JSON。</p>
    <ul class="record-list"><li v-for="item in state.recordings" :key="item.id"><div><strong>{{ item.name }}</strong><small>{{ item.mode==='demo'?'演示 · 模拟数据':'真实设备' }} · {{ new Date(item.startedAt).toLocaleString() }} · {{ item.samples }} 样本 · {{ item.endedAt?item.stopReason:'采集中' }}</small></div><div><button class="quiet" :disabled="!item.endedAt" @click="load(item.id)">只读回放</button><button class="quiet" :disabled="!item.endedAt||!state.isController" @click="bench.act({type:'recordDelete',id:item.id})">删除记录</button></div></li><li v-if="!state.recordings.length" class="empty-inline">暂无记录。连接设备或进入演示后开始采集，也可以导入已有 JSON。</li></ul>
    <section v-if="record" class="replay-workspace"><div class="section-head"><h2>只读回放：{{ record.name }}</h2><span class="badge warning">{{ record.mode==='demo'?'演示 · 模拟数据':'真实设备记录' }}</span></div><p class="subtle">{{ origin==="file"?"离线文件":"服务记录" }} · {{ record.context.firmware?`固件 ${record.context.firmware}`:'固件未知' }} · 会话 {{ record.context.session }} · 主机接收时间 · {{ record.samples.length }} 样本 · {{ record.stopReason }}</p>
      <div class="analysis-controls"><button class="quiet" @click="playing=!playing">{{ playing?'暂停回放':'播放回放' }}</button><label>回放位置 {{ (position/1000).toFixed(1) }} / {{ (duration/1000).toFixed(1) }} 秒<input v-model.number="position" type="range" min="0" :max="duration" step="50"/></label><label>回放窗口<select v-model.number="windowSeconds"><option :value="5">5 秒</option><option :value="10">10 秒</option><option :value="30">30 秒</option><option :value="60">60 秒</option></select></label></div><TracePlot :samples="samples" :end="position" :window-ms="windowSeconds*1000" :cursor="position"/>
      <TestResults :record="record"/><details><summary>此时间点前的事件与配置</summary><pre class="context-json">{{ JSON.stringify(record.context,null,2) }}</pre><ol class="event-list"><li v-for="(event,index) in events" :key="index">{{ (event.elapsedMs/1000).toFixed(2) }}s · {{ event.message }}</li></ol></details>
      <div class="template-toolbar"><label>记录名称<input v-model="title" maxlength="80"/></label><label>实验备注<textarea v-model="note" maxlength="1000" rows="2"/></label><button class="quiet" @click="saveNote">保存备注</button><button class="quiet" @click="downloadFile('motor-bench-recording.json',JSON.stringify(record))">导出记录 JSON</button><button class="quiet" @click="downloadFile('motor-bench-recording.csv',recordCsv(record),'text/csv;charset=utf-8')">导出 CSV</button></div>
    </section><p v-if="message" class="warning" role="status">{{ message }}</p>
  </section>
</template>
