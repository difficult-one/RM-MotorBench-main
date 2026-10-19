// Run after browser_workbench_regression against the same hardware-free fixture.
async page=>{
  await page.goto('http://127.0.0.1:3301/');await page.locator('.automatic-test-panel summary').click();
  const start=page.getByRole('button',{name:'开始测试并使能',exact:true});
  if(!await start.isDisabled())throw Error('legacy firmware must not expose an enabled automatic test');
  if(!(await page.locator('.automatic-test-panel').textContent()).includes('旧固件仍可手动控制'))throw Error('legacy capability boundary must explain the upgrade path');
  return {pass:true,checks:['legacy manual controls remain available','unsupported automatic execution is disabled']};
}
