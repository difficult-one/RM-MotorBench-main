/** Modbus RTU wire format. No vendor register addresses are implied here. */
const int=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw Error(`${label}超出范围 ${min}–${max}`);};
export function crc16(bytes){let crc=0xffff;for(const b of bytes){crc^=b;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xa001:crc>>>1;}return crc;}
export function withCrc(bytes){const b=Buffer.alloc(bytes.length+2);b.set(bytes);b.writeUInt16LE(crc16(bytes),bytes.length);return b;}
function request(slave,fn,address,count){int(slave,1,247,'从站');int(address,0,65535,'寄存器地址');int(count,1,125,'寄存器数量');if(address+count>65536)throw Error('寄存器范围越界');const b=Buffer.alloc(6);b[0]=slave;b[1]=fn;b.writeUInt16BE(address,2);b.writeUInt16BE(count,4);return b;}
export const readHolding=(slave,address,count)=>withCrc(request(slave,3,address,count));
export function writeSingle(slave,address,value){int(value,0,65535,'寄存器值');const b=request(slave,6,address,1);b.writeUInt16BE(value,4);return withCrc(b);}
export function writeMultiple(slave,address,values){if(!Array.isArray(values)||values.length<1||values.length>123)throw Error('写入寄存器数量无效');const head=request(slave,16,address,values.length);const tail=Buffer.alloc(1+values.length*2);tail[0]=values.length*2;values.forEach((v,i)=>{int(v,0,65535,'寄存器值');tail.writeUInt16BE(v,1+i*2);});return withCrc(Buffer.concat([head,tail]));}
export function parseReply(req,b){
  if(b.length<5)throw Error('Modbus 应答长度不足');
  if(crc16(b.subarray(0,-2))!==b.readUInt16LE(b.length-2))throw Error('Modbus CRC 校验失败');
  if(b[0]!==req[0])throw Error('Modbus 从站不匹配');
  if(b[1]===(req[1]|128)){if(b.length!==5)throw Error('Modbus 异常应答长度错误');throw Error(`Modbus 异常码 ${b[2]}`);}
  if(b[1]!==req[1])throw Error('Modbus 功能码不匹配');
  if(req[1]===3){const count=req.readUInt16BE(4);if(b[2]!==count*2||b.length!==5+count*2)throw Error('Modbus 读取长度不匹配');return Array.from({length:count},(_,i)=>b.readUInt16BE(3+i*2));}
  if(b.length!==8||!b.subarray(0,6).equals(req.subarray(0,6)))throw Error('Modbus 写入回显不匹配');
  return [];
}
export function fieldWords(f){return f.type==='u32'||f.type==='i32'?2:1;}
export function validateField(f){if(!f||!['u16','i16','u32','i32'].includes(f.type)||!['highFirst','lowFirst'].includes(f.wordOrder)||typeof f.scale!=='number'||!Number.isFinite(f.scale)||f.scale<=0)throw Error('寄存器类型、字序或缩放无效');int(f.address,0,65536-fieldWords(f),'寄存器地址');return f;}
export function encodeValue(value,f){validateField(f);if(typeof value!=='number'||!Number.isFinite(value))throw Error('寄存器值必须为有限数值');const raw=Math.round(value*f.scale),bits=fieldWords(f)*16,signed=f.type[0]==='i';int(raw,signed?-(2**(bits-1)):0,signed?2**(bits-1)-1:2**bits-1,'寄存器值');const unsigned=raw<0?raw+2**bits:raw;const words=bits===16?[unsigned]:[Math.floor(unsigned/65536),unsigned%65536];return f.wordOrder==='lowFirst'?words.reverse():words;}
export function decodeValue(words,f){validateField(f);if(words.length!==fieldWords(f))throw Error('反馈寄存器宽度不匹配');const w=f.wordOrder==='lowFirst'?[...words].reverse():words;let raw=w.length===2?w[0]*65536+w[1]:w[0];const bits=w.length*16;if(f.type[0]==='i'&&raw>=2**(bits-1))raw-=2**bits;return raw/f.scale;}
export function validateProfile(p){
  if(!p||p.version!==1||p.protocol!=='modbus-rtu'||p.verified!==true||typeof p.source!=='string'||!p.source.trim()||p.source.length>300||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('请导入已核实的 Modbus RTU 协议配置，并注明厂家手册来源');
  if(!Number.isFinite(p.maxRpm)||p.maxRpm<=0||p.maxRpm>3000||!Number.isInteger(p.maxSteps)||p.maxSteps<1||p.maxSteps>10000000)throw Error('协议运动限幅无效');
  for(const key of ['enable','disable','speedStart','positionStart']){if(!Array.isArray(p[key])||p[key].length<1||p[key].length>8)throw Error(`协议 ${key} 写入序列须有 1–8 项`);for(const action of p[key])encodeValue(action.value,action);}
  for(const key of ['speed','position','feedbackSpeed','feedbackPosition'])validateField(p[key]);
  return structuredClone(p);
}
