<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import type { Bench } from '../bench';
import type { Telemetry } from '../types';
import TracePlot from './TracePlot.vue';
const props=defineProps<{bench:Bench}>();
const open=ref(false),selected=ref<number[]>([]),windowSeconds=ref(10),cursorOffset=ref(0),now=ref(performance.now()),version=ref(0);
const history=new Map<number,any[]>();
const channels=computed(()=>props.bench.state.bindings.filter(b=>b.outerLoop===2));
watch(channels,channels=>{selected.value=selected.value.filter(id=>channels.some(b=>b.channelId===id));for(const b of channels)if(!selected.value.includes(b.channelId))selected.value.push(b.channelId);},{immediate:true});
function append(item:Telemetry){const b=props.bench.state.bindings.find(b=>b.channelId===item.channelId);if(!b||b.outerLoop!==2)return;const time=performance.now(),list=history.get(item.channelId)??[];list.push({...item,...b,elapsedMs:time,speedUnit:b.kind===4?'rad/s':'rpm'});while(list.length&&(list.length>6000||list[0].elapsedMs<time-60000))list.shift();history.set(item.channelId,list);}
function reset(){history.clear();version.value++;}
const samples=computed(()=>{void version.value;return selected.value.flatMap(id=>history.get(id)??[]).filter(s=>s.elapsedMs>=now.value-windowSeconds.value*1000).sort((a,b)=>a.elapsedMs-b.elapsedMs);});
const timer=setInterval(()=>{if(open.value&&!document.hidden){now.value=performance.now();version.value++;}},200);
onMounted(()=>{props.bench.telemetryListeners.add(append);props.bench.sessionListeners.add(reset);});onUnmounted(()=>{clearInterval(timer);props.bench.telemetryListeners.delete(append);props.bench.sessionListeners.delete(reset);});
</script>
<template><details class="comparison-panel" @toggle="open=($event.target as HTMLDetailsElement).open"><summary>多通道分析 · 游标与缩放</summary><div v-if="open"><p class="subtle">虚线为板端目标，实线为实测；不同单位分别绘制。时间为主机接收时间。</p><div class="compare-select"><label v-for="channel in channels" :key="channel.channelId"><input v-model="selected" type="checkbox" :value="channel.channelId"/>通道 {{ channel.channelId }}</label></div><div class="analysis-controls"><label>分析窗口<select v-model.number="windowSeconds"><option :value="5">5 秒</option><option :value="10">10 秒</option><option :value="30">30 秒</option><option :value="60">60 秒</option></select></label><label>游标距现在 {{ cursorOffset }} 秒<input v-model.number="cursorOffset" type="range" :min="-windowSeconds" max="0" step="0.1"/></label></div><TracePlot :samples="samples" :end="now" :window-ms="windowSeconds*1000" :cursor="now+cursorOffset*1000"/></div></details></template>
