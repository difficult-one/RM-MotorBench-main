<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Bench } from '../bench';
const props = defineProps<{ bench: Bench }>();
const state = props.bench.state;
const draft = reactive({ source: 0, channelId: 0, maxRef: 3000, channels: [0,1,2,3], reverseMask: 0 });
const edited = ref(false), pending = ref(false), message = ref('');
const channels = computed(() => state.bindings.filter(b => !b.identified && b.outerLoop === 2));
const positions = ['左前 FL','右前 FR','左后 RL','右后 RR'];
watch(() => state.control, control => { if (!control || edited.value || pending.value) return; Object.assign(draft, { source: control.source, channelId: control.channelId === 255 ? 0 : control.channelId, maxRef: control.maxRef || 3000, channels: control.channels ? [...control.channels] : [0,1,2,3], reverseMask: control.reverseMask ?? 0 }); }, { immediate: true });
async function apply() {
  pending.value = true;
  try { await props.bench.command({ type: 'controlSource', ...draft }, 'controlReport'); edited.value = false; message.value = '控制方式已由板端确认，所有电机需重新使能'; }
  catch (error) { message.value = (error as Error).message; }
  finally { pending.value = false; }
}
</script>
<template>
  <details class="source-panel"><summary>控制方式 <span class="subtle">{{ state.control ? ['网页控制','单电机遥控','麦克纳姆底盘','四轮全向底盘'][state.control.source] : '等待板端确认' }}</span></summary>
    <div class="source-fields" @input="edited = true" @change="edited = true"><label>控制来源<select v-model="draft.source" :disabled="pending"><option :value="0">网页控制</option><option :value="1">单电机遥控</option><option :value="2">麦克纳姆底盘</option><option :value="3">四轮全向底盘</option></select></label>
      <template v-if="draft.source === 1"><label>遥控通道<select v-model="draft.channelId"><option v-for="channel in channels" :key="channel.channelId" :value="channel.channelId">通道 {{ channel.channelId }} · {{ channel.kind === 4 ? 'rad/s' : 'rpm' }}</option></select></label></template>
      <label v-if="draft.source">最大转速<input v-model.number="draft.maxRef" type="number" min="0.01" step="any"/></label>
      <div v-if="draft.source >= 2" class="wheel-map"><label v-for="(position,index) in positions" :key="position">{{ position }}<select v-model="draft.channels[index]"><option v-for="channel in channels" :key="channel.channelId" :value="channel.channelId">通道 {{ channel.channelId }}</option></select><span><input type="checkbox" :checked="!!(draft.reverseMask & (1 << index))" @change="draft.reverseMask ^= 1 << index"/>反向</span></label></div>
      <button class="primary" :disabled="!bench.writable.value || bench.testing.value || pending" @click="apply">{{ pending ? '等待板端…' : '应用控制方式并全停' }}</button>
    </div>
    <p v-if="draft.source >= 2" class="subtle">四个同型号 DJI 电机须绑定速度环。FL / FR 为前轮，RL / RR 为后轮；按实际安装核对轮序和反向。麦轮使用 X 型辊子布局，四轮全向使用 45° X 型布局；实际方向需低速验收。</p>
    <div v-if="draft.source>=2" class="wheel-preview" aria-label="底盘轮序和方向预览"><div class="chassis-front">车头 / 前进方向</div><div class="wheel-preview-grid"><div v-for="(position,index) in positions" :key="position"><strong>{{ position }}</strong><span>通道 {{ draft.channels[index] }}</span><svg viewBox="0 0 40 40" role="img" :aria-label="draft.reverseMask&(1<<index)?'该轮反向':'该轮正向'" :class="{reversed:!!(draft.reverseMask&(1<<index))}"><path d="M20 32V8m-8 8 8-8 8 8"/></svg><small>{{ draft.reverseMask&(1<<index)?'反向':'正向' }}</small></div></div></div>
    <p class="subtle">遥控使能前，右拨杆上档、两摇杆回中。切换控制方式、失联或停机后均须重新使能。单电机以该型号速度单位限幅，底盘为转子 rpm。</p>
    <p v-if="state.control?.source" class="subtle">遥控器{{ state.control.online ? '在线' : '离线' }} · {{ state.control.ready ? '已回中，可使能' : '等待拨杆上档与摇杆回中' }}</p>
    <div v-if="state.control && state.control.source >= 2" class="run-actions"><button class="primary" :disabled="!bench.writable.value || !state.control.ready || edited || pending" @click="bench.act({ type: 'chassisEnable', enable: true })">底盘使能</button><button class="stop-button" :disabled="!bench.writable.value" @click="bench.act({ type: 'chassisEnable', enable: false })">底盘停机</button></div>
    <p v-if="edited || message" role="status" class="warning">{{ edited ? '配置已修改，请应用并等待板端确认。' : message }}</p>
  </details>
</template>
