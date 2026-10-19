<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Bench } from '../bench';
import type { Binding, Pid } from '../types';
import { PID_DEFAULTS } from '../../shared.js';
import { motorKey } from '../../motor_rules.js';
import { loadPid, savePid, validPid } from '../pid_memory';
import PresetPanel from './PresetPanel.vue';
const props = defineProps<{ bench: Bench; binding?: Binding; channelId: number }>();
const loop = ref(0), message = ref(''), busy = ref(false), board = ref<Pid | null>(null);
const fields = [['Kp','Kp'],['Ki','Ki'],['Kd','Kd'],['MaxOut','输出限幅'],['IntegralLimit','积分限幅']] as const;
const draft = reactive<Pid>({ Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 });
const defaults = computed<Pid>(() => (PID_DEFAULTS as Record<number, Record<string, Pid>>)[props.binding?.kind ?? 0]?.[['speed','current','angle'][loop.value]!] ?? { Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 });
const identity = computed(() => props.binding ? motorKey(props.binding) : '');
const canApply = computed(() => props.bench.writable.value && !props.bench.testing.value && !!props.binding && props.binding.kind !== 4 && !props.binding.identified && !busy.value && validPid(draft));
watch([identity, loop], () => {
  board.value = null;
  if (!identity.value) { Object.assign(draft, defaults.value); message.value = '选择已绑定电机后可调参'; return; }
  const stored = loadPid(localStorage, identity.value, loop.value, defaults.value);
  Object.assign(draft, stored.values); message.value = stored.warning || (stored.source === 'local' ? '已恢复本地编辑值，尚未代表板端生效' : '当前为型号默认值，尚未代表板端生效');
}, { immediate: true });
function persist() { const warning = savePid(localStorage, identity.value, loop.value, { ...draft }); message.value = warning || '本地编辑已保存，尚未应用到板端'; }
async function read() {
  const expectedIdentity = identity.value, expectedLoop = loop.value, expectedSession = props.bench.state.session;
  busy.value = true;
  try {
    const report = await props.bench.command({ type: 'pidQuery', channelId: props.channelId }, 'pidReport');
    if (expectedIdentity !== identity.value || expectedLoop !== loop.value || expectedSession !== props.bench.state.session || report.data.kind !== props.binding?.kind) return;
    board.value = report.data[['speed','current','angle'][expectedLoop]!]; message.value = '已更新板端读回值，本地编辑保持不变';
  } catch (error) { message.value = (error as Error).message; }
  finally { busy.value = false; }
}
async function apply() {
  const expectedIdentity = identity.value, expectedLoop = loop.value, expectedSession = props.bench.state.session;
  busy.value = true;
  try {
    await props.bench.command({ type: 'pidSet', channelId: props.channelId, loop: loop.value, pid: { ...draft } }, 'pidAck');
    if (expectedIdentity !== identity.value || expectedLoop !== loop.value || expectedSession !== props.bench.state.session) return;
    board.value = null; persist(); message.value = '板端已确认写入并停机；读回可核对生效值，运行需重新使能';
  } catch (error) { message.value = (error as Error).message; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="pid-panel">
    <div class="section-head"><h2 id="pid-title" tabindex="-1">PID 参数</h2><span class="subtle">通道 {{ channelId }}</span></div>
    <p class="subtle">本地编辑、板端读回与型号默认值分别展示。</p>
    <label>参数环<select v-model="loop" :disabled="busy || !binding"><option :value="0">速度环</option><option v-if="binding?.kind !== 4" :value="1">电流环</option><option v-if="binding?.kind !== 4" :value="2">位置环</option></select></label>
    <div class="pid-table"><div class="pid-column-head"><span>参数 / 本地编辑</span><span>板端读回</span><span>默认值</span></div>
      <div v-for="[field,label] in fields" :key="field" class="pid-row"><label>{{ label }}<input v-model.number="draft[field]" type="number" min="0" :max="field === 'MaxOut' || field === 'IntegralLimit' ? 2147483647 : 655.35" :step="field === 'MaxOut' || field === 'IntegralLimit' ? 1 : 0.01" :disabled="!binding || busy" @input="persist"/></label><span :class="{ 'pid-diff': board && board[field] !== draft[field] }">{{ board?.[field] ?? '—' }}</span><span class="subtle">{{ defaults[field] }}</span></div>
    </div>
    <div class="pid-actions"><button class="primary" :disabled="!canApply" @click="apply">{{ busy ? '等待板端…' : '应用到板端' }}</button><button class="quiet" :disabled="!binding || binding.identified || binding.kind === 4 || !bench.online.value || busy" @click="read">读回板端值</button><button class="quiet" :disabled="!binding || busy" @click="Object.assign(draft, defaults); persist()">填入型号默认值</button><button v-if="board" class="quiet" :disabled="busy" @click="Object.assign(draft, board); persist()">将读回值复制到编辑</button></div>
    <p role="status" class="pid-message">{{ message }}</p>
    <p v-if="binding?.kind === 4" class="warning">当前达妙固件不支持运行期 PID 写入和读回，仅展示本地编辑及默认值。</p>
    <p class="subtle">应用参数会停机并清除控制历史。增益范围 0–655.35；本地记忆按电机身份和参数环保存。</p>
    <PresetPanel :kind="binding?.kind??0" :loop="loop" :draft="draft" @load="Object.assign(draft,$event);persist()"/>
  </section>
</template>
