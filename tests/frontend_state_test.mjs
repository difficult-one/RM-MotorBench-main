import assert from 'node:assert/strict';
import { test } from 'node:test';
const client = await import('../motor_bench_host/frontend/connection.ts').catch(() => ({}));
const memory = await import('../motor_bench_host/frontend/pid_memory.ts').catch(() => ({}));
test('reconnect synchronizes a snapshot and never replays an output command', async () => {
  assert.equal(typeof client.BenchConnection, 'function', 'missing reconnecting command service');
  const sockets = [], scheduled = [];
  class Socket {
    readyState = 1; sent = [];
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.onclose?.(); }
  }
  const connection = new client.BenchConnection('ws://fixture', () => {}, () => {}, {
    createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    schedule: callback => { scheduled.push(callback); return 0; }, cancel: () => {},
  });
  connection.connect(); sockets[0].onopen();
  assert.equal(connection.ready, false);
  assert.throws(() => connection.command({ type: 'enable', channelId: 0, enable: true }), /同步/);
  sockets[0].onmessage({ data: JSON.stringify({ type: 'snapshot', data: { session: 1 } }) });
  const request = connection.command({ type: 'enable', channelId: 0, enable: true }); request.promise.catch(() => {});
  assert.equal(sockets[0].sent.at(-1).type, 'enable');
  sockets[0].onclose(); assert.equal(connection.ready, false);
  scheduled.at(-1)(); sockets[1].onopen();
  assert.deepEqual(sockets[1].sent.map(m => m.type), ['getSnapshot']);
  connection.dispose();
});
test('legacy PID values migrate by motor identity and loop without becoming board values', () => {
  assert.equal(typeof memory.loadPid, 'function', 'missing PID memory migration');
  const values = new Map([['motor-bench:pid:v1:2:1:3:0', JSON.stringify({ Kp: 12, Ki: 0.3, Kd: 0, MaxOut: 15000, IntegralLimit: 9000 })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
  const loaded = memory.loadPid(storage, '2:1:3', 0, { Kp: 20, Ki: 1, Kd: 0, MaxOut: 15000, IntegralLimit: 10000, improve: 5 });
  assert.equal(loaded.values.Kp, 12); assert.equal(loaded.values.improve, 5); assert.equal(loaded.source, 'local');
  assert.equal(JSON.parse(values.get('motor-bench:pid:v2:2:1:3:0')).version, 2);
  assert.equal(memory.loadPid(storage, '2:2:3', 0, { Kp: 20 }).values.Kp, 20);
});
test('corrupt PID storage falls back with a visible reason', () => {
  assert.equal(typeof memory.loadPid, 'function');
  const value = memory.loadPid({ getItem: () => '{broken', setItem: () => {} }, '2:1:3', 0, { Kp: 20 });
  assert.equal(value.values.Kp, 20); assert.match(value.warning, /损坏/);
});
