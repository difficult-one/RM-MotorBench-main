<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Bench } from '../bench';
import type { Telemetry } from '../types';
import { SpeedWaveform } from '../../waveform.js';
import { motorKey } from '../../motor_rules.js';
import LiveComparison from './LiveComparison.vue';
const props = defineProps<{ bench: Bench; ids: number[]; selected: number }>();
const emit = defineEmits<{ select: [id: number] }>();
const root = ref<HTMLElement>(); let chart: SpeedWaveform;
function configure() {
  if (!chart) return;
  chart.setChannels(props.ids); chart.select.value = String(props.selected);
  for (const id of props.ids) {
    const binding = props.bench.state.bindings.find(b => b.channelId === id);
    if (binding) chart.configureChannel(id, { unit: binding.kind === 4 ? 'rad/s' : 'rpm', speedLoop: binding.outerLoop === 2, motorKey: motorKey(binding), identified: !!binding.identified });
    else if (chart.configs.has(id)) chart.forgetChannel(id);
  }
  chart.draw();
}
const append = (item: Telemetry) => chart?.append(item);
const reset = () => chart?.resetSession();
onMounted(() => {
  chart = new SpeedWaveform(root.value);
  chart.select.onchange = () => { emit('select', Number(chart.select.value)); chart.draw(); };
  props.bench.telemetryListeners.add(append); props.bench.sessionListeners.add(reset); configure();
});
watch(() => [props.ids, props.selected, props.bench.state.bindings], configure, { deep: true });
onUnmounted(() => { props.bench.telemetryListeners.delete(append); props.bench.sessionListeners.delete(reset); chart?.destroy(); });
</script>
<template>
  <section ref="root" class="waveform-panel" aria-labelledby="wave-title">
    <div class="section-head wave-toolbar"><h2 id="wave-title">实时转速</h2><div><label>通道<select id="waveChannel" aria-label="波形通道"/></label><label>时间窗口<select id="waveWindow"><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label></div></div>
    <div class="wave-readings"><span class="wave-target">目标 <b id="waveTarget">—</b></span><span class="wave-actual">实测 <b id="waveActual">—</b></span><span>误差 <b id="waveError">—</b></span></div>
    <canvas id="waveCanvas" role="img" aria-label="目标转速蓝色虚线与实测转速绿色实线。横轴为主机接收时间，纵轴为转速。"/>
    <div class="wave-bottom"><span id="waveStatus" role="status" class="subtle">等待遥测</span><div><button id="wavePause" class="quiet" aria-pressed="false">暂停显示</button><button id="waveClear" class="quiet">清空曲线</button></div></div>
    <p class="subtle">暂停显示与清空仅影响曲线，电机运行不受影响。时间为主机接收时间，保留最近 60 秒 / 每通道最多 6000 点。</p>
    <LiveComparison :bench="bench"/>
  </section>
</template>
