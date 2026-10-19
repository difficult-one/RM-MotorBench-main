// Run against the production UI on the dedicated verification server.
async page=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'步进控制',exact:true}).click();
  await page.getByRole('button',{name:'RS‑485 · A / B',exact:true}).click();
  if(await page.getByRole('button',{name:'停止并关闭 RS‑485',exact:true}).isVisible())await page.getByRole('button',{name:'停止并关闭 RS‑485',exact:true}).click();
  await page.getByRole('button',{name:'设备与诊断',exact:true}).click();
  if(await page.getByRole('button',{name:'退出演示',exact:true}).isVisible())await page.getByRole('button',{name:'退出演示',exact:true}).click();
  await page.getByRole('button',{name:'步进控制',exact:true}).click();
  await page.getByRole('button',{name:'脉冲 · PU / DR / EN',exact:true}).click();
  if(await page.getByRole('button',{name:'演示脉冲控制',exact:true}).isVisible())await page.getByRole('button',{name:'演示脉冲控制',exact:true}).click();
  await page.getByRole('combobox',{name:'EN 有效电平',exact:true}).selectOption('high');
  await page.getByRole('button',{name:'应用脉冲配置',exact:true}).click();
  await page.getByRole('button',{name:'使能步进',exact:true}).click();
  assert(!(await page.locator('.stop-message').isVisible()),'rearming clears the historical global stop banner');
  await page.getByLabel('相对脉冲数（正负表示方向）',{exact:true}).fill('-320');
  await page.getByRole('button',{name:'下发步进运动',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stepper-operation')?.textContent.includes('定量运动完成'));
  assert((await page.locator('.stepper-readings').textContent()).includes('-320'),'signed bounded pulses complete');
  assert((await page.locator('.stepper-operation').textContent()).includes('未读取电机编码器'),'pulse estimates retain honest label');
  await page.getByRole('button',{name:'停止步进输出',exact:true}).click();
  await page.getByRole('button',{name:'使能步进',exact:true}).click();
  await page.getByRole('combobox',{name:'步进运动模式',exact:true}).selectOption('speed');
  await page.getByLabel('目标转速（正负 rpm）',{exact:true}).fill('30');
  await page.getByRole('button',{name:'下发步进运动',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stepper-operation .badge')?.textContent.includes('正在发送脉冲'));
  await page.getByRole('button',{name:'全局急停 ALL STOP',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stepper-operation .badge')?.textContent.includes('脉冲输出已停止'));
  await page.getByRole('button',{name:'RS‑485 · A / B',exact:true}).click();
  assert(await page.getByRole('button',{name:'连接并验证停机',exact:true}).isDisabled(),'unknown vendor mapping blocks real connection');
  await page.getByRole('button',{name:'演示 RS‑485 控制',exact:true}).click();
  await page.getByRole('button',{name:'使能步进',exact:true}).click();
  await page.getByRole('button',{name:'下发步进运动',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stepper-readings')?.textContent.includes('30.0'));
  assert(!(await page.locator('.stop-message').isVisible()),'RS485 rearm clears the historical global stop banner');
  for(const [width,height] of [[1440,1000],[820,1180],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`RS485 overflow ${width}`);
    const box=await page.locator('.estop').boundingBox();assert(box.y>=0&&box.y+box.height<height,'global stop remains visible');
    if(width===390)for(const name of ['使能步进','停止步进输出']){const button=await page.getByRole('button',{name,exact:true}).boundingBox();assert(button.y>=0&&button.y+button.height<=height,`RS485 ${name} in first viewport`);}
    await page.screenshot({path:`output/playwright/stepper-rs485-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'全局急停 ALL STOP',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stepper-operation .badge')?.textContent.includes('停机写入已应答'));
  await page.getByRole('button',{name:'脉冲 · PU / DR / EN',exact:true}).click();
  for(const [width,height] of [[1440,1000],[390,844]]){await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`pulse overflow ${width}`);if(width===390)for(const name of ['使能步进','停止步进输出']){const button=await page.getByRole('button',{name,exact:true}).boundingBox();assert(button.y>=0&&button.y+button.height<=height,`pulse ${name} in first viewport`);}await page.screenshot({path:`output/playwright/stepper-pulse-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'控制台',exact:true}).click();
  await page.getByRole('button',{name:'使能运行',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.channel-control .badge')?.textContent.includes('正在运行'));
  assert(!(await page.locator('.stop-message').isVisible()),'CAN rearm also clears the combined global stop banner');
  await page.getByRole('button',{name:'全局急停 ALL STOP',exact:true}).click();
  await page.getByRole('button',{name:'步进控制',exact:true}).click();
  assert(errors.length===0,errors.join('; '));return {pass:true,errors,checks:['pulse config','signed exact move','pulse continuous','global pulse stop','unknown protocol lock','RS485 feedback','global RS485 stop','desktop tablet mobile']};
}
