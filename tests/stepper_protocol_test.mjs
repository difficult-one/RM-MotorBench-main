import test from 'node:test';
import assert from 'node:assert/strict';
import * as mb from '../motor_bench_host/modbus_rtu.js';
import * as sp from '../motor_bench_host/stepper_protocol.js';

test('Modbus frames match independently checked protocol examples', () => {
  assert.equal(mb.readHolding(1, 0, 10).toString('hex'), '01030000000ac5cd');
  assert.equal(mb.writeSingle(1, 1, 3).toString('hex'), '010600010003980b');
  assert.equal(mb.crc16(Buffer.from('123456789')), 0x4b37);
});
test('Modbus checks exact slave, CRC, response length, echoes and exceptions', () => {
  const request = mb.readHolding(1, 0, 2);
  const reply = mb.withCrc(Buffer.from('0103040001ffff', 'hex'));
  assert.deepEqual(mb.parseReply(request, reply), [1, 65535]);
  assert.throws(() => mb.parseReply(request, mb.withCrc(Buffer.from('0203040001ffff', 'hex'))), /站/);
  const damaged = Buffer.from(reply); damaged[4] ^= 1;
  assert.throws(() => mb.parseReply(request, damaged), /CRC/);
  assert.throws(() => mb.parseReply(request, mb.withCrc(Buffer.from('018302', 'hex'))), /异常.*2/);
  assert.throws(() => mb.parseReply(mb.writeSingle(1, 1, 3), mb.writeSingle(1, 1, 4)), /回显/);
  assert.throws(() => mb.readHolding(0, 0, 2));
  assert.throws(() => mb.readHolding(1, 65535, 2));
});
test('signed values, register width, word order and scale are explicit', () => {
  const field = { address: 10, type: 'i32', wordOrder: 'lowFirst', scale: 10 };
  assert.deepEqual(mb.encodeValue(-12.3, field), [0xff85, 0xffff]);
  assert.equal(mb.decodeValue([0xff85, 0xffff], field), -12.3);
  assert.throws(() => mb.encodeValue(40000, {address: 0, type:'i16',scale:1,wordOrder:'highFirst'}), /范围/);
});
test('pulse config validates frequency and electronic gearing', () => {
  assert.equal(sp.validatePulseConfig({pulsesPerRev:3200,maxHz:10000,enableHigh:true,invert:false}).pulsesPerRev,3200);
  for(const pulsesPerRev of [0,NaN,199,1000001]) assert.throws(()=>sp.validatePulseConfig({pulsesPerRev,maxHz:10000,enableHigh:true,invert:false}));
  assert.throws(()=>sp.validatePulseMove({mode:'speed',rpm:NaN,steps:0},{pulsesPerRev:3200,maxHz:10000}));
  assert.throws(()=>sp.validatePulseMove({mode:'speed',rpm:3000,steps:0},{pulsesPerRev:3200,maxHz:10000}));
  assert.throws(()=>sp.validatePulseMove({mode:'relative',rpm:30,steps:0},{pulsesPerRev:3200,maxHz:10000}));
});
test('pulse protocol carries board session and request sequence', () => {
  const frame=sp.buildPulseCommand(17,9,{type:'pulseMove',mode:'relative',rpm:60,steps:-3200});
  assert.equal(frame[1],0x15); assert.equal(frame[2],17);
  assert.equal(frame.readUInt32LE(3),17); assert.equal(frame.readUInt32LE(7),9);
  assert.equal(frame[11],1);assert.equal(frame.readFloatLE(12),60);assert.equal(frame.readInt32LE(16),-3200);
});
test('RS485 motion stays unavailable without a verified manufacturer profile',()=>{
  assert.throws(()=>mb.validateProfile({}),/协议/);
});
