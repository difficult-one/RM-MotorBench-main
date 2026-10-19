import { motorKey, registrationError, targetSpec, feedbackFresh } from './motor_rules.js';
import {validateSequence} from './test_sequence.js';
import {validatePulseConfig} from './stepper_protocol.js';
import {validateProfile} from './modbus_rtu.js';
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw Error(`${label}应为 ${min}–${max} 的整数`);
};
const finite = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${label}应为 ${min}–${max} 的有限数值`);
};
const boolean = value => { if (typeof value !== 'boolean') throw Error('使能值必须为布尔值'); };
const motor = cmd => {
  integer(cmd.kind, 1, 4, '型号'); integer(cmd.canBus, 1, 2, '总线');
  integer(cmd.motorId, 1, cmd.kind === 1 ? 7 : cmd.kind === 4 ? 255 : 8, '电机 ID');
};
export const READ_COMMANDS = new Set(['getSnapshot', 'listPorts', 'scanMotors', 'query', 'pidQuery', 'keepAlive','recordList','recordGet','queryBindings','pulseQuery','rs485Query']);
export function validateCommand(cmd, { inventory, bindings, telemetry, control }) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd) || typeof cmd.type !== 'string') throw Error('指令格式无效');
  if (cmd.requestId !== undefined && (typeof cmd.requestId !== 'string' || !cmd.requestId.length || cmd.requestId.length > 100)) throw Error('请求标识无效');
  const bindingFor = id => {
    const binding = bindings.find(m => m.channelId === id);
    if (!binding || binding.identified) throw Error('通道身份尚未由当前会话确认,请显式解绑后重新绑定');
    return binding;
  };
  if (['bind','setRef','enable','unbind','pidSet','pidQuery','identifyChannel'].includes(cmd.type)) integer(cmd.channelId, 0, 7, '通道');
  switch (cmd.type) {
    case 'pulseConfig': validatePulseConfig(cmd);break;
    case 'pulseEnable': boolean(cmd.enable);break;
    case 'pulseMove': case 'rs485Move':
      if(!['speed','relative'].includes(cmd.mode))throw Error('步进运动模式无效');
      finite(cmd.rpm,-3000,3000,'转速');
      if(cmd.mode==='relative')integer(cmd.steps,-10000000,10000000,'脉冲数');break;
    case 'pulseQuery': case 'rs485Query': case 'rs485Demo': case 'rs485Close': case 'rs485Enable': case 'rs485Stop': break;
    case 'rs485Open': validateProfile(cmd.profile);break;
    case 'queryBindings': case 'sequenceCancel': break;
    case 'sequenceStart':validateSequence(cmd,bindingFor(cmd.channelId));break;
    case 'startDemo': case 'recordList': case 'recordStop': break;
    case 'recordStart': if(typeof cmd.name!=='string'||!cmd.name.trim()||cmd.name.length>80)throw Error('记录名称无效');break;
    case 'recordGet': case 'recordDelete': case 'recordUpdate':
      if(typeof cmd.id!=='string'||cmd.id.length>80)throw Error('记录标识无效');
      if(cmd.type==='recordUpdate'&&(typeof cmd.name!=='string'||!cmd.name.trim()||cmd.name.length>80||typeof cmd.notes!=='string'||cmd.notes.length>1000))throw Error('记录名称或备注无效');break;
    case 'getSnapshot': case 'listPorts': case 'scanMotors': case 'query': case 'keepAlive': case 'stopAll': case 'closeSerial': break;
    case 'claimControl': if (cmd.takeover !== undefined) boolean(cmd.takeover); break;
    case 'openSerial':
      if (typeof cmd.path !== 'string' || !cmd.path.trim() || cmd.path.length > 256) throw Error('请选择有效串口');
      if (cmd.baud !== undefined) integer(cmd.baud, 1200, 3000000, '波特率');
      break;
    case 'addMotor': case 'removeMotor': {
      motor(cmd);
      if (cmd.type === 'addMotor') { const error = registrationError(cmd, inventory); if (error) throw Error(error); }
      else if (!inventory.some(m => motorKey(m) === motorKey(cmd))) throw Error('电机未登记,请刷新清单');
      break;
    }
    case 'bind':
      motor(cmd);
      if (!(cmd.kind === 4 ? [2] : [0,1,2,4]).includes(cmd.outerLoop ?? 2)) throw Error('该型号不支持此控制环;达妙当前仅支持速度环');
      if (!inventory.some(m => motorKey(m) === motorKey(cmd))) throw Error('请先登记电机并刷新清单');
      if (telemetry.has(cmd.channelId) || bindings.some(m => m.channelId === cmd.channelId || motorKey(m) === motorKey(cmd))) throw Error('通道或电机已被占用,请先解绑');
      break;
    case 'identifyChannel':
      if (cmd.kind !== 0) { motor(cmd); if (!(cmd.kind === 4 ? [2] : [0,1,2,4]).includes(cmd.outerLoop)) throw Error('控制环无效'); }
      break;
    case 'setRef': {
      const binding = bindingFor(cmd.channelId); const spec = targetSpec(binding.kind, binding.outerLoop);
      finite(cmd.ref, -spec.limit, spec.limit, `目标值 (${spec.unit})`);
      if (!feedbackFresh(telemetry.get(cmd.channelId))) throw Error('通道反馈已过期,请检查电机反馈后再操作');
      if (control?.source !== 0) throw Error('请先切换并确认网页控制方式');
      if (!telemetry.get(cmd.channelId)?.enabled) throw Error('请先使能,再下发目标');
      break;
    }
    case 'enable':
      boolean(cmd.enable);
      if (cmd.enable) {
        bindingFor(cmd.channelId);
        if (!feedbackFresh(telemetry.get(cmd.channelId)) || !telemetry.get(cmd.channelId)?.online) throw Error('电机反馈离线或已过期,请检查供电和 CAN 接线');
        if (!control || control.source >= 2 || (control.source === 1 && (!control.ready || control.channelId !== cmd.channelId))) throw Error('请确认控制方式,遥控时须回中后重新使能');
      }
      break;
    case 'unbind': break;
    case 'pidQuery':
      if (bindingFor(cmd.channelId).kind === 4) throw Error('当前达妙固件不支持 PID 读回');
      break;
    case 'pidSet': {
      const binding = bindingFor(cmd.channelId); integer(cmd.loop, 0, 2, 'PID 环');
      if (binding.kind === 4) throw Error('当前达妙固件尚未支持运行期 PID 写入');
      if (!cmd.pid || typeof cmd.pid !== 'object') throw Error('缺少 PID 参数');
      for (const field of ['Kp','Ki','Kd']) finite(cmd.pid[field], 0, 655.35, field);
      for (const field of ['MaxOut','IntegralLimit']) finite(cmd.pid[field], 0, 2147483647, field);
      if (cmd.pid.improve !== undefined) integer(cmd.pid.improve, 0, 255, 'PID 改进标志');
      break;
    }
    case 'controlSource': {
      integer(cmd.source, 0, 3, '控制方式');
      if (cmd.source === 0) break;
      const ids = cmd.source >= 2 ? cmd.channels : [cmd.channelId];
      if (!Array.isArray(ids) || ids.length !== (cmd.source >= 2 ? 4 : 1) || new Set(ids).size !== ids.length) throw Error('轮通道必须完整且互不重复');
      const members = ids.map(id => { integer(id, 0, 7, '控制通道'); return bindingFor(id); });
      if (members.some(m => m.outerLoop !== 2) || (cmd.source >= 2 && members.some(m => m.kind > 3 || m.kind !== members[0].kind))) throw Error('底盘须为四个同型号 DJI 速度环,单电机遥控须为速度环');
      finite(cmd.maxRef, 0.01, targetSpec(members[0].kind).limit, '遥控最大转速');
      if (cmd.source >= 2) integer(cmd.reverseMask ?? 0, 0, 15, '反向掩码');
      break;
    }
    case 'chassisEnable':
      boolean(cmd.enable);
      if (cmd.enable && (!control || control.source < 2 || !control.ready || control.channels.some(id => !feedbackFresh(telemetry.get(id)) || !telemetry.get(id)?.online))) throw Error('请确认底盘配置、反馈在线,并将拨杆上档、摇杆回中');
      break;
    default: throw Error(`未知指令: ${cmd.type}`);
  }
  return cmd;
}
