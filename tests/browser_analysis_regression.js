// Production server, built UI and in-process DemoPort. No physical serial fixture is needed.
async page=>{
  page.setDefaultTimeout(7000);const errors=[],recordUpdates=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',socket=>socket.on('framesent',({payload})=>{try{const value=JSON.parse(String(payload));if(value.type==='recordUpdate')recordUpdates.push(value);}catch{/* binary protocol is not used on this link */}}));
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  await page.setViewportSize({width:1440,height:900});await page.goto('http://127.0.0.1:3302/');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='进入无硬件演示'&&!b.disabled)||document.querySelector('.demo-badge'));
  if(await page.locator('.demo-badge').isVisible()){await page.getByRole('button',{name:'设备与诊断',exact:true}).click();await page.getByRole('button',{name:'退出演示',exact:true}).click();await page.getByRole('button',{name:'控制台',exact:true}).click();}
  await page.getByRole('button',{name:'进入无硬件演示',exact:true}).click();
  await page.locator('.demo-badge').waitFor();await page.getByRole('button',{name:'使能运行',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.run-actions .primary').disabled);
  await page.getByRole('button',{name:'使能运行',exact:true}).click();
  await page.getByLabel('准备下发的转子转速').fill('800');await page.getByRole('button',{name:'下发目标',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.measurements b').textContent==='800.0');
  await page.locator('.comparison-panel summary').click();
  await page.getByRole('heading',{name:'rad/s · 独立纵轴',exact:true}).waitFor();
  assert(await page.locator('.comparison-panel canvas').count()===2,'mixed units must use separate axes');
  await page.getByRole('button',{name:'配置模板',exact:true}).click();await page.getByLabel('配置名称',{exact:true}).fill('演示台架');
  await page.getByRole('button',{name:'保存当前配置',exact:true}).click();
  await page.getByRole('heading',{name:'预览：演示台架',exact:true}).waitFor();
  const sceneDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出配置 JSON',exact:true}).click();
  const sceneFile=await sceneDownload;assert(sceneFile.suggestedFilename().endsWith('.json'),'scene is downloadable');
  await page.getByRole('combobox',{name:'本地场景',exact:true}).selectOption('-1');assert(await page.locator('.config-preview').count()===0,'scene placeholder clears preview');
  await page.getByRole('combobox',{name:'本地场景',exact:true}).selectOption('0');
  const scene=await page.evaluate(()=>JSON.parse(localStorage.getItem('motor-bench:scenes:v1'))[0]);
  const moved={...scene,name:'单轮移位',bindings:[{...scene.bindings[0],channelId:1},...scene.bindings.slice(2)]};
  await page.getByLabel('导入配置 JSON',{exact:true}).setInputFiles({name:'moved-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(moved))});
  await page.getByRole('heading',{name:'预览：单轮移位',exact:true}).waitFor();
  assert(await page.locator('.scene-binding-table tbody tr').filter({hasText:'解绑'}).count()===1,'preview includes the original channel released when its motor moves');
  for(const[width,height]of[[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`scene overflow at ${width}`);
    await page.screenshot({path:`output/playwright/analysis-moved-preview-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});
  scene.name='交换轮序';[scene.bindings[0].channelId,scene.bindings[1].channelId]=[scene.bindings[1].channelId,scene.bindings[0].channelId];
  await page.getByLabel('导入配置 JSON',{exact:true}).setInputFiles({name:'swapped-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scene))});
  await page.getByRole('heading',{name:'预览：交换轮序',exact:true}).waitFor();
  await page.getByRole('button',{name:'全停并应用登记与绑定',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.scene-panel>.warning').textContent.includes('配置应用完成'));
  await page.getByRole('button',{name:'控制台',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.channel-control .badge').textContent.includes('已停机'));
  assert((await page.locator('.channel-control .section-head .subtle').textContent()).includes('ID2'),'scene applies the previewed channel reassignment');
  await page.getByRole('button',{name:'PID / 专业调试',exact:true}).click();
  await page.locator('.preset-panel summary').click();
  await page.getByLabel('预设名称',{exact:true}).fill('低负载');await page.getByLabel('Kp',{exact:true}).fill('24');
  await page.getByRole('button',{name:'保存编辑为预设',exact:true}).click();
  await page.getByRole('combobox',{name:'本地 PID 预设',exact:true}).selectOption('-1');assert(await page.locator('.preset-preview').count()===0,'PID placeholder clears preview');
  await page.getByRole('combobox',{name:'本地 PID 预设',exact:true}).selectOption('0');
  const pidPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 PID JSON',exact:true}).click();const pid=await pidPromise;
  await page.getByLabel('导入 PID JSON',{exact:true}).setInputFiles(await pid.path());
  await page.waitForFunction(()=>document.querySelector('.preset-panel .warning[role="status"]').textContent.includes('文件已读取'));
  await page.getByLabel('Kp',{exact:true}).fill('18');await page.getByRole('button',{name:'填入本地编辑',exact:true}).click();
  assert(await page.getByLabel('Kp',{exact:true}).inputValue()==='24','preset loads only into local draft');
  await page.getByRole('button',{name:'测试记录',exact:true}).click();await page.getByLabel('实验名称',{exact:true}).fill('模拟阶跃记录');
  await page.getByRole('button',{name:'开始记录',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.records-panel .badge')?.textContent==='正在记录');
  await page.getByRole('button',{name:'控制台',exact:true}).click();await page.getByRole('button',{name:'使能运行',exact:true}).click();
  await page.getByLabel('准备下发的转子转速').fill('1200');await page.getByRole('button',{name:'下发目标',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.measurements b').textContent==='1200.0');
  assert(await page.locator('.stop-message').count()===0,'a past stopped confirmation must clear when output is re-enabled');
  await page.getByRole('button',{name:'测试记录',exact:true}).click();await page.getByRole('button',{name:'结束记录',exact:true}).click();
  await page.getByRole('button',{name:'只读回放',exact:true}).first().click();await page.locator('.replay-workspace').waitFor();
  await page.getByLabel('实验备注',{exact:true}).fill('服务端备注');await page.getByRole('button',{name:'保存备注',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.records-panel>.warning')?.textContent==='已保存名称和备注');
  assert(recordUpdates.length===1,'a record loaded from the service may update service metadata');
  await page.getByRole('button',{name:'播放回放',exact:true}).click();
  const csvPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 CSV',exact:true}).click();const csv=await csvPromise;assert(csv.suggestedFilename().endsWith('.csv'),'CSV export downloads');
  const jsonPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出记录 JSON',exact:true}).click();const json=await jsonPromise;
  await page.getByLabel('导入记录 JSON',{exact:true}).setInputFiles(await json.path());
  await page.waitForFunction(()=>document.querySelector('.records-panel>.warning')?.textContent.includes('已导入离线记录'));
  await page.getByLabel('记录名称',{exact:true}).fill('离线备注检查');await page.getByLabel('实验备注',{exact:true}).fill('仅本地备注');
  await page.getByRole('button',{name:'保存备注',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.records-panel>.warning')?.textContent.includes('已保存'));
  assert(recordUpdates.length===1,'offline imported metadata must not write back even when its id exists in the service');
  await page.locator('.replay-workspace input[type="range"]').press('End');
  await page.locator('.replay-workspace canvas').first().waitFor();
  for(const[width,height]of[[1366,768],[1440,900],[1920,1080],[820,1180],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
    const stop=await page.locator('.estop').boundingBox();assert(stop.y>=0&&stop.x+stop.width<=width&&stop.y+stop.height<height,`emergency stop visible at ${width}`);
    await page.screenshot({path:`output/playwright/analysis-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'控制台',exact:true}).click();
  assert((await page.locator('.channel-control .badge').textContent()).includes('正在运行'),'recording and playback do not alter running outputs');
  await page.getByRole('button',{name:'全局急停 ALL STOP',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.stop-message').textContent.includes('板端已禁用'));
  for(const[width,height]of[[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await page.getByRole('button',{name:'配置模板',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`output/playwright/analysis-scene-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'控制台',exact:true}).click();
  await page.locator('.source-panel summary').click();await page.getByRole('combobox',{name:'控制来源',exact:true}).selectOption('2');
  await page.locator('.wheel-map input[type="checkbox"]').first().check();
  assert(await page.getByRole('img',{name:'该轮反向',exact:true}).count()===1,'wheel direction preview reflects the edited reversal mask');
  for(const[width,height]of[[1440,900],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`chassis overflow at ${width}`);
    await page.screenshot({path:`output/playwright/analysis-chassis-${width}.png`,fullPage:true});
  }
  assert(errors.length===0,errors.join('; '));
  return {pass:true,checks:['hardware-free demo','scene preview/export/apply never enables output','PID preset only edits local values','bounded recording and JSON/CSV export','read-only replay leaves motor target unchanged','unit-separated comparisons','five responsive layouts and emergency stop'],errors};
}
