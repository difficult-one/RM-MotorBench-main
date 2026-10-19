// The actual bridge and protocol are exercised; only the physical serial device is replaced.
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { register } from 'node:module';
import WebSocket from '../motor_bench_host/node_modules/ws/wrapper.mjs';
import { FrameParser, FrameType, buildFrame, buildHeartbeatAck, buildTelemetry } from '../motor_bench_host/protocol.js';

const board = { frames: [], motors: [], ports: [], enabled: false, respond: true, refs: [] };
class Serial extends EventEmitter {
  static async list() { return [{ path: 'SIM', manufacturer: 'Regression fixture' }]; }
  constructor(options, callback) {
    super(); this.isOpen = false; this.parser = new FrameParser(); board.ports.push(options.path); board.serial = this;
    setTimeout(() => { this.isOpen = true; callback(null); }, 10);
  }
  reply(type, bytes) { setImmediate(() => { if (this.isOpen && board.respond) this.emit('data', buildFrame(type, bytes)); }); }
  write(bytes, callback) {
    for (const { type, payload } of this.parser.push(bytes)) {
      board.frames.push(type);
      if (type === FrameType.HEARTBEAT && board.respond) setImmediate(() => this.emit('data', buildHeartbeatAck()));
      if (type === FrameType.INVENTORY_QUERY) this.reply(FrameType.INVENTORY_REPORT, Buffer.from([board.motors.length, ...board.motors.flatMap(m => [m.kind, m.canBus, m.motorId, 2])]));
      if (type === FrameType.QUERY) this.reply(FrameType.CONTROL_REPORT, Buffer.from([0,0,255,1,1,1,0,0,0,0,0,0]));
      if (type === FrameType.MOTOR_ADD) {
        board.motors.push({ kind: payload[0], canBus: payload[1], motorId: payload[2] });
        this.reply(FrameType.MOTOR_ADD_ACK, Buffer.from([0, ...payload.subarray(0, 3), 255, 10]));
      }
      if (type === FrameType.MOTOR_REMOVE) {
        board.motors = board.motors.filter(m => !(m.kind === payload[0] && m.canBus === payload[1] && m.motorId === payload[2]));
        this.reply(FrameType.MOTOR_ADD_ACK, Buffer.from([0, ...payload.subarray(0, 3), 255, 10]));
      }
      if (type === FrameType.MOTOR_BIND) {
        this.binding = payload[0];
        setImmediate(() => this.emit('data', buildTelemetry([{ channelId: this.binding, online: true, enabled: board.enabled }])));
      }
      if (type === FrameType.MOTOR_ENABLE) {
        board.enabled = !!payload[1];
        setImmediate(() => this.emit('data', buildTelemetry([{ channelId: payload[0], online: true, enabled: board.enabled }])));
      }
      if (type === FrameType.MOTOR_SET) board.refs.push(payload.readFloatLE(1));
      if (type === FrameType.CONTROL_SOURCE) {
        this.reply(FrameType.CONTROL_REPORT, Buffer.from([0,0,255,1,1,1,0,0,0,0,0,0]));
        const report = Buffer.alloc(12); report[1] = payload[0]; report[2] = payload[1]; report[3] = report[4] = report[5] = 1; report.writeFloatLE(payload.readFloatLE(2),8);
        setTimeout(() => this.reply(FrameType.CONTROL_REPORT, report), 30);
      }
      if (type === FrameType.ALL_STOP) board.enabled = false;
    }
    callback?.(); return true;
  }
  drain(callback) { callback?.(); }
  close(callback) { setTimeout(() => { this.isOpen = false; this.emit('close'); callback?.(); }, 15); }
}
globalThis.__reliabilitySerial = Serial;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(s,c,n) { if(s==='serialport') return {url:'data:text/javascript,export const SerialPort=globalThis.__reliabilitySerial;',shortCircuit:true}; return n(s,c); }`)}`);
let server;
const originalCreate = http.createServer;
http.createServer = (...args) => (server = originalCreate(...args));
process.argv = [process.execPath, 'server.js', '--port', '0'];
await import('../motor_bench_host/server.js');
http.createServer = originalCreate;
if (!server.listening) await once(server, 'listening');
const sockets = [], keepalives = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`); sockets.push(ws); ws.messages = [];
  ws.on('message', data => ws.messages.push(JSON.parse(data)));
  await once(ws, 'open'); keepalives.push(setInterval(() => { if(ws.readyState === 1) ws.send(JSON.stringify({ type:'keepAlive' })); }, 1000)); return ws;
}
async function wait(ws, predicate, from = 0) {
  for (let i = 0; i < 120; i++) {
    const result = ws.messages.slice(from).find(predicate); if (result) return result;
    await pause(25);
  }
  throw Error(`Timed out: ${predicate}`);
}
let seq = 0;
async function command(ws, value) {
  const requestId = `test-${++seq}`; ws.send(JSON.stringify({ ...value, requestId }));
  return wait(ws, m => m.type === 'commandResult' && m.requestId === requestId);
}
try {
  const owner = await connect();
  assert.equal((await wait(owner, m => m.type === 'snapshot')).data.serial.open, false);
  const observer = await connect();
  assert.equal((await wait(observer, m => m.type === 'ownership')).isController, false);
  assert.equal((await command(observer, { type: 'openSerial', path: 'SIM' })).ok, false);
  assert.equal(board.ports.length, 0, 'observer cannot open a physical port');
  const demo=await command(owner,{type:'startDemo'});assert.equal(demo.ok,true,'demo is available without physical serial');
  assert.equal((await command(owner,{type:'openSerial',path:'SIM'})).ok,false,'real serial and demo are mutually exclusive');
  assert.equal(board.ports.length,0,'demo never constructs physical serial');
  await command(owner,{type:'closeSerial'});
  assert.equal((await command(owner, { type: 'openSerial', path: 'SIM' })).ok, true);
  assert.equal((await command(owner,{type:'startDemo'})).ok,false,'demo cannot replace an open real serial');
  await wait(owner, m => m.type === 'inventory');
  const beforeInvalid = board.frames.length;
  for (const value of [
    { type: 'bind', channelId: 256, kind: 2, canBus: 1, motorId: 1, outerLoop: 2 },
    { type: 'addMotor', kind: 2, canBus: 3, motorId: 1 },
    { type: 'addMotor', kind: 1, canBus: 1, motorId: 8 },
    { type: 'bind', channelId: 0, kind: 4, canBus: 1, motorId: 1, outerLoop: 4 },
    { type: 'setRef', channelId: 0, ref: null },
    { type: 'pidSet', channelId: 0, loop: 0, pid: { Kp: 656, Ki: 0, Kd: 0, MaxOut: 1, IntegralLimit: 0 } },
    { type: 'enable', channelId: 0, enable: 'false' },
  ]) assert.equal((await command(owner, value)).ok, false, JSON.stringify(value));
  assert.equal(board.frames.slice(beforeInvalid).filter(t => t !== FrameType.HEARTBEAT).length, 0);
  assert.equal((await command(owner, { type: 'addMotor', kind: 2, canBus: 1, motorId: 1 })).ok, true);
  await wait(owner, m => m.type === 'motorAck' && m.requestId);
  await command(owner, { type: 'scanMotors' }); await wait(owner, m => m.type === 'inventory' && m.data.items.length === 1);
  await command(owner, { type: 'bind', channelId: 0, kind: 2, canBus: 1, motorId: 1, outerLoop: 2 });
  await wait(owner, m => m.type === 'bindings' && m.data.items.length === 1);
  const legacyTest=await command(owner,{type:'sequenceStart',channelId:0,mode:'step',amplitude:100,baselineMs:500,phaseMs:1000,tailMs:500});
  assert.equal(legacyTest.ok,false,'old firmware cannot start an automatic test');
  assert.equal(board.frames.includes(FrameType.TEST_START),false,'unsupported firmware never receives a test-start frame');
  assert.equal((await command(owner, { type: 'enable', channelId: 0, enable: true })).ok, true);
  const change = await command(owner, { type: 'controlSource', source: 1, channelId: 0, maxRef: 3000 });
  const changed = await wait(owner, m => m.type === 'controlReport' && m.requestId === change.requestId);
  assert.equal(changed.data.source, 1, 'an old or periodic report must not acknowledge a new source');
  const web = await command(owner, { type: 'controlSource', source: 0 });
  await wait(owner, m => m.type === 'controlReport' && m.requestId === web.requestId);
  const refresh = await connect();
  assert.equal((await wait(refresh, m => m.type === 'snapshot')).data.serial.open, true);
  assert.equal((await wait(refresh, m => m.type === 'snapshot')).data.inventory.items.length, 1);
  const beforeObserverClose = board.frames.filter(t => t === FrameType.ALL_STOP).length;
  refresh.close(); await once(refresh, 'close'); await pause(50);
  assert.equal(board.frames.filter(t => t === FrameType.ALL_STOP).length, beforeObserverClose, 'observer exit must not stop the controller');
  assert.equal((await command(observer, { type: 'setRef', channelId: 0, ref: 100 })).ok, false);
  await command(observer, { type: 'claimControl', takeover: true });
  assert.equal(board.enabled, false, 'takeover stops before handing over');
  assert.equal((await command(owner, { type: 'enable', channelId: 0, enable: true })).ok, false);
  // Stop has priority over unsent, coalesced target updates.
  assert.equal((await command(observer, { type: 'enable', channelId: 0, enable: true })).ok, true);
  for (let ref = 10; ref <= 30; ref += 10) observer.send(JSON.stringify({ type: 'setRef', channelId: 0, ref }));
  await command(observer, { type: 'stopAll' }); await pause(80);
  assert.equal(board.refs.length, 0, 'stop discards pending target writes');
  const beforeOwnerClose = board.frames.filter(t => t === FrameType.ALL_STOP).length;
  observer.close(); await once(observer, 'close'); await pause(60);
  assert.ok(board.frames.filter(t => t === FrameType.ALL_STOP).length > beforeOwnerClose, 'controller disconnect stops even with observers present');
  await command(owner, { type: 'claimControl' });
  await command(owner, { type: 'removeMotor', kind:2, canBus:1, motorId:1 });
  await wait(owner, m => m.type === 'motorAck' && m.data.motorId === 1);
  const removeStart = owner.messages.length;
  await command(owner, { type: 'scanMotors' }); await wait(owner,m=>m.type==='inventory'&&m.data.items.length===0,removeStart);
  await command(owner, { type: 'getSnapshot' });
  assert.deepEqual(owner.messages.filter(m=>m.type==='snapshot').at(-1).data.telemetry, [], 'removing inventory must release old channel occupancy');
  await command(owner,{type:'addMotor',kind:2,canBus:1,motorId:2});
  await wait(owner,m=>m.type==='motorAck'&&m.data.motorId===2);
  await command(owner,{type:'scanMotors'});await wait(owner,m=>m.type==='inventory'&&m.data.items.some(m=>m.motorId===2));
  assert.equal((await command(owner,{type:'bind',channelId:0,kind:2,canBus:1,motorId:2,outerLoop:2})).ok,true);
  const sessionStart = owner.messages.length;
  await command(owner, { type: 'closeSerial' });
  const firstOpen = command(owner, { type: 'openSerial', path: 'SIM-A' });
  const secondOpen = command(owner, { type: 'openSerial', path: 'SIM-B' });
  await Promise.all([firstOpen, secondOpen]);
  await command(owner, { type: 'getSnapshot' });
  const snapshots = owner.messages.slice(sessionStart).filter(m => m.type === 'snapshot');
  assert.equal(snapshots.at(-1).data.serial.path, 'SIM-B');
  assert.deepEqual(snapshots.at(-1).data.bindings.items, []);
  const recordStart=await command(owner,{type:'recordStart',name:'服务回归'});assert.equal(recordStart.ok,true);
  const controlFrames=board.frames.filter(t=>[FrameType.MOTOR_ENABLE,FrameType.MOTOR_SET].includes(t)).length;
  await command(owner,{type:'recordStop'});
  const listingStart=owner.messages.length;await command(owner,{type:'recordList'});
  const listing=await wait(owner,m=>m.type==='records'&&m.items.length>0,listingStart);
  assert.equal(listing.items[0].name,'服务回归');
  assert.equal(board.frames.filter(t=>[FrameType.MOTOR_ENABLE,FrameType.MOTOR_SET].includes(t)).length,controlFrames,'record start/stop/list must not control motors');
  board.respond = false;
  const timed = await command(owner,{type:'addMotor',kind:2,canBus:1,motorId:3});
  await wait(owner,m=>m.type==='commandResult'&&m.requestId===timed.requestId&&m.stage==='unconfirmed');
  board.respond = true; const lateStart = owner.messages.length;
  board.serial.reply(FrameType.MOTOR_ADD_ACK,Buffer.from([0,2,1,3,255,10]));
  assert.equal((await wait(owner,m=>m.type==='motorAck'&&m.data.motorId===3,lateStart)).requestId,undefined,'late replies cannot overwrite expired requests');
  assert.equal((await command(owner,{type:'addMotor',kind:2,canBus:1,motorId:3})).ok,false,'ambiguous retry blocked until a new serial session');
  await command(owner, { type: 'closeSerial' });
  console.log('PASS: validation, correlation, ownership, priority stop, snapshot and serialized serial sessions');
} finally {
  for (const ws of sockets) ws.terminate();
  for (const timer of keepalives) clearInterval(timer);
  await new Promise(resolve => server.close(resolve));
}
