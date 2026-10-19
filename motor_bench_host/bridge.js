import { randomUUID,randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ChannelBindings } from './channel_bindings.js';
import { validateCommand, READ_COMMANDS } from './command_validation.js';
import * as p from './protocol.js';
import { feedbackFresh } from './motor_rules.js';
import { DemoPort } from './demo_port.js';
import { ExperimentStore } from './experiment_store.js';
import * as v2 from './protocol_v2.js';
import {validateSequence} from './test_sequence.js';
import {StopReasonText} from './shared.js';
import {PulseCapability,buildPulseCommand,parsePulseReport,validatePulseMove} from './stepper_protocol.js';
import {Rs485Stepper} from './rs485_stepper.js';
import {ModbusStepperDemo,DEMO_STEPPER_PROFILE} from './stepper_demo.js';

const F = p.FrameType;
export function attachBridge(server, args) {
  const wss = new WebSocketServer({ server, maxPayload: 16384 });
  const bindings = new ChannelBindings(), telemetry = new Map(), pending = new Map(), ambiguous = new Set(), targets = new Map();
  let serial = null, serialInfo = { open: false }, session = 0, lastReply = 0;
  let inventory = null, heartbeat = null, control = null, parser = new p.FrameParser();
  let owner = null, leaseAt = 0, heartbeatTimer = null, serialQueue = Promise.resolve();
  let capabilities=null,boardStatus=null,helloNonce=0,wireSequence=0,lastStatusSent=0,runningTest=null;
  const wirePending=new Map();
  const events = [];
  const recordings=new ExperimentStore({onStop:()=>{broadcast(recordList());if(runningTest)stop('采集结束，自动测试中止');}}), pidSnapshots=new Map();
  const recordContext=()=>({session,firmware:heartbeat?.fwVersion??'',mode:serialInfo.mode??'real',inventory:inventory?.items??[],bindings:bindings.snapshot(),control,pidSnapshots:[...pidSnapshots.values()],capabilities});
  const send = (ws, value) => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
  const broadcast = value => { for (const ws of wss.clients) send(ws, value); };
  let pulseStatus=null;
  const rs485=new Rs485Stepper({onChange:data=>broadcast({type:'rs485Status',data})});
  const realOpen485=rs485.openPort;
  rs485.openPort=config=>config.mode==='demo'?Promise.resolve(new ModbusStepperDemo()):realOpen485(config);
  const event = (message, level = 'info') => {
    events.push({ time: Date.now(), message, level }); if (events.length > 100) events.shift();
    broadcast({ type: 'event', data: events.at(-1) });
    recordings.recordEvent(message,{level});
  };
  const recordList=()=>({type:'records',items:recordings.list(),activeId:recordings.active?.id??null});
  const result = (ws, cmd, ok, message, stage = 'sent') => send(ws, { type: 'commandResult', requestId: cmd?.requestId, command: cmd?.type, ok, message, stage, session });
  const ownership = () => { for (const ws of wss.clients) send(ws, { type: 'ownership', clientId: ws.clientId, controllerId: owner?.clientId ?? null, isController: ws === owner }); };
  const bindingReport = () => ({ type: 'bindings', data: { items: bindings.snapshot() }, session });
  const snapshot = ws => send(ws, { type: 'snapshot', data: {
    session, serial: serialInfo, lastReply, inventory, heartbeat, control,
    telemetry: [...telemetry.values()], bindings: { items: bindings.snapshot() }, events,recordings:recordList(),capabilities,boardStatus,pulseStatus,rs485:rs485.snapshot(),
  } });
  function write(bytes) {
    if (!serial?.isOpen) throw Error('串口未连接,指令未下发');
    serial.write(bytes, error => { if (error) { targets.clear(); event(`串口写入失败: ${error.message}`, 'error'); broadcast({ type: 'error', message: '串口写入失败,请停止操作并重新连接' }); } });
    return true;
  }
  function stop(reason) {
    if(rs485.snapshot().open)void rs485.stop().catch(error=>event(`RS-485 停止未确认：${error.message}`,'error'));
    finishTest('aborted',reason);
    targets.clear();
    if (serial?.isOpen) { try { write(p.buildAllStop()); } catch (error) { event(error.message, 'error'); } }
    event(reason, 'warning'); broadcast({ type: 'stopRequested', reason, session });
  }
  function reset() {
    pulseStatus=null;
    finishTest('aborted','串口或板端会话结束');
    if(recordings.active){recordings.stop('串口会话结束');broadcast(recordList());}pidSnapshots.clear();
    targets.clear(); bindings.reset(); parser = new p.FrameParser();
    inventory = heartbeat = control = null; telemetry.clear(); lastReply = 0;
    for (const item of pending.values()) result(item.ws, item.cmd, false, '串口会话改变,结果未确认', 'unconfirmed');
    pending.clear(); ambiguous.clear();
    for(const item of wirePending.values())if(item.ws)result(item.ws,item.cmd,false,'板端会话改变，结果未确认','unconfirmed');
    wirePending.clear();capabilities=boardStatus=null;wireSequence=0;
  }
  function finishTest(outcome,reason){
    if(!runningTest)return;const current=runningTest;runningTest=null;
    for(const[sequence,item]of wirePending)if(item.type==='sequenceStart'&&item.testId===current.testId){wirePending.delete(sequence);if(item.ws)result(item.ws,item.cmd,false,'测试已结束，原关联应答未收到','unconfirmed');}
    const r=recordings.get(current.recordId);r.context.test.outcome=outcome;
    if(recordings.active?.id===current.recordId)recordings.stop(reason);
  }
  function wireCommand(type,cmd,ws){
    if(!capabilities?.boardSession)throw Error('固件尚未协商新协议能力');
    const sequence=++wireSequence;if(sequence>0xffffffff)throw Error('指令序号已用尽，请重新连接');
    const token=capabilities.boardSession;
    const bytes=type.startsWith('pulse')?buildPulseCommand(token,sequence,cmd):type==='bind'?v2.buildBindV2(token,sequence,cmd):type==='queryBindings'?v2.buildChannelQuery(token,sequence):type==='sequenceStart'?v2.buildTestStart(token,sequence,cmd):v2.buildTestCancel(token,sequence);
    wirePending.set(sequence,{type,ws,cmd,testId:type==='sequenceStart'?sequence:runningTest?.testId,deadline:Date.now()+2500});
    try{write(bytes);}catch(error){wirePending.delete(sequence);throw error;}
    return sequence;
  }
  function negotiate(){helloNonce=randomBytes(4).readUInt32LE()||1;write(v2.buildHello(helloNonce));}
  function boardReset(){
    stop('板端会话重置，需重新确认后使能');reset();session++;serial.benchSession=session;
    broadcast({type:'serial',...serialInfo,session});negotiate();write(p.buildHeartbeat());write(p.buildInventoryQuery());write(p.buildQuery());
  }
  function receiveV2(type,data){
    if(type==='capabilities'){
      if(data.helloNonce!==helloNonce)return;
      capabilities=data;broadcast({type,data,session});
      if(data.boardSession&&(data.flags&2))wireCommand('queryBindings',{},null);
      return;
    }
    if(!capabilities?.boardSession)return;
    if(data.boardSession===0){boardReset();return;}
    if(data.boardSession!==capabilities.boardSession)return;
    if(type==='pulseStatus'){
      if(data.sequence){const item=wirePending.get(data.sequence);if(!item||!item.type.startsWith('pulse')||data.command!==({pulseConfig:20,pulseMove:21,pulseEnable:22,pulseQuery:23}[item.type]))return;wirePending.delete(data.sequence);if(item.ws)result(item.ws,item.cmd,data.result===0,data.result===0?'步进指令已由板端确认':`板端拒绝步进指令（错误码 ${data.result}）`,'board');}
      pulseStatus={...data,receivedAt:Date.now()};broadcast({type,data:pulseStatus,session});return;
    }
    if(type==='boardStatus'){
      const changed=String([boardStatus?.stopReason,boardStatus?.testState,boardStatus?.testId])!==String([data.stopReason,data.testState,data.testId]);boardStatus=data;
      if(changed)recordings.recordEvent('板端停止与测试状态',data);
      if(runningTest&&data.testId===runningTest.testId){
        const context=recordings.get(runningTest.recordId).context.test;if(context.startedAt===null)context.startedAt=data.startedAt;
        if(data.testState!==1)finishTest(data.testState===2?'completed':data.testState===3?'canceled':'aborted',StopReasonText[data.stopReason]);
      }
      if(changed||Date.now()-lastStatusSent>=100){lastStatusSent=Date.now();broadcast({type,data,session});}return;
    }
    const item=wirePending.get(data.sequence);if(!item)return;
    const expected=type==='bindAck'?'bind':type==='channelReport'?'queryBindings':data.command===F.TEST_START?'sequenceStart':'sequenceCancel';
    if(item.type!==expected)return;
    if(type==='testAck'&&data.result===0&&(item.type==='sequenceStart'||item.testId!==undefined)&&data.testId!==item.testId)return;
    if(type==='bindAck'&&['channelId','kind','canBus','motorId','outerLoop'].some(key=>data[key]!==item.cmd[key]))return;
    wirePending.delete(data.sequence);
    if(type==='channelReport'){
      const retained=new Set(data.items.map(b=>b.channelId)),removed=[...telemetry.keys()].filter(id=>!retained.has(id));
      for(const id of removed){telemetry.delete(id);targets.delete(id);pidSnapshots.delete(id);}
      if(removed.length)broadcast({type:'channelsRemoved',ids:removed,session});
      bindings.authoritative(data.items);broadcast(bindingReport());
    }
    if(type==='bindAck'&&data.result===0){bindings.authoritative([...bindings.snapshot().filter(b=>b.channelId!==data.channelId),{channelId:data.channelId,kind:data.kind,canBus:data.canBus,motorId:data.motorId,outerLoop:data.outerLoop}]);broadcast(bindingReport());}
    if(type==='testAck'&&item.type==='sequenceStart'&&runningTest){
      if(data.result===0){runningTest.testId=data.testId;recordings.get(runningTest.recordId).context.test.startedAt=data.startedAt;}
      else finishTest('rejected','板端拒绝自动测试');
    }
    recordings.recordEvent(type,data);broadcast({type,data,requestId:item.cmd?.requestId,session});
  }
  const serialOperation = fn => {
    const operation = serialQueue.then(fn); serialQueue = operation.catch(() => {}); return operation;
  };
  async function closeSerial() {
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    if (serial?.isOpen) {
      stop('串口关闭,已请求全停'); const port = serial;
      await new Promise(resolve => port.drain ? port.drain(() => resolve()) : resolve());
      await new Promise((resolve, reject) => port.close(error => error ? reject(error) : resolve()));
    }
    serial = null; serialInfo = { open: false }; reset(); broadcast({ type: 'serial', ...serialInfo, session });
  }
  function keyFor(cmd) {
    if (['addMotor','removeMotor'].includes(cmd.type)) return `motor:${cmd.kind}:${cmd.canBus}:${cmd.motorId}`;
    if (cmd.type === 'pidSet') return `pidAck:${cmd.channelId}:${cmd.loop}`;
    if (['pidQuery','unbind'].includes(cmd.type)) return `${cmd.type === 'pidQuery' ? 'pidReport' : 'unbindAck'}:${cmd.channelId}`;
    if (cmd.type === 'controlSource') return 'controlReport';
    return null;
  }
  function report(type, data, key) {
    let item = key && pending.get(key);
    if (item && type === 'controlReport' && data.result === 0) {
      const cmd = item.cmd;
      const matches = data.source === cmd.source && (cmd.source === 0 ||
        (Math.abs(data.maxRef - cmd.maxRef) < 0.01 && (cmd.source === 1 ? data.channelId === cmd.channelId :
          String(data.channels) === String(cmd.channels) && data.reverseMask === (cmd.reverseMask ?? 0))));
      if (!matches) item = null;
    }
    if (item) pending.delete(key);
    broadcast({ type, data, requestId: item?.cmd.requestId, session });
  }
  function receive(chunk, port, portSession) {
    if (port !== serial || portSession !== session) return;
    const parsers = {
      [F.HEARTBEAT]: ['heartbeat', p.parseHeartbeatAck], [F.TELEMETRY]: ['telemetry', v2.parseTimedTelemetry],
      [F.INVENTORY_REPORT]: ['inventory', p.parseInventory], [F.MOTOR_ADD_ACK]: ['motorAck', p.parseMotorAddAck],
      [F.PID_REPORT]: ['pidReport', p.parsePidReport], [F.PID_SET_ACK]: ['pidAck', p.parsePidSetAck],
      [F.UNBIND_ACK]: ['unbindAck', p.parseUnbindAck], [F.CONTROL_REPORT]: ['controlReport', p.parseControlReport],
      [F.CAPABILITIES]:['capabilities',v2.parseCapabilities],[F.BIND_ACK]:['bindAck',v2.parseBindAck],[F.CHANNEL_REPORT]:['channelReport',v2.parseChannelReport],[F.BOARD_STATUS]:['boardStatus',v2.parseBoardStatus],[F.TEST_ACK]:['testAck',v2.parseTestAck],
      [0x95]:['pulseStatus',parsePulseReport],
    };
    for (const frame of parser.push(chunk)) {
      const entry = parsers[frame.type]; if (!entry) continue;
      const [type, parse] = entry, data = parse(frame.payload); if (!data) continue;
      if(['capabilities','bindAck','channelReport','boardStatus','testAck','pulseStatus'].includes(type)){receiveV2(type,data);continue;}
      if(type==='telemetry'&&capabilities?.boardSession){
        if(data.boardSession===0){boardReset();continue;}
        if(data.boardSession!==capabilities.boardSession)continue;
      }
      lastReply = Date.now();
      if (type === 'heartbeat') heartbeat = data;
      if (type === 'controlReport') {if(JSON.stringify([control?.source,control?.channelId,control?.maxRef,control?.channels,control?.reverseMask])!==JSON.stringify([data.source,data.channelId,data.maxRef,data.channels,data.reverseMask]))recordings.recordEvent('控制来源板端状态',data);control = data;}
      if (type === 'telemetry') {
        if(data.boardMs!==undefined)for(const item of data.items)Object.assign(item,{boardMs:data.boardMs,boardSession:data.boardSession});
        for (const item of data.items) if (item.channelId >= 0 && item.channelId < 8) telemetry.set(item.channelId, { ...item, receivedAt: lastReply });
        if (bindings.telemetry(data.items)) broadcast(bindingReport());
        const active=recordings.active;for(const item of data.items)if(item.channelId>=0&&item.channelId<8)recordings.append(item,recordContext(),lastReply);
        if(active&&!recordings.active)broadcast(recordList());
      }
      if(type==='pidReport'){pidSnapshots.set(data.channelId,data);recordings.recordEvent('PID板端读回',data);}
      if(['pidAck','motorAck','unbindAck','controlReport','bindings','inventory'].includes(type)&&type!=='controlReport')recordings.recordEvent(type,data);
      if (type === 'inventory') {
        const previous = bindings.snapshot(); inventory = data; bindings.inventory(data.items);
        const retained = new Set(bindings.snapshot().map(b => b.channelId));
        const removed = data.items.length ? previous.filter(b => !retained.has(b.channelId)).map(b => b.channelId) : [...telemetry.keys()];
        for (const id of removed) { telemetry.delete(id); targets.delete(id);pidSnapshots.delete(id); }
        if (removed.length) broadcast({ type: 'channelsRemoved', ids: removed, session });
        broadcast(bindingReport());
      }
      if (type === 'unbindAck') {
        if(data.result===0)pidSnapshots.delete(data.channelId);
        const known = bindings.seen.has(data.channelId); bindings.unbind(data);
        data.alreadyUnbound = data.result === 1 && !known;
        if (data.result === 0 || (data.result === 1 && !known)) telemetry.delete(data.channelId);
        broadcast(bindingReport());
      }
      const key = type === 'motorAck' ? `motor:${data.kind}:${data.canBus}:${data.motorId}`
        : type === 'pidAck' ? `pidAck:${data.channelId}:${data.loop}`
        : ['pidReport','unbindAck'].includes(type) ? `${type}:${data.channelId}` : type === 'controlReport' ? type : null;
      report(type, data, key);
    }
  }
  async function openSerial(cmd, ws) {
    if (owner !== ws || ws.readyState !== 1) throw Error('控制权已失效,串口操作已取消');
    if(serial?.isOpen&&(cmd.type==='startDemo'||serialInfo.mode==='demo'))throw Error('演示与真实串口互斥，请先关闭当前连接');
    const stepper=rs485.snapshot();
    if(stepper.open&&((cmd.type==='startDemo')!==(stepper.mode==='demo')))throw Error('演示与真实设备互斥，请先关闭另一种连接');
    if(stepper.open&&stepper.path.toUpperCase()===cmd.path?.toUpperCase())throw Error('该串口已用于 RS-485，不能同时连接开发板');
    await closeSerial(); session++; reset(); const SerialPort = cmd.type==='startDemo'?DemoPort:(await import('serialport')).SerialPort;
    if (owner !== ws || ws.readyState !== 1) throw Error('控制权已失效,串口操作已取消');
    await new Promise((resolve, reject) => {
      const portSession = session;
      const port = new SerialPort({ path: cmd.path, baudRate: cmd.baud ?? args.baud, autoOpen: true }, error => {
        if (error) { serial = null; return reject(error); }
        serialInfo = { open: true, path: cmd.type==='startDemo'?'DEMO · 模拟数据':cmd.path, baud: cmd.baud ?? args.baud,mode:cmd.type==='startDemo'?'demo':'real' };
        if(cmd.type==='startDemo'){bindings.inventory([]);for(const b of port.initialBindings)bindings.request(b);}
        broadcast({ type: 'serial', ...serialInfo, session });
        if (owner !== ws || ws.readyState !== 1) stop('串口打开期间控制权失效,已请求全停');
        write(p.buildAllStop()); write(p.buildHeartbeat()); write(p.buildInventoryQuery()); write(p.buildQuery());negotiate();
        heartbeatTimer = setInterval(() => { try { write(p.buildHeartbeat()); } catch { /* close clears timer */ } }, 200);
        event(`已打开 ${serialInfo.path}`); resolve();
      });
      serial = port;
      port.benchSession=portSession;
      port.on('data', chunk => receive(chunk, port, port.benchSession));
      port.on('error', error => { if (serial === port) { stop(`串口错误: ${error.message}`); broadcast({ type: 'error', message: `串口错误: ${error.message}` }); } });
      port.on('close', () => {
        if (serial !== port) return;
        clearInterval(heartbeatTimer); heartbeatTimer = null; serial = null; serialInfo = { open: false }; reset();
        broadcast({ type: 'serial', open: false, session });
      });
    });
  }
  function execute(cmd) {
    switch (cmd.type) {
      case 'bind':pidSnapshots.delete(cmd.channelId); bindings.request(cmd); write(p.buildBind(cmd.channelId, { ...cmd, outerLoop: cmd.outerLoop ?? 2 })); break;
      case 'identifyChannel': bindings.identify(cmd); broadcast(bindingReport()); break;
      case 'setRef': targets.set(cmd.channelId, cmd.ref); break;
      case 'enable': targets.delete(cmd.channelId); write(p.buildEnable(cmd.channelId, cmd.enable)); break;
      case 'stopAll': stop('用户请求全停,等待板端禁用反馈'); break;
      case 'query': write(p.buildQuery()); break;
      case 'scanMotors': write(p.buildInventoryQuery()); break;
      case 'addMotor': write(p.buildMotorAdd(cmd.kind, cmd.canBus, cmd.motorId)); break;
      case 'removeMotor': write(p.buildMotorRemove(cmd.kind, cmd.canBus, cmd.motorId)); break;
      case 'unbind': targets.delete(cmd.channelId); write(p.buildEnable(cmd.channelId, false)); write(p.buildUnbind(cmd.channelId)); break;
      case 'pidSet': targets.clear();pidSnapshots.delete(cmd.channelId);recordings.recordEvent('PID写入请求',{channelId:cmd.channelId,loop:cmd.loop,pid:cmd.pid}); write(p.buildSetPid(cmd.channelId, cmd.loop, cmd.pid)); break;
      case 'pidQuery': write(p.buildPidQuery(cmd.channelId)); break;
      case 'controlSource': targets.clear(); write(p.buildAllStop()); write(cmd.source >= 2 ? p.buildChassisControl(cmd.source, cmd.channels, cmd.maxRef, cmd.reverseMask ?? 0) : p.buildControlSource(cmd.source, cmd.channelId ?? 0, cmd.maxRef ?? 0)); break;
      case 'chassisEnable': targets.clear(); write(p.buildChassisEnable(cmd.enable)); break;
    }
  }
  async function handle(ws, cmd) {
    try {
      validateCommand(cmd, { inventory: inventory?.items ?? [], bindings: bindings.snapshot(), telemetry, control });
      if (cmd.type === 'keepAlive') { if (owner === ws) leaseAt = Date.now(); return; }
      if (cmd.type === 'claimControl') {
        if (owner && owner !== ws && !cmd.takeover) throw Error('已有控制者,请使用主动接管');
        if (owner !== ws) stop('控制权切换,已请求全停;需重新使能');
        owner = ws; leaseAt = Date.now(); ownership(); result(ws, cmd, true, '已取得控制权', 'service'); return;
      }
      if (!READ_COMMANDS.has(cmd.type) && cmd.type !== 'stopAll' && owner !== ws) throw Error('当前页面仅观察,请主动接管控制权');
      if(runningTest&&!READ_COMMANDS.has(cmd.type)&&!['stopAll','closeSerial','sequenceCancel','rs485Stop','rs485Close'].includes(cmd.type)&&!(cmd.type==='pulseEnable'&&!cmd.enable))throw Error('自动测试进行中，请先取消或急停');
      if (owner === ws) leaseAt = Date.now();
      if(cmd.type==='stopAll'){stop('用户请求全停，等待设备确认');result(ws,cmd,true,'已请求全部电机停止，结果以反馈为准','service');return;}
      if(cmd.type.startsWith('rs485')){
        if(['rs485Open','rs485Demo','rs485Close'].includes(cmd.type))await serialOperation(async()=>{
          if(owner!==ws||ws.readyState!==1)throw Error('控制权已失效，连接已取消');
          if(cmd.type==='rs485Close'){await rs485.close();return;}
          const demo=cmd.type==='rs485Demo';
          if(serialInfo.open&&demo!==(serialInfo.mode==='demo'))throw Error('演示与真实设备互斥，请先关闭另一种连接');
          if(serialInfo.open&&serialInfo.path?.toUpperCase()===cmd.path?.toUpperCase())throw Error('该串口已用于开发板，请选择 USB-485 串口');
          await rs485.open(demo?{path:'DEMO485',baud:115200,slave:1,parity:'none',stopBits:1,mode:'demo'}:cmd,demo?DEMO_STEPPER_PROFILE:cmd.profile);
          if(owner!==ws||ws.readyState!==1){await rs485.close();throw Error('控制权已失效，连接已取消');}
        });
        else if(cmd.type==='rs485Stop')await rs485.stop();
        else if(cmd.type==='rs485Enable')await rs485.enable();
        else if(cmd.type==='rs485Move')await rs485.move(cmd);
        else if(cmd.type==='rs485Query')await rs485.refresh();
        result(ws,cmd,true,'RS-485 应答已校验；实际运动以反馈和现场观察为准','service');return;
      }
      if (cmd.type === 'getSnapshot') { snapshot(ws); result(ws, cmd, true, '状态已同步', 'service'); return; }
      if(cmd.type==='recordList'){send(ws,recordList());result(ws,cmd,true,'记录列表已同步','service');return;}
      if(cmd.type==='recordGet'){const record=recordings.get(cmd.id);if(record.endedAt===null)throw Error('请先结束记录再获取回放');send(ws,{type:'recordData',data:record,requestId:cmd.requestId});result(ws,cmd,true,'记录已读取','service');return;}
      if(cmd.type==='recordUpdate'||cmd.type==='recordDelete'){if(cmd.type==='recordUpdate')recordings.update(cmd.id,cmd.name,cmd.notes);else recordings.remove(cmd.id);broadcast(recordList());result(ws,cmd,true,'记录已更新','service');return;}
      if(cmd.type==='recordStop'){recordings.stop();broadcast(recordList());result(ws,cmd,true,'记录已结束，电机运行不受影响','service');return;}
      if(cmd.type==='recordStart'){if(!serial?.isOpen||!lastReply||Date.now()-lastReply>1500)throw Error('请先连接在线设备或进入演示');recordings.start(cmd.name,recordContext());broadcast(recordList());result(ws,cmd,true,'已开始记录','service');return;}
      if (cmd.type === 'listPorts') {
        const { SerialPort } = await import('serialport'); const ports = await SerialPort.list();
        send(ws, { type: 'ports', ports: ports.map(({ path, manufacturer, friendlyName, serialNumber }) => ({ path, manufacturer, friendlyName, serialNumber })) });
        result(ws, cmd, true, '串口列表已刷新', 'service'); return;
      }
      if (cmd.type === 'openSerial' || cmd.type === 'closeSerial'||cmd.type==='startDemo') {
        await serialOperation(async () => { if (owner !== ws) throw Error('控制权已失效'); if (cmd.type !== 'closeSerial') await openSerial(cmd, ws); else await closeSerial(); });
        result(ws, cmd, true, cmd.type !== 'closeSerial' ? '连接已打开,等待反馈' : '连接已关闭', 'service'); return;
      }
      if (cmd.type !== 'identifyChannel' && !serial?.isOpen) throw Error('串口未连接,请先打开串口');
      if (!['stopAll','query','scanMotors','identifyChannel'].includes(cmd.type) && (!lastReply || Date.now() - lastReply > 1500)) throw Error('板端尚未确认或已无应答,请检查 USB 并重新同步');
      if(cmd.type.startsWith('pulse')){
        if(!(capabilities?.flags&PulseCapability))throw Error('当前固件不支持脉冲步进，请更新 A/C 板固件');
        if(cmd.type!=='pulseQuery'&&!(cmd.type==='pulseEnable'&&!cmd.enable)&&control?.source!==0)throw Error('请先切换网页控制方式');
        if(cmd.type==='pulseMove'){
          if(!pulseStatus?.configured||!pulseStatus.enabled||Date.now()-pulseStatus.receivedAt>1500)throw Error('请先配置、使能并确认新鲜步进状态');
          validatePulseMove(cmd,pulseStatus);
        }
        wireCommand(cmd.type,cmd,ws);return;
      }
      if(['queryBindings','sequenceStart','sequenceCancel'].includes(cmd.type)||(cmd.type==='bind'&&(capabilities?.flags&1))){
        if(cmd.type==='sequenceStart'){
          if(!(capabilities?.flags&8))throw Error('当前固件不支持板端自动测试，请升级对应板型固件');
          if(recordings.active)throw Error('请先结束当前记录，再开始自动测试');
          if([...telemetry.values()].some(s=>s.enabled))throw Error('请先停止所有通道输出');
          if(pulseStatus?.enabled)throw Error('请先停止步进输出');
          const b=bindings.snapshot().find(b=>b.channelId===cmd.channelId);const config=validateSequence(cmd,b);
          if(!feedbackFresh(telemetry.get(cmd.channelId))||!telemetry.get(cmd.channelId)?.online||control?.source!==0)throw Error('测试需要新鲜在线反馈及网页控制来源');
          const label={step:'阶跃',ramp:'斜坡',reversal:'正反转'}[config.mode];
          const recordId=recordings.start(`自动测试 · ${label}`,{...recordContext(),test:{...b,...config,boardSession:capabilities.boardSession,startedAt:null,outcome:'running'}});
          runningTest={recordId,testId:wireSequence+1};broadcast(recordList());
        }
        try{const sequence=wireCommand(cmd.type,cmd,ws);if(runningTest&&cmd.type==='sequenceStart')runningTest.testId=sequence;}
        catch(error){if(cmd.type==='sequenceStart')finishTest('aborted',error.message);throw error;}
        result(ws,cmd,true,'已下发，等待板端关联应答');return;
      }
      const key = keyFor(cmd);
      if (key && (pending.has(key) || ambiguous.has(key))) throw Error('相同操作尚未确认;旧协议无请求序号,超时后请重新连接串口再核对');
      if (key && cmd.requestId) pending.set(key, { ws, cmd, deadline: Date.now() + 2500 });
      try { execute(cmd); } catch (error) { if (key) pending.delete(key); throw error; }
      result(ws, cmd, true, cmd.type === 'identifyChannel' ? '已保存显示识别,未改变板端绑定' : '服务已接收,板端结果以反馈为准');
      if (!READ_COMMANDS.has(cmd.type) && cmd.type !== 'setRef') event(`${cmd.type}${Number.isInteger(cmd.channelId) ? ` · 通道 ${cmd.channelId}` : ''} 已发送`);
    } catch (error) { result(ws, cmd, false, error.message, 'rejected'); }
  }
  wss.on('connection', ws => {
    ws.clientId = randomUUID(); if (!owner) { owner = ws; leaseAt = Date.now(); }
    send(ws, { type: 'hello', protocol: 'motor-bench/1.0', clientId: ws.clientId }); ownership(); snapshot(ws); send(ws, bindingReport());
    ws.on('message', bytes => { try { void handle(ws, JSON.parse(bytes.toString())); } catch { result(ws, {}, false, 'JSON 格式无效', 'rejected'); } });
    ws.on('close', () => { if (owner === ws) { stop('控制页面已断开,已请求全停'); owner = null; ownership(); } });
    ws.on('error', () => {});
  });
  const targetTimer = setInterval(() => {
    if (!targets.size) return;
    if (!owner || !lastReply || Date.now() - lastReply > 1500) { targets.clear(); return; }
    for (const [id, ref] of targets) { try { if (feedbackFresh(telemetry.get(id)) && telemetry.get(id)?.enabled && control?.source === 0) write(p.buildSetRef(id, ref)); } catch (error) { event(error.message, 'error'); } }
    targets.clear();
  }, 25);
  const watchdog = setInterval(() => {
    for(const[sequence,item]of wirePending)if(Date.now()>item.deadline){wirePending.delete(sequence);if(item.ws)result(item.ws,item.cmd,false,'板端关联应答超时，结果未确认','unconfirmed');if(runningTest&&item.testId===runningTest.testId&&(item.type==='sequenceStart'||item.type==='sequenceCancel'))stop('自动测试应答超时，已请求全停');}
    const active=recordings.active;recordings.tick();if(active&&!recordings.active)broadcast(recordList());
    if (owner && Date.now() - leaseAt > 4000) { stop('控制权心跳超时,已请求全停'); owner = null; ownership(); }
    for (const [key, item] of pending) if (Date.now() > item.deadline) { pending.delete(key); ambiguous.add(key); result(item.ws, item.cmd, false, '板端应答超时,结果未确认;请重新连接串口并核对', 'unconfirmed'); }
    if (lastReply && Date.now() - lastReply > 1500) { lastReply = 0; stop('板端无应答,停止结果未确认');recordings.stop('板端失联，记录中止');broadcast(recordList()); broadcast({ type: 'boardTimeout', session }); }
  }, 200);
  server.on('close', () => { clearInterval(targetTimer); clearInterval(watchdog); clearInterval(heartbeatTimer); wss.close(); });
  return { stop, close: () => serialOperation(async()=>{await rs485.close();await closeSerial();}) };
}
