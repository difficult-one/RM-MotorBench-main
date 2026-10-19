import { reactive, computed } from 'vue';
import { BenchConnection } from './connection';
import type { Binding, Control, LogEntry, Motor, Report, Telemetry } from './types';
import { feedbackFresh } from '../motor_rules.js';
export function useBench() {
  const state = reactive({ service: false, synced: false, session: 0, isController: false, controllerId: null as string | null,
    serial: { open: false, path: '',mode:'real' }, lastReply: 0, inventory: [] as Motor[], inventoryKnown: false,
    bindings: [] as Binding[], telemetry: {} as Record<number, Telemetry>, control: null as Control | null,
    ports: [] as { path: string; manufacturer?: string; friendlyName?: string }[], events: [] as LogEntry[],
    firmware: '', message: '', stopStatus: '', now: Date.now(), busy: false,
    recordings:[] as any[],activeRecordingId:null as string|null,
    capabilities:null as any,boardStatus:null as any,testStoppedAt:0,
    pulse:null as any,rs485:{open:false,mode:'real',path:'',profileName:'',commandEnabled:null,stopConfirmed:false,feedbackSpeed:null,feedbackPosition:null,receivedAt:0,error:'',busy:false} as any,
  });
  const telemetryListeners = new Set<(item: Telemetry) => void>(), sessionListeners = new Set<() => void>();
  let collected: Record<number, Telemetry> = {}, stopAwaiting: Set<number> | null = null;
  const online = computed(() => state.service && state.synced && state.serial.open && state.lastReply > 0 && state.now - state.lastReply <= 1500);
  const writable = computed(() => online.value && state.isController);
  const testing=computed(()=>state.boardStatus?.testState===1);
  const channelFresh = (id: number) => online.value && feedbackFresh(state.telemetry[id], state.now);
  const channelStatus = (id: number) => !online.value ? '等待连接' : !state.telemetry[id] ? '未绑定' : !channelFresh(id) ? '反馈过期 · 运行待确认' : !state.telemetry[id].online ? '反馈离线' : state.telemetry[id].enabled ? '正在运行' : '在线 · 已停机';
  const linkText = computed(() => !state.service ? '服务离线 · 自动重连中' : !state.synced ? '正在同步状态' : !state.serial.open ? '串口未连接' : !online.value ? '板端无应答 · 检查 USB' : '板端在线');
  function clearBoard() { state.stopStatus='';state.pulse=null;state.testStoppedAt=0;state.capabilities=state.boardStatus=null;state.inventory = []; state.inventoryKnown = false; state.bindings = []; state.telemetry = {}; state.control = null; state.lastReply = 0; state.firmware = ''; collected = {}; stopAwaiting = null; for (const listener of sessionListeners) listener(); }
  function stopped() {if(stopAwaiting?.size===0){state.stopStatus=state.pulse?.configured||state.rs485.open?'已收到所有已知输出的停止应答':'板端已禁用已知通道输出';stopAwaiting=null;}}
  function clearStoppedStatus(){if(['板端已禁用已知通道输出','已收到所有已知输出的停止应答'].includes(state.stopStatus)){state.stopStatus='';stopAwaiting=null;}}
  function receive(report: Report) {
    const data = report.data;
    if (report.session !== undefined && report.session !== state.session && report.type !== 'serial') return;
    if (report.type === 'snapshot') {
      clearBoard(); state.session = data.session; state.serial = data.serial; state.lastReply = data.lastReply;
      state.inventory = data.inventory?.items ?? []; state.inventoryKnown = !!data.inventory;
      state.bindings = data.bindings.items; state.control = data.control; state.firmware = data.heartbeat?.fwVersion ?? '';
      state.capabilities=data.capabilities;state.boardStatus=data.boardStatus;
      state.pulse=data.pulseStatus;state.rs485=data.rs485??state.rs485;
      for (const item of data.telemetry) collected[item.channelId] = item;
      state.telemetry = { ...collected }; state.events = data.events.slice(-100);state.recordings=data.recordings?.items??[];state.activeRecordingId=data.recordings?.activeId??null; state.synced = true; return;
    }
    if (report.type === 'ownership') { state.isController = report.isController; state.controllerId = report.controllerId; }
    if (report.type === 'serial') { clearBoard(); state.session = report.session; state.serial = { open: report.open, path: report.path ?? '',mode:report.mode??'real' }; }
    if(report.type==='records'){state.recordings=report.items;state.activeRecordingId=report.activeId;}
    if(report.type==='capabilities')state.capabilities=data;
    if(report.type==='pulseStatus'){state.pulse=data;if(data.enabled)clearStoppedStatus();else stopAwaiting?.delete(-1);stopped();}
    if(report.type==='rs485Status'){state.rs485=data;if(data.commandEnabled)clearStoppedStatus();if(data.stopConfirmed)stopAwaiting?.delete(-2);stopped();}
    if(report.type==='boardStatus'){
      if(data.testState>1&&(state.boardStatus?.testState===1||state.boardStatus?.testId!==data.testId))state.testStoppedAt=Date.now();
      if(data.testState===1)state.testStoppedAt=0;state.boardStatus=data;
    }
    if (report.type === 'ports') state.ports = report.ports;
    if (['heartbeat','inventory','telemetry','controlReport'].includes(report.type)) state.lastReply = Date.now();
    if (report.type === 'heartbeat') state.firmware = data.fwVersion;
    if (report.type === 'inventory') { state.inventory = data.items; state.inventoryKnown = true; }
    if (report.type === 'bindings') state.bindings = data.items;
    if (report.type === 'controlReport') state.control = data;
    if (report.type === 'telemetry') for (const item of data.items) {
      if(item.enabled)clearStoppedStatus();
      collected[item.channelId] = { ...item, receivedAt: Date.now() };
      for (const listener of telemetryListeners) listener(item);
      if (stopAwaiting && !item.enabled) stopAwaiting.delete(item.channelId);
      stopped();
    }
    if (report.type === 'unbindAck' && (data.result === 0 || data.alreadyUnbound)) { delete collected[data.channelId]; state.telemetry = { ...collected }; }
    if (report.type === 'channelsRemoved') { for (const id of report.ids) delete collected[id]; state.telemetry = { ...collected }; }
    if (report.type === 'event') { state.events.push(data); if (state.events.length > 100) state.events.shift(); }
    if (report.type === 'error') state.message = report.message;
    if (report.type === 'boardTimeout') { state.lastReply = 0; state.stopStatus = '板端失联,停止结果未确认'; }
    if (report.type === 'stopRequested') {
      state.stopStatus = state.serial.open||state.rs485.open ? '已请求全停 · 等待设备应答' : '失联,停止结果未确认';
      const ids = Object.keys(collected).map(Number);if(state.pulse?.configured)ids.push(-1);if(state.rs485.open)ids.push(-2);stopAwaiting = ids.length ? new Set(ids) : null;
    }
  }
  const connection = new BenchConnection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`, receive, connected => {
    state.service = connected; state.synced = false;
    if (!connected) { state.isController = false; state.lastReply = 0; state.stopStatus = '服务失联,停止结果未确认'; for (const listener of sessionListeners) listener(); }
  });
  const timer = setInterval(() => { state.now = Date.now(); state.telemetry = { ...collected }; connection.keepAlive(); }, 200);
  connection.connect();
  async function command(value: Record<string, unknown>, boardType?: string) {
    const request = connection.command(value, boardType??(value.type==='bind'&&(state.capabilities?.flags&1)?'bindAck':undefined));
    const response = await request.promise;
    if (response.data?.result !== undefined && response.data.result !== 0 && !(response.type === 'unbindAck' && response.data.alreadyUnbound)) throw Error(`板端拒绝操作 (错误码 ${response.data.result}),请检查登记、绑定及控制方式`);
    return response;
  }
  async function act(value: Record<string, unknown>, boardType?: string) {
    if (state.busy) return;
    state.busy = true;
    try { const response = await command(value, boardType); state.message = boardType ? '板端已确认操作' : response.message; return response; }
    catch (error) { state.message = (error as Error).message; }
    finally { state.busy = false; }
  }
  function stop() { state.stopStatus = '已请求全停 · 等待板端反馈'; void command({ type: 'stopAll' }).catch(error => { state.stopStatus = `停止结果未确认 · ${error.message}`; }); }
  return { state, online, writable, testing,linkText, channelFresh, channelStatus, command, act, stop, telemetryListeners, sessionListeners,
    dispose() { clearInterval(timer); connection.dispose(); } };
}
export type Bench = ReturnType<typeof useBench>;
