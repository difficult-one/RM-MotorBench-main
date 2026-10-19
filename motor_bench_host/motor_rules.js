import { MotorKindLabel } from './shared.js';
export const CHANNEL_MAX = 8;
export const motorKey = motor => `${motor.kind}:${motor.canBus}:${motor.motorId}`;
export const feedbackFresh = (item, now = Date.now()) => !!item && Number.isFinite(item.receivedAt) && now - item.receivedAt >= 0 && now - item.receivedAt <= 1500;
export function targetSpec(kind, loop = 2) {
  if (kind === 4) return { unit: 'rad/s', limit: 40, label: '角速度' };
  if (loop === 4) return { unit: '°', limit: 12000, label: '位置目标' };
  if (loop === 1 || loop === 0) return { unit: '原始量', limit: kind === 3 ? 10000 : 12000, label: loop === 0 ? '开环输出' : '电流目标' };
  return { unit: 'rpm', limit: kind === 3 ? 7000 : 6000, label: '转子转速' };
}
export const motorLabel = motor => `${MotorKindLabel[motor.kind] ?? '未知型号'} · CAN${motor.canBus} / ID${motor.motorId}`;
export function registrationError(motor, inventory) {
  if (inventory.length >= CHANNEL_MAX) return '已达到应用登记上限 8 颗,请先移除不用的电机';
  const rxId = m => m.kind === 4 ? 0 : (m.kind === 1 ? 0x204 : 0x200) + m.motorId;
  if (inventory.some(m => m.canBus === motor.canBus && rxId(m) === rxId(motor))) return 'CAN 反馈 ID 冲突,请更换 ID 或总线;达妙默认 Master ID 每条总线仅支持一颗';
  return '';
}
