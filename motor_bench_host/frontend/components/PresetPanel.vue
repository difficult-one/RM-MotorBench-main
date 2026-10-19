<script setup lang="ts">
import {ref,computed} from 'vue';
import type {Pid} from '../types';
import {parsePreset} from '../../workspace_formats.js';
import {loadLibrary,saveLibrary,downloadFile,readFile} from '../workspace_storage';
const props=defineProps<{kind:number;loop:number;draft:Pid}>(),emit=defineEmits<{load:[pid:Pid]}>();
const key='motor-bench:pid-presets:v1',stored=loadLibrary(key,parsePreset);
const items=ref<any[]>(stored.items),message=ref(stored.warning),name=ref('参数预设'),selection=ref(-1),preview=ref<any>(null);
const compatible=computed(()=>preview.value?.kind===props.kind&&preview.value?.loop===props.loop);
function save(value:any){const preset=parsePreset(JSON.stringify(value)),list=[...items.value];const index=list.findIndex(p=>p.name===preset.name);if(index>=0)list[index]=preset;else list.push(preset);saveLibrary(key,list);items.value=list;selection.value=list.findIndex(p=>p.name===preset.name);preview.value=preset;}
function perform(fn:()=>void){try{fn();message.value='已更新本地预设，未写入板端';}catch(error){message.value=(error as Error).message;}}
function choose(){preview.value=items.value[selection.value]??null;if(preview.value)name.value=preview.value.name;}
async function imported(event:Event){try{const text=await readFile(event);if(!text)return;preview.value=parsePreset(text);selection.value=-1;name.value=preview.value.name;message.value='文件已读取，请预览型号、环和数值后填入编辑';}catch(error){message.value=(error as Error).message;}}
</script>
<template>
  <details class="preset-panel"><summary>PID 预设与导入导出</summary><label>预设名称<input v-model="name" maxlength="80"/></label><div class="pid-actions"><button class="quiet" :disabled="!kind" @click="perform(()=>save({type:'motor-bench-pid',version:1,name,kind,loop,pid:{...draft}}))">保存编辑为预设</button><label class="file-button">导入 PID JSON<input type="file" accept=".json,application/json" @change="imported"/></label></div>
    <label v-if="items.length">本地 PID 预设<select v-model.number="selection" @change="choose"><option :value="-1">选择预设</option><option v-for="(item,index) in items" :key="item.name" :value="index">{{ item.name }}</option></select></label>
    <div v-if="preview" class="preset-preview"><p>{{ preview.name }} · 型号 {{ preview.kind }} / {{ ['速度','电流','位置'][preview.loop] }}环</p><p class="subtle">Kp {{ preview.pid.Kp }} / Ki {{ preview.pid.Ki }} / Kd {{ preview.pid.Kd }} / 输出 {{ preview.pid.MaxOut }} / 积分 {{ preview.pid.IntegralLimit }}</p><p v-if="!compatible" class="warning">当前电机型号或参数环不同，请先切换匹配后使用。</p><div class="pid-actions"><button class="quiet" :disabled="!compatible" @click="emit('load',{...preview.pid});message='已填入本地编辑，尚未应用到板端'">填入本地编辑</button><button class="quiet" @click="downloadFile('motor-bench-pid.json',JSON.stringify(preview,null,2))">导出 PID JSON</button><button class="quiet" @click="perform(()=>save({...preview,name:name+' 副本'}))">复制预设</button><button class="quiet" @click="perform(()=>save({...preview,name}))">保存预览预设</button><button v-if="selection>=0" class="quiet" @click="perform(()=>{const list=items.filter((_,i)=>i!==selection);saveLibrary(key,list);items=list;selection=-1;preview=null})">删除预设</button></div></div>
    <p class="warning" role="status">{{ message }}</p>
  </details>
</template>
