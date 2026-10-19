<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue';
import type {Bench} from '../bench';
import {PulseReason,validatePulseConfig,validatePulseMove} from '../../stepper_protocol.js';
import {validateProfile} from '../../modbus_rtu.js';
import {STEPPER_PROFILE_TEMPLATE} from '../../stepper_profile_template.js';
const props=defineProps<{bench:Bench}>(),state=props.bench.state;
const transport=ref('pulse'),busy=ref(false),message=ref('');
const pulseConfig=reactive({pulsesPerRev:3200,maxHz:10000,polarity:'',invert:false});
const motion=reactive({mode:'relative',rpm:30,steps:3200});
const serial=reactive({path:'',baud:115200,slave:1,parity:'none',stopBits:1});
const profileText=ref(''),profileError=ref(''),profile=ref<any>(null);
const pulseFresh=computed(()=>props.bench.online.value&&state.pulse&&state.now-state.pulse.receivedAt<1500);
const canControl=computed(()=>state.service&&state.synced&&state.isController&&!busy.value&&!props.bench.testing.value);
const pulseSupported=computed(()=>!!(state.capabilities?.flags&16));
const rsFresh=computed(()=>state.service&&state.rs485.open&&state.rs485.receivedAt>0&&state.now-state.rs485.receivedAt<1500&&!state.rs485.error);
const active=computed(()=>transport.value==='pulse'?state.pulse:state.rs485);
const enabled=computed(()=>transport.value==='pulse'?!!(pulseFresh.value&&state.pulse?.enabled):!!(rsFresh.value&&state.rs485.commandEnabled));
const limit=computed(()=>transport.value==='pulse'?state.pulse?.maxHz*60/(state.pulse?.pulsesPerRev||3200):profile.value?.maxRpm??300);
const sample=(value:unknown,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(digits):'—';
watch(profileText,text=>{profile.value=null;profileError.value='';if(!text.trim())return;try{profile.value=validateProfile(JSON.parse(text));}catch(error){profileError.value=(error as Error).message;}});
watch(()=>state.session,()=>{message.value='';});
async function run(command:Record<string,unknown>){
  busy.value=true;message.value='';try{const response=await props.bench.command(command);message.value=response.message??'已收到设备应答';}catch(error){message.value=(error as Error).message;}finally{busy.value=false;}
}
async function configure(){try{if(!pulseConfig.polarity)throw Error('请先核对 EN 有效电平');const c=validatePulseConfig({...pulseConfig,enableHigh:pulseConfig.polarity==='high'});await run({type:'pulseConfig',...c});}catch(error){message.value=(error as Error).message;}}
async function move(){try{if(transport.value==='pulse')validatePulseMove(motion,state.pulse);await run({type:transport.value==='pulse'?'pulseMove':'rs485Move',...motion});}catch(error){message.value=(error as Error).message;}}
async function importProfile(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>16000){profileError.value='协议文件应小于 16 KB';return;}profileText.value=await file.text();}
function downloadTemplate(){const url=URL.createObjectURL(new Blob([JSON.stringify(STEPPER_PROFILE_TEMPLATE,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='stepper-modbus-profile.template.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
</script>
<template>
  <section class="stepper-panel">
    <div class="section-head"><div><h1>步进电机控制</h1><p class="subtle">42 一体式闭环步进 · 按实物端子选择接入方式，每种方式支持一台。</p></div><span v-if="(transport==='pulse'&&state.serial.mode==='demo')||(transport==='rs485'&&state.rs485.mode==='demo'&&state.rs485.open)" class="demo-badge">演示 · 模拟数据</span></div>
    <div class="stepper-tabs" role="group" aria-label="步进控制接口"><button :class="{primary:transport==='pulse',quiet:transport!=='pulse'}" :aria-pressed="transport==='pulse'" @click="transport='pulse';message=''">脉冲 · PU / DR / EN</button><button :class="{primary:transport==='rs485',quiet:transport!=='rs485'}" :aria-pressed="transport==='rs485'" @click="transport='rs485';message=''">RS‑485 · A / B</button></div>
    <div class="stepper-layout">
      <section v-if="transport==='pulse'" class="stepper-setup" aria-labelledby="pulse-setup-title">
        <h2 id="pulse-setup-title">脉冲接口配置</h2>
        <p class="subtle">通过 A/C 板 USB 连接，板端生成脉冲。先在设备与诊断中连接开发板，或进入演示。</p>
        <div v-if="!bench.online.value" class="stepper-connect"><button class="quiet" :disabled="!canControl||state.serial.open||(state.rs485.open&&state.rs485.mode!=='demo')" @click="run({type:'startDemo'})">演示脉冲控制</button><p class="subtle">演示不打开物理串口。</p></div>
        <p v-else-if="!pulseSupported" class="warning">当前固件未提供步进能力，请重新编译并烧录本次 A/C 板固件。</p>
        <form class="stepper-fields" @submit.prevent="configure">
          <label>每圈脉冲数<input v-model.number="pulseConfig.pulsesPerRev" type="number" min="200" max="1000000" step="1" required/></label>
          <label>最高脉冲频率（Hz）<input v-model.number="pulseConfig.maxHz" type="number" min="1" max="10000" step="1" required/></label>
          <label>EN 有效电平<select v-model="pulseConfig.polarity" required><option value="">按驱动器设置选择</option><option value="high">高电平使能</option><option value="low">低电平使能</option></select></label>
          <label class="stepper-check"><input v-model="pulseConfig.invert" type="checkbox"/>反转方向信号</label>
          <button class="primary" :disabled="!canControl||!pulseSupported||!bench.online.value||!!state.pulse?.enabled">应用脉冲配置</button>
        </form>
        <p class="subtle">每圈脉冲数须与驱动器细分 / 电子齿轮一致；图中的编码器 4000 Counts 不能代替此参数。修改配置前先停止输出。</p>
        <p v-if="state.pulse?.configured" class="subtle">板端已应用：{{state.pulse.pulsesPerRev}} 脉冲/圈 · {{state.pulse.maxHz}} Hz · EN {{state.pulse.enableHigh?'高':'低'}}电平使能 · {{state.pulse.invert?'方向反转':'正常方向'}}</p>
      </section>
      <section v-else class="stepper-setup" aria-labelledby="rs485-setup-title">
        <h2 id="rs485-setup-title">RS‑485 连接</h2><p class="subtle">USB‑485 转换器直接连接电脑，不占用 A/C 板 CAN 通道。设备须支持 Modbus RTU。</p>
        <form class="stepper-fields" @submit.prevent="run({type:'rs485Open',...serial,profile})">
          <label>USB‑485 串口<select v-model="serial.path" :disabled="state.rs485.open" required><option value="">选择转换器串口</option><option v-for="port in state.ports" :key="port.path" :value="port.path">{{port.path}} {{port.friendlyName||port.manufacturer||''}}</option></select></label>
          <button type="button" class="quiet" :disabled="!state.service||busy" @click="run({type:'listPorts'})">刷新 USB‑485 串口</button>
          <label>从站地址<input v-model.number="serial.slave" type="number" min="1" max="247" step="1" :disabled="state.rs485.open" required/></label>
          <label>波特率<select v-model="serial.baud" :disabled="state.rs485.open"><option v-for="baud in [9600,19200,38400,57600,115200]" :key="baud" :value="baud">{{baud}}</option></select></label>
          <label>校验<select v-model="serial.parity" :disabled="state.rs485.open"><option value="none">无校验</option><option value="even">偶校验</option><option value="odd">奇校验</option></select></label>
          <label>停止位<select v-model="serial.stopBits" :disabled="state.rs485.open"><option :value="1">1</option><option :value="2">2</option></select></label>
          <button v-if="!state.rs485.open" class="primary" :disabled="!canControl||!profile||profile.demoOnly||!serial.path">连接并验证停机</button>
          <button v-else type="button" class="quiet" :disabled="!canControl" @click="run({type:'rs485Close'})">停止并关闭 RS‑485</button>
        </form>
        <div class="stepper-connect"><button class="quiet" :disabled="!canControl||state.rs485.open||(state.serial.open&&state.serial.mode!=='demo')" @click="run({type:'rs485Demo'})">演示 RS‑485 控制</button></div>
        <details class="help stepper-profile"><summary>厂家通信协议配置</summary><p class="subtle">图片没有提供寄存器表。请依据对应型号手册填写地址、控制字、字序及缩放，再将 verified 设为 true。配置只在本次连接使用，连接后不自动使能。模板不包含可直接驱动实物的地址。</p><button class="quiet" @click="downloadTemplate">下载协议模板</button><label>导入厂家协议 JSON<input type="file" accept=".json,application/json" :disabled="state.rs485.open" @change="importProfile"/></label><label>协议 JSON<textarea v-model="profileText" rows="10" spellcheck="false" :disabled="state.rs485.open" placeholder="粘贴已核实的厂家寄存器配置"/></label><p v-if="profileError" class="warning" role="status">{{profileError}}</p><p v-if="profile" class="subtle">已核实配置：{{profile.name}} · 来源：{{profile.source}}</p></details>
        <p v-if="state.rs485.open" class="subtle">{{state.rs485.path}} · {{state.rs485.profileName}}</p>
      </section>
      <section class="stepper-operation" aria-labelledby="stepper-motion-title">
        <div class="section-head"><h2 id="stepper-motion-title">运行与停止</h2><span class="badge">{{transport==='pulse'?(!pulseFresh?'等待板端状态':state.pulse.running?'正在发送脉冲':state.pulse.enabled?'已使能 · 未发脉冲':'脉冲输出已停止'):(!state.rs485.open?'未连接':state.rs485.error?'通信异常':state.rs485.stopConfirmed?'停机写入已应答':state.rs485.commandEnabled?'使能写入已应答':'状态待确认')}}</span></div>
        <p v-if="transport==='pulse'" class="subtle">下方速度和位置由板端发送的脉冲计算，未读取电机编码器。电机内部闭环不等于网页有实测反馈。</p>
        <p v-else class="subtle">下方读数来自协议配置指定的设备寄存器；写入应答仅确认寄存器操作，运行情况以反馈和现场观察为准。</p>
        <dl class="stepper-readings"><div><dt>{{transport==='pulse'?'指令转速':'反馈转速'}} <small>rpm</small></dt><dd>{{sample(transport==='pulse'?(pulseFresh?state.pulse?.rpm:null):(rsFresh?state.rs485.feedbackSpeed:null))}}</dd></div><div><dt>{{transport==='pulse'?'已发脉冲位置':'反馈位置'}} <small>脉冲</small></dt><dd>{{sample(transport==='pulse'?(pulseFresh?state.pulse?.position:null):(rsFresh?state.rs485.feedbackPosition:null),0)}}</dd></div><div v-if="transport==='pulse'"><dt>剩余脉冲</dt><dd>{{pulseFresh?state.pulse?.remaining:'—'}}</dd></div></dl>
        <div class="run-actions"><button class="primary" :disabled="!canControl||enabled||(transport==='pulse'?(!pulseFresh||!state.pulse?.configured||state.control?.source!==0):(!state.rs485.open||!!state.rs485.error||state.rs485.busy))" @click="run(transport==='pulse'?{type:'pulseEnable',enable:true}:{type:'rs485Enable'})">使能步进</button><button class="stop-button" :disabled="!state.service||!state.isController||(transport==='pulse'?!bench.online.value:!state.rs485.open)" @click="run(transport==='pulse'?{type:'pulseEnable',enable:false}:{type:'rs485Stop'})">停止步进输出</button></div>
        <form class="stepper-fields stepper-motion" @submit.prevent="move">
          <label>步进运动模式<select v-model="motion.mode"><option value="relative">相对脉冲运动</option><option value="speed">连续转速</option></select></label>
          <label>{{motion.mode==='relative'?'运动转速（正值 rpm）':'目标转速（正负 rpm）'}}<input v-model.number="motion.rpm" type="number" :min="motion.mode==='relative'?0.01:-Math.min(limit||3000,3000)" :max="Math.min(limit||3000,3000)" step="any" required/></label>
          <label v-if="motion.mode==='relative'">相对脉冲数（正负表示方向）<input v-model.number="motion.steps" type="number" min="-10000000" max="10000000" step="1" required/></label>
          <button class="primary" :disabled="!canControl||!enabled||(transport==='pulse'&&state.pulse?.running)||!!active?.busy">下发步进运动</button>
        </form>
        <p class="subtle">输入只保存草稿，点击下发才运行。{{transport==='pulse'?'定量运动结束后保持使能；连续运行或切换方向前先停止。':'停止后重新使能才能继续。'}} 停止与全局急停随时可用。</p>
        <p v-if="transport==='pulse'&&pulseFresh" class="subtle">板端状态：{{PulseReason[state.pulse.reason]}}</p>
        <p v-if="transport==='rs485'&&state.rs485.error" class="warning" role="status">{{state.rs485.error}}</p>
        <p v-if="message" class="stepper-message" role="status">{{message}}</p>
      </section>
    </div>
    <details class="help stepper-wiring"><summary>接线与反馈说明</summary><template v-if="transport==='pulse'"><p>A 板：PU 信号 PA0，DR 信号 PA1，EN 信号 PA2。C 板：PU 信号 PE9，DR 信号 PE11，EN 信号 PE13。应用配置后这些原 PWM 引脚由步进功能占用，请勿同时接舵机。使用匹配驱动器输入电压与电流的电平转换 / 差分驱动接口，按接口的反相关系选择 EN 极性。</p><p>电机电源接驱动器 V+ / V−，按实物规格供电。24–48 V 电机电源不能接 MCU 信号脚；PU± / DR± / EN± 的共阳、共阴或差分接线须以厂家手册为准。报警 AL 未接入本版，网页不能确认堵转、故障或电机实际转动。</p></template><template v-else><p>USB‑485 转换器 A/B 对应电机 485A/485B，参考地、屏蔽和终端电阻按厂家要求处理；从站地址、波特率、校验和停止位须一致。不能把 485A/B 接 CANH/CANL。</p><p>本版支持 Modbus RTU。若该型号使用厂家私有协议，请提供对应手册；不能直接套用同外形电机的寄存器表。电脑或转换器掉电后的停机能力取决于驱动器通信看门狗及硬件急停设置。</p></template></details>
  </section>
</template>
