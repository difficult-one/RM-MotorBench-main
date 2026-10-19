import type { Pid } from './types.ts';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const fields = ['Kp','Ki','Kd','MaxOut','IntegralLimit'] as const;
export function validPid(value: unknown): value is Pid {
  if (!value || typeof value !== 'object') return false;
  const data = value as Pid;
  return fields.every(field => typeof data[field] === 'number' && Number.isFinite(data[field]) && data[field] >= 0 && data[field] <= (field === 'MaxOut' || field === 'IntegralLimit' ? 2147483647 : 655.35)) &&
    (data.improve === undefined || (Number.isInteger(data.improve) && data.improve >= 0 && data.improve <= 255));
}
export function savePid(storage: Storage, identity: string, loop: number, values: Pid) {
  if (!validPid(values)) return '参数未完整填写或超出范围,未保存';
  try { storage.setItem(`motor-bench:pid:v2:${identity}:${loop}`, JSON.stringify({ version: 2, values })); return ''; }
  catch { return '浏览器存储不可用,本次编辑仍可应用'; }
}
export function loadPid(storage: Storage, identity: string, loop: number, defaults: Pid) {
  try {
    const raw = storage.getItem(`motor-bench:pid:v2:${identity}:${loop}`);
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (stored.version !== 2 || !validPid(stored.values)) throw Error('invalid');
      return { values: { ...defaults, ...stored.values }, source: 'local', warning: '' };
    }
    const legacy = storage.getItem(`motor-bench:pid:v1:${identity}:${loop}`);
    if (legacy !== null) {
      const values = JSON.parse(legacy); if (!validPid(values)) throw Error('invalid');
      const merged = { ...defaults, ...values };
      const warning = savePid(storage, identity, loop, merged);
      return { values: merged, source: 'local', warning };
    }
    return { values: { ...defaults }, source: 'default', warning: '' };
  } catch { return { values: { ...defaults }, source: 'default', warning: '本地 PID 记忆损坏或不可用,已回退型号默认值;请核对后应用' }; }
}
