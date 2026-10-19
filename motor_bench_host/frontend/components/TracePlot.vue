<script setup lang="ts">
import { computed,nextTick,onMounted,onUnmounted,watch } from 'vue';
import { groupSpeedUnits,cursorSamples } from '../../recording_format.js';
const props=defineProps<{samples:any[];end:number;windowMs:number;cursor:number}>();
const groups=computed(()=>groupSpeedUnits(props.samples));
const readings=computed(()=>cursorSamples(props.samples,props.cursor));
const canvases=new Map<string,HTMLCanvasElement>();let resize:ResizeObserver;
const colors=['#75afff','#71d9b0','#f0c277','#e9a0de','#b6b4ff','#79d5e5','#ffad8c','#d1d789'];
function draw(){
  for(const group of groups.value){
    const canvas=canvases.get(group.unit);if(!canvas||!canvas.offsetParent)continue;
    const rect=canvas.getBoundingClientRect();if(!rect.width)continue;const ratio=devicePixelRatio||1;canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
    const ctx=canvas.getContext('2d')!;ctx.scale(ratio,ratio);ctx.clearRect(0,0,rect.width,rect.height);
    const left=58,right=rect.width-16,top=24,bottom=rect.height-28;
    let min=0,max=0;for(const s of group.samples)if(s.online){for(const value of [s.ref,s.speed])if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}}
    const pad=Math.max((max-min)*.1,group.unit==='rpm'?10:.1);min-=pad;max+=pad;
    const x=(time:number)=>left+(time-(props.end-props.windowMs))/props.windowMs*(right-left),y=(value:number)=>bottom-(value-min)/(max-min)*(bottom-top);
    ctx.font='11px system-ui';ctx.lineWidth=1;ctx.strokeStyle='#344153';ctx.fillStyle='#a8b6c9';ctx.setLineDash([]);
    for(let i=0;i<=4;i++){const yy=top+(bottom-top)*i/4,xx=left+(right-left)*i/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.textAlign='right';ctx.fillText((max-(max-min)*i/4).toFixed(max-min<1?2:max-min<10?1:0),left-7,yy+4);ctx.textAlign='center';ctx.fillText(((props.end-props.windowMs*(1-i/4))/1000).toFixed(1)+'s',xx,rect.height-7);}
    ctx.textAlign='left';ctx.fillText(group.unit,8,13);
    const channels=new Map<number,any[]>();for(const s of group.samples){if(!channels.has(s.channelId))channels.set(s.channelId,[]);channels.get(s.channelId)!.push(s);}
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    for(const[id,samples]of channels)for(const field of ['ref','speed']){
      ctx.strokeStyle=colors[id%colors.length];ctx.lineWidth=field==='speed'?2:1;ctx.setLineDash(field==='ref'?[5,4]:[]);ctx.beginPath();let previous:any=null;
      const stride=Math.max(1,Math.ceil(samples.length/2000));
      for(let i=0;i<samples.length;i+=stride){const s=samples[i],identity=`${s.kind}:${s.canBus}:${s.motorId}`;
        if(!s.online||!Number.isFinite(s[field])){previous=null;continue;}
        if(!previous||s.elapsedMs-previous.elapsedMs>1000||identity!==previous.identity)ctx.moveTo(x(s.elapsedMs),y(s[field]));else ctx.lineTo(x(s.elapsedMs),y(s[field]));previous={...s,identity};
      }ctx.stroke();
    }
    ctx.setLineDash([3,3]);ctx.strokeStyle='#e8edf5';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(props.cursor),top);ctx.lineTo(x(props.cursor),bottom);ctx.stroke();ctx.restore();
  }
}
function setCanvas(unit:string,node:any){if(node){canvases.set(unit,node);resize?.observe(node);}else{const old=canvases.get(unit);if(old)resize?.unobserve(old);canvases.delete(unit);}}
watch(()=>[props.samples,props.end,props.windowMs,props.cursor],async()=>{await nextTick();draw();});
onMounted(()=>{resize=new ResizeObserver(draw);for(const c of canvases.values())resize.observe(c);draw();});onUnmounted(()=>resize.disconnect());
</script>
<template>
  <div class="trace-plots"><p v-if="!groups.length" class="empty-inline">该时间窗口暂无速度环样本。</p><section v-for="group in groups" :key="group.unit" class="trace-group"><h3>{{ group.unit }} · 独立纵轴</h3><canvas :ref="node=>setCanvas(group.unit,node)" role="img" :aria-label="`多通道转速对比，单位${group.unit}，虚线目标，实线实测`"/></section>
    <div class="trace-readings"><span v-for="sample in readings" :key="sample.channelId" :style="{color:colors[sample.channelId%colors.length]}">通道 {{ sample.channelId }}：目标 {{ sample.online&&sample.ref!==null?Number(sample.ref).toFixed(1):'—' }} / 实测 {{ sample.online&&sample.speed!==null?Number(sample.speed).toFixed(1):'—' }} {{ sample.speedUnit }}</span></div>
  </div>
</template>
