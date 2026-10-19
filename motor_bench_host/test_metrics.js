import {validateSequence,sequenceDuration,sequenceSegments,sequenceTarget} from './test_sequence.js';
export function evaluateTest(record){
  const fail=reason=>({valid:/** @type {false} */(false),reason,segments:[]});const c=record?.context?.test;
  if(!c)return fail('不是自动测试记录');
  try{validateSequence(c,c);}catch(error){return fail(error.message);}
  if(c.outcome!=='completed')return fail('测试未完整完成');
  if(!Number.isInteger(c.startedAt)||c.startedAt<0||c.startedAt>0xffffffff||!Number.isInteger(c.boardSession)||c.boardSession<=0||c.boardSession>0xffffffff)return fail('缺少板端会话或起始时间');
  const duration=sequenceDuration(c),all=(record.samples??[]).filter(s=>s.channelId===c.channelId);
  if(all.some(s=>!Number.isInteger(s.boardMs)||s.boardSession!==c.boardSession))return fail('缺少连续板端时间或跨会话');
  for(let i=1;i<all.length;i++){const dt=(all[i].boardMs-all[i-1].boardMs)>>>0;if(!dt||dt>100)return fail('原始板端时间倒退、重复或间隔超过100ms');}
  const samples=all.map(s=>({...s,t:(s.boardMs-c.startedAt)>>>0})).filter(s=>s.t<=duration);
  if(samples.length<10||samples[0].t>50||samples.at(-1).t<duration-50)return fail('基线或结束采样不完整');
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(!s.online||!Number.isFinite(s.speed)||!Number.isFinite(s.ref))return fail('存在离线或无效样本');
    if(s.kind!==c.kind||s.canBus!==c.canBus||s.motorId!==c.motorId||s.outerLoop!==2)return fail('测试中电机身份或控制环改变');
    if(i&&(s.t<=samples[i-1].t||s.t-samples[i-1].t>100))return fail('板端采样倒退、重复或间隔超过100ms');
    if(Math.abs(s.ref-(sequenceTarget(c,s.t)??0))>Math.max(.01,c.amplitude*.001))return fail('板端目标与测试序列不一致');
  }
  const unit=c.kind===4?'rad/s':'rpm',band=Math.max(c.amplitude*.02,c.kind===4?.01:1),segments=[];
  const stableZero=end=>{const points=samples.filter(s=>s.t>=end-200&&s.t<end);return points.length>=2&&points.every(s=>Math.abs(s.speed)<=band);};
  if(!stableZero(c.baselineMs))return fail('阶跃或升幅前的零基线未稳定');
  for(const seg of sequenceSegments(c)){
    if(seg.step&&seg.start!==c.baselineMs&&!stableZero(seg.start))return fail('反向段前的零基线未稳定');
    const points=samples.filter(s=>s.t>=seg.start&&s.t<seg.end),tail=points.filter(s=>s.t>=seg.end-(seg.end-seg.start)*.2);
    if(points.length<3||tail.length<2)return fail('恒定目标段样本不足');
    const sign=Math.sign(seg.target),peak=Math.max(...points.map(s=>(s.speed-seg.target)*sign));
    let settlingMs=null;
    if(seg.step)for(let i=0;i<points.length;i++)if(points.at(-1).t-points[i].t>=200&&points.slice(i).every(s=>Math.abs(s.speed-seg.target)<=band)){settlingMs=points[i].t-seg.start;break;}
    const mean=tail.reduce((sum,s)=>sum+s.speed,0)/tail.length;
    segments.push({...seg,overshootPercent:seg.step?Math.max(0,peak)/c.amplitude*100:null,steadyError:seg.target-mean,settlingMs});
  }
  return {valid:/** @type {true} */(true),unit,timeBasis:'board-read',band,segments,reason:'板端读取反馈时间；非电调内部采样时间'};
}
