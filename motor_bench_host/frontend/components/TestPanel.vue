<script setup lang="ts">
import {computed,reactive,watch} from 'vue';
import type {Bench} from '../bench';import type {Binding} from '../types';
import {validateSequence,sequenceDuration} from '../../test_sequence.js';
import {StopReasonText,TestStateText} from '../../shared.js';
import {targetSpec} from '../../motor_rules.js';
const props=defineProps<{bench:Bench;binding?:Binding;channelId:number}>(),state=props.bench.state;
const draft=reactive({mode:'step',amplitude:300,baselineMs:500,phaseMs:3000,tailMs:1000});
watch(()=>props.binding?.kind,kind=>{draft.amplitude=kind===4?2:300;},{immediate:true});
const spec=computed(()=>targetSpec(props.binding?.kind??2,2));
const config=computed(()=>({...draft,channelId:props.channelId}));
const reason=computed(()=>{
  if(!(state.capabilities?.flags&8))return '固件未提供板端测试能力；旧固件仍可手动控制，升级对应板型固件后使用。';
  if(!props.binding||props.binding.identified)return '先确认通道绑定。';
  try{validateSequence(config.value,props.binding);}catch(error){return (error as Error).message;}
  if(!props.bench.writable.value)return '等待设备在线并取得控制权。';
  if(state.control?.source!==0)return '先切换到网页控制。';
  if(!props.bench.channelFresh(props.channelId)||!state.telemetry[props.channelId]?.online)return '等待新鲜的电机在线反馈。';
  if(Object.values(state.telemetry).some(s=>s.enabled))return '先停止全部通道输出。';
  if(state.testStoppedAt&&(state.telemetry[props.channelId]?.receivedAt??0)<=state.testStoppedAt)return '等待测试结束后的停机反馈。';
  if(state.activeRecordingId)return '请先结束当前记录。';return '';
});
const active=computed(()=>props.bench.testing.value),status=computed(()=>state.boardStatus);
</script>
<template>
  <details class="automatic-test-panel"><summary>自动测试 · 板端执行</summary>
    <p class="subtle">对当前速度环执行有界测试。开始会使能当前通道，完成、取消或失联后停止；自动记录配置和反馈。</p>
    <div class="test-fields"><label>测试类型<select v-model="draft.mode" :disabled="active"><option value="step">阶跃</option><option value="ramp">斜坡</option><option value="reversal">正反转</option></select></label><label>测试幅度<input v-model.number="draft.amplitude" type="number" min="0.01" :max="spec.limit" step="any" :disabled="active"/></label><label>基线时长（ms）<input v-model.number="draft.baselineMs" type="number" min="500" max="10000" step="100" :disabled="active"/></label><label>保持/升幅时长（ms）<input v-model.number="draft.phaseMs" type="number" min="200" max="30000" step="100" :disabled="active"/></label><label>零目标尾段（ms）<input v-model.number="draft.tailMs" type="number" min="500" max="10000" step="100" :disabled="active"/></label></div>
    <p class="subtle">幅度 {{ draft.amplitude }} {{ spec.unit }}，总时长 {{ (sequenceDuration(config)/1000).toFixed(1) }} 秒。{{ draft.mode==='step'?'零基线 → 正幅保持 → 零尾段 → 停机':draft.mode==='ramp'?'零基线 → 线性升幅 → 同长保持 → 零尾段 → 停机':'零基线 → 正幅保持 → 500ms零段 → 负幅保持 → 零尾段 → 停机' }}</p>
    <div class="test-actions"><button class="primary" :disabled="!!reason||active||state.busy" @click="bench.act({type:'sequenceStart',...config},'testAck')">开始测试并使能</button><button class="stop-button" :disabled="!active||!state.isController" @click="bench.command({type:'sequenceCancel'},'testAck').catch(error=>state.message=error.message)">取消测试并停机</button></div>
    <p v-if="reason&&!active" class="warning">{{ reason }}</p>
    <p v-if="status" class="test-status" role="status">{{ TestStateText[status.testState] }} · {{ StopReasonText[status.stopReason] }}<span v-if="active"> · 通道 {{ status.channelId }} · {{ (((status.boardMs-status.startedAt)>>>0)/1000).toFixed(1) }} / {{ (status.durationMs/1000).toFixed(1) }} 秒</span></p>
    <p class="subtle">结果在「测试记录」查看。评价要求连续板端时间、有效基线与完整结束采样；演示数据只用于功能体验。</p>
  </details>
</template>
