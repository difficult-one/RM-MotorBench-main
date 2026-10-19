import {readHolding,writeSingle,writeMultiple,parseReply,encodeValue,decodeValue,fieldWords,validateProfile} from './modbus_rtu.js';
export class Rs485Stepper {
  constructor({openPort,onChange=()=>{},pollMs=300,timeoutMs=500}={}){
    this.openPort=openPort??(async config=>{const {SerialPort}=await import('serialport');return new Promise((resolve,reject)=>{const port=new SerialPort({path:config.path,baudRate:config.baud,dataBits:8,stopBits:config.stopBits,parity:config.parity,autoOpen:true},error=>error?reject(error):resolve(port));port.on('error',()=>{});});});
    this.onChange=onChange;this.pollMs=pollMs;this.timeoutMs=timeoutMs;this.queue=Promise.resolve();this.epoch=0;this.port=null;this.inflight=null;this.poll=null;this.notBefore=0;
    this.state={open:false,mode:'real',path:'',profileName:'',commandEnabled:null,stopConfirmed:false,feedbackSpeed:null,feedbackPosition:null,receivedAt:0,error:'',busy:false};
  }
  snapshot(){return {...this.state};}
  publish(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
  async open(config,profile){
    const validated=validateProfile(profile);
    if(!config||typeof config.path!=='string'||!config.path.trim()||config.path.length>256||!Number.isInteger(config.slave)||config.slave<1||config.slave>247||![9600,19200,38400,57600,115200].includes(config.baud)||!['none','even','odd'].includes(config.parity)||![1,2].includes(config.stopBits))throw Error('RS-485 串口参数无效');
    if(validated.demoOnly&&config.mode!=='demo')throw Error('演示寄存器配置不能连接真实设备，请导入厂家协议');
    await this.close();const epoch=++this.epoch;this.profile=validated;this.config={...config};
    const bits=1+8+(config.parity==='none'?0:1)+config.stopBits;
    this.silenceMs=config.baud>19200?2:Math.ceil(3500*bits/config.baud);
    const port=await this.openPort(config);
    if(epoch!==this.epoch){await new Promise(resolve=>port.close(()=>resolve()));throw Error('连接已取消');}
    this.port=port;port.on('error',error=>{if(this.port===port)this.fault(error);});
    port.on('close',()=>{if(this.port===port){this.port=null;this.epoch++;this.inflight?.reject(Error('RS-485 串口已关闭'));clearInterval(this.poll);this.publish({open:false,commandEnabled:null,stopConfirmed:false,error:'串口断开，停止结果未确认'});}});
    this.publish({open:true,mode:config.mode??'real',path:config.path,profileName:validated.name,commandEnabled:null,stopConfirmed:false,feedbackSpeed:null,feedbackPosition:null,receivedAt:0,error:''});
    try{await this.stop();await this.refresh();this.poll=setInterval(()=>{if(!this.state.busy&&!this.state.error)void this.refresh().catch(()=>{});},this.pollMs);}
    catch(error){this.fault(error);throw error;}
  }
  fault(error){
    this.epoch++;clearInterval(this.poll);this.publish({commandEnabled:null,stopConfirmed:false,error:`${error.message}；请检查并重新连接`});
  }
  async exchange(bytes,check=()=>{}){
    const gap=this.notBefore-Date.now();if(gap>0)await new Promise(resolve=>setTimeout(resolve,gap));check();
    const port=this.port;if(!port?.isOpen)return Promise.reject(Error('RS-485 串口未连接'));
    return new Promise((resolve,reject)=>{
      let buffer=Buffer.alloc(0),settled=false;
      const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);port.off('data',data);this.inflight=null;this.notBefore=Date.now()+this.silenceMs;if(error)reject(error);else resolve(value);};
      const data=chunk=>{
        buffer=Buffer.concat([buffer,chunk]);if(buffer.length>256)return done(Error('Modbus 应答超长'));
        if(buffer.length<3)return;const length=buffer[1]&128?5:buffer[1]===3?5+buffer[2]:8;
        if(buffer.length<length)return;
        try{if(buffer.length!==length)throw Error('Modbus 应答含多余字节');done(null,parseReply(bytes,buffer));}catch(error){done(error);}
      };
      const timer=setTimeout(()=>done(Error('Modbus 应答超时，结果未确认')),this.timeoutMs);
      this.inflight={reject:error=>done(error)};port.on('data',data);
      try{port.write(bytes,error=>{if(error)done(error);});}catch(error){done(error);}
    });
  }
  enqueue(action,{allowFault=false,epoch=this.epoch}={}){
    const run=this.queue.catch(()=>{}).then(async()=>{
      if(epoch!==this.epoch)throw Error('运动已取消');
      if(!this.port?.isOpen)throw Error('RS-485 串口未连接');
      if(this.state.error&&!allowFault)throw Error('通信状态未确认，请重新连接');
      this.publish({busy:true});
      try{return await action(()=>{if(epoch!==this.epoch)throw Error('运动已取消');});}
      catch(error){if(epoch===this.epoch){this.fault(error);if(!allowFault)void this.stop().catch(()=>{});}throw error;}
      finally{this.publish({busy:false});}
    });this.queue=run;return run;
  }
  async writeField(f,value,check){check();const values=encodeValue(value,f),slave=this.config.slave;await this.exchange(values.length===1?writeSingle(slave,f.address,values[0]):writeMultiple(slave,f.address,values),check);check();}
  async sequence(actions,check){for(const action of actions)await this.writeField(action,action.value,check);}
  stop(){
    const epoch=++this.epoch;this.publish({stopConfirmed:false});
    return this.enqueue(async check=>{await this.sequence(this.profile.disable,check);check();this.publish({commandEnabled:false,stopConfirmed:true});},{allowFault:true,epoch});
  }
  enable(){if(this.state.error)return Promise.reject(Error('通信状态未确认，请重新连接'));return this.enqueue(async check=>{await this.sequence(this.profile.enable,check);check();this.publish({commandEnabled:true,stopConfirmed:false});});}
  move(c){
    if(!this.state.commandEnabled)return Promise.reject(Error('请先使能，再运行'));
    const p=this.profile;
    if(!['speed','relative'].includes(c.mode)||typeof c.rpm!=='number'||!Number.isFinite(c.rpm)||Math.abs(c.rpm)>p.maxRpm||c.rpm===0||(c.mode==='relative'&&(!Number.isInteger(c.steps)||c.steps===0||Math.abs(c.steps)>p.maxSteps||c.rpm<=0)))return Promise.reject(Error('运动目标超出协议限幅，定量运动转速须大于 0'));
    return this.enqueue(async check=>{
      if(!this.state.commandEnabled)throw Error('请先使能，再运行');
      await this.writeField(p.speed,c.rpm,check);
      if(c.mode==='relative')await this.writeField(p.position,c.steps,check);
      await this.sequence(c.mode==='relative'?p.positionStart:p.speedStart,check);
    });
  }
  refresh(){return this.enqueue(async check=>{
    const read=async f=>{check();const words=await this.exchange(readHolding(this.config.slave,f.address,fieldWords(f)),check);check();return decodeValue(words,f);};
    const feedbackSpeed=await read(this.profile.feedbackSpeed),feedbackPosition=await read(this.profile.feedbackPosition);check();this.publish({feedbackSpeed,feedbackPosition,receivedAt:Date.now()});
  });}
  async close(){
    clearInterval(this.poll);this.poll=null;
    if(this.port?.isOpen&&this.profile){try{await this.stop();}catch{/* error remains explicitly unconfirmed */}}
    this.epoch++;this.inflight?.reject(Error('连接已取消'));await this.queue.catch(()=>{});
    const port=this.port;this.port=null;
    if(port?.isOpen)await new Promise(resolve=>port.close(()=>resolve()));
    this.publish({open:false,commandEnabled:null,busy:false});
  }
}
