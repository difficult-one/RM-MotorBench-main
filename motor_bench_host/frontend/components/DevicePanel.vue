<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Bench } from '../bench';
import { motorLabel, registrationError, motorKey } from '../../motor_rules.js';
import {StopReasonText} from '../../shared.js';
const props = defineProps<{ bench: Bench; compact?: boolean }>();
const state = props.bench.state;
const path = ref(''), kind = ref(2), canBus = ref(2), motorId = ref<number | string>(1), addError = ref('');
try { path.value = localStorage.getItem('motor-bench:last-port') ?? ''; } catch { /* optional storage */ }
watch(() => state.ports, ports => { if (path.value && !ports.some(p => p.path === path.value)) path.value = ''; });
const conflict = computed(() => registrationError({ kind: kind.value, canBus: canBus.value, motorId: Number(motorId.value) }, state.inventory));
async function open() { const response = await props.bench.act({ type: 'openSerial', path: path.value }); if (response) try { localStorage.setItem('motor-bench:last-port', path.value); } catch { /* optional */ } }
async function add() {
  addError.value = '';
  if (motorId.value === '' || !Number.isInteger(Number(motorId.value))) { addError.value = '请输入有效的整数 ID'; return; }
  const response = await props.bench.act({ type: 'addMotor', kind: kind.value, canBus: canBus.value, motorId: Number(motorId.value) }, 'motorAck');
  if (response) await props.bench.act({ type: 'scanMotors' });
}
</script>
<template>
  <section :class="['device-panel', { compact }]">
    <div v-if="!compact" class="section-head"><div><h1>设备与诊断</h1><p class="subtle">连接、登记和接线信息集中在这里。</p></div><span class="badge">{{ state.serial.open ? '串口已打开' : '串口已关闭' }}</span></div>
    <div class="connection-form">
      <label>设备串口<select v-model="path" :disabled="state.serial.open"><option value="">选择 USB 串口</option><option v-for="port in state.ports" :key="port.path" :value="port.path">{{ port.path }}{{ port.friendlyName || port.manufacturer ? ` · ${port.friendlyName || port.manufacturer}` : '' }}</option><option v-if="path && !state.ports.some(p => p.path === path)" :value="path">{{ path }} · 最近使用，需刷新核对</option></select></label>
      <button class="quiet" :disabled="!state.synced || state.busy" @click="bench.act({ type: 'listPorts' })">刷新串口</button>
      <button v-if="!state.serial.open" class="primary" :disabled="!state.isController || !path || !state.synced || state.busy" @click="open">{{ state.busy ? '正在连接…' : '连接开发板' }}</button>
      <button v-else class="quiet" :disabled="!state.isController || state.busy" @click="bench.act({ type: 'closeSerial' })">关闭连接</button>
    </div>
    <p class="subtle">{{ !state.isController ? '此页面仅观察，取得控制权后可连接设备。' : state.ports.length ? '按设备描述和实际接线核对端口，列表不会自动识别测试板。' : '点击刷新串口。未出现设备时，检查 USB 数据线、驱动和开发板供电。' }}</p>
    <div class="demo-entry"><button v-if="!state.serial.open" class="quiet" :disabled="!state.isController||!state.synced||state.busy" @click="bench.act({type:'startDemo'})">进入无硬件演示</button><button v-else-if="state.serial.mode==='demo'" class="quiet" :disabled="!state.isController||state.busy" @click="bench.act({type:'closeSerial'})">退出演示</button><p class="subtle">演示为模拟数据，使用四颗 M3508 与一颗 DM，遥控接收机模拟为已回中。不连接任何物理串口；切换真实设备前须退出。</p></div>
    <template v-if="!compact"><section class="protocol-diagnostics"><h2>协议与板端状态</h2><p>{{ state.capabilities?.boardSession ? "协议 v2 · 关联绑定应答、通道清单、板端时间与有界测试" : "兼容模式 · 等待能力协商或旧固件" }}</p><p class="subtle">{{ state.boardStatus ? `板端原因：${StopReasonText[state.boardStatus.stopReason]} · 时间 ${state.boardStatus.boardMs}ms` : "停止原因与板端时间待确认" }}</p><button class="quiet" :disabled="!bench.writable.value||!(state.capabilities?.flags&2)" @click="bench.act({type:'queryBindings'},'channelReport')">刷新板端通道清单</button></section>
      <section class="device-section"><div class="section-head"><h2>登记电机</h2><span class="subtle">应用上限 8 颗 / 8 通道</span></div>
        <p class="subtle">按实际电调配置登记。清单由板端维护，并非物理设备自动发现。</p>
        <form class="registration-form" @submit.prevent="add">
          <label>电机型号<select v-model="kind"><option :value="1">大疆 GM6020</option><option :value="2">大疆 M3508</option><option :value="3">大疆 M2006</option><option :value="4">达妙 DM 系列</option></select></label>
          <label>总线<select v-model="canBus"><option :value="1">CAN1</option><option :value="2">CAN2</option></select></label>
          <label>电调 ID<input v-model="motorId" type="number" min="1" :max="kind === 1 ? 7 : kind === 4 ? 255 : 8" step="1" required /></label>
          <button class="primary" :disabled="!bench.writable.value || state.busy || !!conflict">登记电机</button>
        </form>
        <p v-if="conflict || addError" class="warning" role="status">{{ conflict || addError }}</p>
        <div class="inventory-head"><h3>板端登记清单 <span class="subtle">{{ state.inventory.length }} / 8</span></h3><button class="quiet" :disabled="!bench.online.value || state.busy" @click="bench.act({ type: 'scanMotors' })">刷新清单</button></div>
        <p v-if="!state.inventory.length" class="empty-inline">{{ state.inventoryKnown ? '清单为空。登记第一颗电机后，前往控制台选择通道并绑定。' : '连接开发板后获取登记清单。' }}</p>
        <ul v-else class="inventory-list"><li v-for="motor in state.inventory" :key="motorKey(motor)"><span>{{ motorLabel(motor) }}</span><button class="quiet" :disabled="!bench.writable.value || state.busy" @click="bench.act({ type: 'removeMotor', ...motor }, 'motorAck').then(() => bench.act({ type: 'scanMotors' }))">移除登记</button></li></ul>
      </section>
      <details class="help"><summary>CAN 接线与 ID 冲突说明</summary><p>GM6020 反馈 ID = 0x204 + ID；M3508/M2006 = 0x200 + ID。同一总线内的反馈 ID 必须唯一。例如 6020 的 ID1 与 3508 的 ID5 冲突，可分别连接 CAN1、CAN2。GM6020 支持 ID1–7，3508/2006 支持 ID1–8。DM 默认 Master ID 为 0，每条总线仅登记一颗。应用登记上限为 8，CAN 过滤器和各驱动实例还受独立容量限制。</p><p>DJI 速度为转子 rpm；输出轴转速须结合实际减速比计算。DJI 电流字段为原始量，DM 转矩为协议映射量，均不代表经过台架校准的测量。</p></details>
      <section class="device-section"><h2>连接与操作事件</h2><p class="subtle">当前服务会话最近 100 条事件，不作长期实验记录。</p><ol class="event-list"><li v-for="(entry,index) in [...state.events].reverse()" :key="`${entry.time}:${index}`"><time>{{ new Date(entry.time).toLocaleTimeString() }}</time><span>{{ entry.message }}</span></li><li v-if="!state.events.length">暂无事件，连接与操作后显示。</li></ol></section>
    </template>
  </section>
</template>
