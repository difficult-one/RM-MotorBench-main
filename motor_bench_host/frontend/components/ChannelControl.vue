<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Bench } from '../bench';
import { motorKey, motorLabel, targetSpec } from '../../motor_rules.js';
import { LoopLabel } from '../../shared.js';
const props = defineProps<{ bench: Bench; channelId: number }>();
const emit = defineEmits<{ removed: [id: number]; pid: [] }>();
const state = props.bench.state;
const binding = computed(() => state.bindings.find(b => b.channelId === props.channelId));
const sample = computed(() => state.telemetry[props.channelId]);
const selection = ref(''), loop = ref(2), target = ref<number | string>(0), note = ref(''), pending = ref(false), message = ref('');
let bindingTimer: ReturnType<typeof setTimeout> | undefined;
const chosen = computed(() => state.inventory.find(m => motorKey(m) === selection.value));
const spec = computed(() => targetSpec(binding.value?.kind ?? chosen.value?.kind ?? 2, binding.value?.outerLoop ?? loop.value));
const identified = computed(() => !!binding.value?.identified);
const confirmed = computed(() => !!binding.value && !identified.value);
const fresh = computed(() => props.bench.channelFresh(props.channelId));
const canRun = computed(() => props.bench.writable.value && !props.bench.testing.value && confirmed.value && fresh.value && sample.value?.online && !pending.value && state.control && (state.control.source === 0 || (state.control.source === 1 && state.control.channelId === props.channelId && state.control.ready)));
const validTarget = computed(() => target.value !== '' && Number.isFinite(Number(target.value)) && Math.abs(Number(target.value)) <= spec.value.limit);
function loadIdentity() {
  if (binding.value) { selection.value = motorKey(binding.value); loop.value = binding.value.outerLoop; }
  if (confirmed.value && pending.value) { pending.value = false; clearTimeout(bindingTimer); message.value = '已由当前会话绑定及遥测恢复身份'; }
  try { note.value = binding.value ? localStorage.getItem(`motor-bench:name:${motorKey(binding.value)}`) ?? '' : ''; } catch { /* optional */ }
}
watch(binding, loadIdentity, { immediate: true });
watch(() => state.session, () => { target.value = 0; message.value = ''; pending.value = false; });
watch(note, value => { if (binding.value) try { localStorage.setItem(`motor-bench:name:${motorKey(binding.value)}`, value); } catch { /* optional */ } });
async function bind() {
  if (!chosen.value) return;
  pending.value = true;
  try {
    await props.bench.command({ type: 'bind', ...chosen.value, outerLoop: loop.value, channelId: props.channelId });
    if (confirmed.value) { pending.value = false; message.value = '已由当前会话绑定及遥测恢复身份'; return; }
    message.value = '绑定已发送,等待遥测。旧协议没有独立绑定应答。';
    bindingTimer = setTimeout(() => { pending.value = false; message.value = '绑定结果未确认。若板端已有通道，请先解绑后重试。'; }, 3000);
  } catch (error) { pending.value = false; message.value = (error as Error).message; }
}
async function unbind() { const response = await props.bench.act({ type: 'unbind', channelId: props.channelId }, 'unbindAck'); if (response) emit('removed', props.channelId); }
async function sendTarget() { if (validTarget.value) { const response = await props.bench.act({ type: 'setRef', channelId: props.channelId, ref: Number(target.value) }); if (response) message.value = '目标已发送，板端当前目标以回传为准'; } }
const format = (value: unknown, digits = 1) => fresh.value && typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
onUnmounted(() => clearTimeout(bindingTimer));
</script>
<template>
  <section class="channel-control">
    <div class="section-head"><div><h1>{{ note || `通道 ${channelId}` }}</h1><p class="subtle">{{ binding ? motorLabel(binding) : '选择已登记电机，确认控制环后绑定。' }}</p></div><span :class="['badge', { success: fresh && sample?.online, warning: identified || pending || (sample && !fresh) }]">{{ pending ? '绑定中' : bench.channelStatus(channelId) }}</span></div>
    <div v-if="!confirmed" class="bind-form">
      <label>已登记电机<select v-model="selection"><option value="">选择电机</option><option v-for="motor in state.inventory" :key="motorKey(motor)" :value="motorKey(motor)">{{ motorLabel(motor) }}</option></select></label>
      <label>控制环<select v-model="loop"><option :value="2">速度环</option><template v-if="chosen?.kind !== 4"><option :value="0">开环</option><option :value="1">电流环</option><option :value="4">角度环</option></template></select></label>
      <button v-if="!sample" class="primary" :disabled="!bench.writable.value || !chosen || pending || state.busy" @click="bind">{{ pending ? '等待确认…' : '绑定通道' }}</button>
      <button v-else class="quiet" :disabled="!bench.writable.value || !chosen || state.busy" @click="bench.act({ type: 'identifyChannel', ...chosen, outerLoop: loop, channelId })">仅识别显示</button>
    </div>
    <p v-if="sample && !confirmed" class="warning">板端占用已确认，电机身份{{ identified ? '由用户识别，仅用于显示' : '未知' }}。若要改变绑定或运行，请显式解绑后重新绑定。</p>
    <div v-if="confirmed" class="identity-row"><label>电机备注<input v-model="note" placeholder="例如：左前轮" maxlength="40" /></label><span class="subtle">{{ LoopLabel[binding!.outerLoop as keyof typeof LoopLabel] }}</span><button class="quiet" @click="emit('pid')">PID 参数</button></div>
    <div class="measurements">
      <div><span>板端当前目标 <small>{{ binding ? spec.unit : '单位待确认' }}</small></span><b>{{ format(sample?.ref) }}</b></div>
      <div><span>实测转速 <small>{{ !binding ? '单位待确认' : binding.kind === 4 ? 'rad/s' : 'rpm' }}</small></span><b>{{ format(sample?.speed) }}</b></div>
      <div><span>{{ !binding ? '反馈量 · 含义待确认' : binding.kind === 4 ? '协议转矩 · 未校准' : '电流原始量' }}</span><strong>{{ format(sample?.torque) }}</strong></div>
      <div><span>角度 <small>°</small></span><strong>{{ format(sample?.angle) }}</strong></div>
      <div><span>温度 <small>°C</small></span><strong>{{ sample?.temperature === -128 ? '不支持' : format(sample?.temperature, 0) }}</strong></div>
    </div>
    <div class="run-actions"><button class="primary" :disabled="!canRun || !!sample?.enabled || state.busy" @click="bench.act({ type: 'enable', channelId, enable: true })">使能运行</button><button class="stop-button" :disabled="!bench.writable.value || !sample || state.busy" @click="bench.testing.value?bench.stop():bench.act({ type: 'enable', channelId, enable: false })">停止输出</button><button class="quiet" :disabled="!bench.writable.value || bench.testing.value || state.busy" @click="unbind">解绑通道</button></div>
    <form class="target-form" @submit.prevent="sendTarget">
      <label>准备下发的{{ spec.label }}<div class="target-input"><input v-model="target" type="number" :min="-spec.limit" :max="spec.limit" step="any" required :disabled="!confirmed || state.control?.source !== 0" aria-describedby="target-hint"/><span>{{ spec.unit }}</span></div></label>
      <button class="primary" :disabled="!canRun || !sample?.enabled || state.control?.source !== 0 || !validTarget || state.busy">下发目标</button>
      <button type="button" class="quiet" :disabled="!canRun || !sample?.enabled || state.control?.source !== 0 || state.busy" @click="target = 0; sendTarget()">目标设为 0</button>
    </form>
    <p id="target-hint" class="subtle">范围 ±{{ spec.limit }} {{ spec.unit }}。{{ !confirmed ? '先绑定电机，再使能并下发目标。' : !state.control ? '等待板端确认控制方式。' : state.control.source !== 0 ? '当前为遥控来源，网页目标不可下发。' : !sample?.enabled ? '使能从零目标开始，不自动下发输入框内的草稿。' : '输入值仅为草稿，点击下发后以板端回传为准。' }}</p>
    <p v-if="message" class="subtle" role="status">{{ message }}</p>
  </section>
</template>
