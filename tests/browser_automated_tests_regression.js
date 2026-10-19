// Production UI and real bridge, in-process demo only; never opens physical serial.
async page=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  await page.setViewportSize({width:1440,height:900});await page.goto('http://127.0.0.1:3302/');
  await page.waitForFunction(()=>document.querySelector('.demo-badge')||[...document.querySelectorAll('button')].some(b=>b.textContent==='进入无硬件演示'&&!b.disabled));
  if(await page.locator('.demo-badge').isVisible()){await page.getByRole('button',{name:'设备与诊断',exact:true}).click();await page.getByRole('button',{name:'退出演示',exact:true}).click();await page.getByRole('button',{name:'控制台',exact:true}).click();}
  await page.getByRole('button',{name:'进入无硬件演示',exact:true}).click();
  await page.locator('.automatic-test-panel summary').click();
  await page.getByLabel('测试幅度',{exact:true}).fill('300');await page.getByLabel('保持/升幅时长（ms）',{exact:true}).fill('1000');
  await page.getByRole('button',{name:'开始测试并使能',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.test-status')?.textContent.includes('正在测试'));
  assert(await page.getByRole('button',{name:'使能运行',exact:true}).isDisabled(),'manual enable is locked during automatic execution');
  await page.getByRole('button',{name:'取消测试并停机',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.test-status')?.textContent.includes('已取消'));
  await page.waitForFunction(()=>document.querySelector('.channel-control .badge')?.textContent.includes('已停机'));
  await page.getByRole('button',{name:'开始测试并使能',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.test-status')?.textContent.includes('测试完成'));
  await page.getByRole('button',{name:'测试记录',exact:true}).click();await page.getByRole('button',{name:'只读回放',exact:true}).first().click();
  await page.getByRole('heading',{name:'自动测试评价',exact:true}).waitFor();
  await page.locator('.test-results table').waitFor();assert((await page.locator('.test-results').textContent()).includes('rpm'),'evaluation retains speed units');
  const exportPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出记录 JSON',exact:true}).click();const exported=await exportPromise;
  await page.getByLabel('导入记录 JSON',{exact:true}).setInputFiles(await exported.path());await page.waitForFunction(()=>document.querySelector('.records-panel>.warning')?.textContent.includes('已导入离线记录'));
  await page.locator('.replay-workspace input[type="range"]').press('End');
  for(const[width,height]of[[1366,768],[1440,900],[1920,1080],[820,1180],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
    const box=await page.locator('.estop').boundingBox();assert(box.y>=0&&box.y+box.height<height,'emergency stop remains visible');
    await page.screenshot({path:`output/playwright/automated-results-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'设备与诊断',exact:true}).click();
  assert((await page.locator('.protocol-diagnostics').textContent()).includes('协议 v2'),'board capabilities are visible');
  await page.getByRole('button',{name:'控制台',exact:true}).click();await page.locator('.automatic-test-panel summary').click();await page.locator('.automatic-test-panel summary').click();
  await page.getByRole('combobox',{name:'测试类型',exact:true}).selectOption('reversal');
  for(const[width,height]of[[1440,900],[390,844]]){await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`output/playwright/automated-setup-${width}.png`,fullPage:true});}
  assert(errors.length===0,errors.join('; '));return {pass:true,checks:['negotiated V2','cancel disables output','completion disables output','automatic bounded records','board-time evaluation','export/import evaluation','five responsive layouts'],errors};
}
