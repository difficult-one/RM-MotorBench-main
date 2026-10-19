<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import { useBench } from './bench';
import { motorLabel } from '../motor_rules.js';
import ChannelControl from './components/ChannelControl.vue';
import PidPanel from './components/PidPanel.vue';
import WaveformPanel from './components/WaveformPanel.vue';
import DevicePanel from './components/DevicePanel.vue';
import SourcePanel from './components/SourcePanel.vue';
import ScenePanel from './components/ScenePanel.vue';
import RecordsPanel from './components/RecordsPanel.vue';
import TestPanel from './components/TestPanel.vue';
import StepperPanel from './components/StepperPanel.vue';
const bench = useBench();
const { state, online, linkText } = bench;
const tab = ref('console'), selected = ref(0), professional = ref(false), slots = ref([0]);
const ids = computed(() => [...new Set([...slots.value, ...state.bindings.map(b => b.channelId), ...Object.keys(state.telemetry).map(Number)])].sort((a,b) => a-b));
const current = computed(() => state.bindings.find(b => b.channelId === selected.value));
const sourceLabel = computed(() => state.control ? ['网页控制','单电机遥控','麦克纳姆底盘','四轮全向底盘'][state.control.source] : '控制方式待确认');
function addChannel() { const id = Array.from({ length: 8 }, (_,id) => id).find(id => !ids.value.includes(id)); if (id !== undefined) { slots.value.push(id); selected.value = id; } }
function removed(id: number) { slots.value = slots.value.filter(item => item !== id); selected.value = ids.value.find(item => item !== id) ?? 0; if (!slots.value.length && !ids.value.length) slots.value = [0]; }
async function showPid(toggle = false) {
  professional.value = toggle ? !professional.value : true; tab.value = 'console';
  if (!professional.value) return;
  await nextTick();
  const heading = document.getElementById('pid-title');
  heading?.scrollIntoView({ block: 'start', behavior: 'auto' }); heading?.focus({ preventScroll: true });
}
onUnmounted(bench.dispose);
</script>

<template>
  <header class="topbar">
    <a class="brand" href="#" @click.prevent="tab = 'console'">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h18v18H7zM3 12h4m-4 8h4m18-8h4m-4 8h4M12 3v4m8-4v4m-8 18v4m8-4v4"/><circle cx="16" cy="16" r="5"/></svg>
      <span>电机测试台<small>Motor Bench</small></span>
    </a>
    <div class="link-summary" role="status"><span v-if="state.serial.mode==='demo'" class="demo-badge">演示 · 模拟数据</span><span :class="['indicator', { online }]"/>{{ linkText }}<span v-if="state.serial.path" class="subtle">{{ state.serial.path }}</span><span v-if="state.activeRecordingId" class="badge warning">记录中</span></div>
    <div class="ownership"><span>{{ state.isController ? '当前控制者' : '仅观察' }}</span><button v-if="!state.isController && state.synced" class="quiet" :disabled="state.busy" @click="bench.act({ type: 'claimControl', takeover: true })">{{ state.controllerId ? '主动接管' : '取得控制权' }}</button></div>
    <button class="estop" @click="bench.stop" title="立即请求所有通道停止输出">全局急停 <span>ALL STOP</span></button>
  </header>

  <div class="workspace-bar">
    <nav aria-label="工作区"><button :class="{ active: tab === 'console' }" @click="tab = 'console'">控制台</button><button :class="{active:tab==='steppers'}" @click="tab='steppers'">步进控制</button><button :class="{ active: tab === 'devices' }" @click="tab = 'devices'">设备与诊断</button><button :class="{active:tab==='scenes'}" @click="tab='scenes'">配置模板</button><button :class="{active:tab==='records'}" @click="tab='records'">测试记录</button></nav>
    <div class="workspace-tools"><span class="subtle">{{ sourceLabel }}</span><button class="quiet" :aria-expanded="professional" aria-controls="pid-title" @click="showPid(true)">{{ professional ? '收起 PID 参数' : 'PID / 专业调试' }}</button></div>
  </div>
  <div v-if="state.stopStatus" class="stop-message" role="status">{{ state.stopStatus }}</div>
  <div v-if="state.message" class="notice" role="status" aria-live="polite"><span>{{ state.message }}</span><button class="quiet" @click="state.message = ''">关闭提示</button></div>

  <main v-if="tab === 'devices'" class="device-workspace"><DevicePanel :bench="bench" /></main>
  <main v-show="tab==='steppers'" class="device-workspace"><StepperPanel :bench="bench"/></main>
  <main v-show="tab==='scenes'" class="device-workspace"><ScenePanel :bench="bench"/></main>
  <main v-show="tab==='records'" class="device-workspace"><RecordsPanel :bench="bench"/></main>
  <main v-show="tab === 'console'" :class="['workbench', { professional }]">
    <aside class="channel-sidebar" aria-label="通道列表">
      <div class="section-head"><h2>电机通道</h2><span class="subtle">{{ ids.length }} / 8</span></div>
      <div class="channel-list">
        <button v-for="id in ids" :key="id" :class="['channel-tab', { selected: selected === id }]" :aria-pressed="selected === id" @click="selected = id">
          <span class="channel-index">{{ String(id).padStart(2, '0') }}</span>
          <span><strong>{{ state.bindings.find(b => b.channelId === id) ? motorLabel(state.bindings.find(b => b.channelId === id)!) .split(' · ')[0] : '待配置通道' }}</strong><small>{{ bench.channelStatus(id) }}</small></span>
          <span :class="['indicator', { online: bench.channelFresh(id) && state.telemetry[id]?.online, running: bench.channelFresh(id) && state.telemetry[id]?.online && state.telemetry[id]?.enabled }]"/>
        </button>
      </div>
      <button class="add-channel quiet" :disabled="ids.length >= 8" @click="addChannel">添加通道</button>
      <div class="sidebar-foot"><p>先登记物理电机，再绑定逻辑通道。</p><button class="quiet" @click="tab = 'devices'">管理登记清单</button><span>{{ state.inventory.length }} / 8 颗已登记</span></div>
    </aside>

    <div class="console-main">
      <template v-if="!online">
        <section class="connection-guide">
          <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 6v12m16-12v12M12 18h24v7a12 12 0 0 1-24 0zM24 37v8"/></svg>
          <h1>{{ !state.service ? '等待上位机服务' : !state.serial.open ? '从连接开发板开始' : '等待开发板应答' }}</h1>
          <p>{{ !state.service ? '服务恢复后页面会自动重连并同步状态。所有输出都需要重新使能。' : !state.serial.open ? '通过 USB 连接 A 板或 C 板，选择串口后即可登记和测试电机。' : '串口已经打开，但还未收到有效板端反馈。请检查 USB、固件及供电。' }}</p>
          <DevicePanel :bench="bench" compact />
          <ol class="flow"><li>连接开发板</li><li>登记与绑定</li><li>使能并观察</li></ol>
        </section>
      </template>
      <div v-show="online" class="console-content">
        <ChannelControl :key="`${state.session}:${selected}`" :bench="bench" :channel-id="selected" @removed="removed" @pid="showPid()" />
        <WaveformPanel :bench="bench" :ids="ids" :selected="selected" @select="selected = $event" />
        <SourcePanel :bench="bench" />
        <TestPanel :bench="bench" :binding="current" :channel-id="selected"/>
      </div>
    </div>
    <aside v-if="professional" class="professional-panel"><PidPanel :key="`${state.session}:${selected}`" :bench="bench" :binding="current" :channel-id="selected" /></aside>
  </main>
  <footer class="footer"><span>A / C 板 · CAN / 脉冲 · USB‑485</span><span>运行与目标以设备反馈为准</span><span v-if="state.firmware">固件 {{ state.firmware }}</span></footer>
</template>
