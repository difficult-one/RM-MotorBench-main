// Run against the actual bridge with --import ../tests/support/simulated_board.mjs.
// playwright-cli -s=optimization run-code --filename tests/browser_workbench_regression.js
async page => {
  page.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const results = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:3301/');
  await page.getByRole('button', { name: '刷新串口', exact: true }).click();
  await page.locator('option[value="REGRESSION_ONLY"]').waitFor({ state: 'attached' });
  await page.getByLabel('设备串口').selectOption('REGRESSION_ONLY');
  await page.getByRole('button', { name: '连接开发板', exact: true }).click();
  await page.getByRole('button', { name: '设备与诊断', exact: true }).click();
  await page.getByRole('button', { name: '登记电机', exact: true }).waitFor();
  await page.getByRole('button', { name: '登记电机', exact: true }).click();
  await page.locator('.inventory-list li').filter({ hasText: 'M3508' }).waitFor();
  await page.getByRole('button', { name: '控制台', exact: true }).click();
  await page.getByLabel('已登记电机').selectOption('2:2:1');
  await page.getByRole('button', { name: '绑定通道', exact: true }).click();
  await page.getByRole('button', { name: '使能运行', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '使能运行').disabled);
  await page.getByRole('button', { name: '使能运行', exact: true }).click();
  const target = page.getByLabel('准备下发的转子转速'); await target.fill('1200');
  await page.getByRole('button', { name: '下发目标', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.measurements b').textContent === '1200.0');
  results.push('real browser → WebSocket → bridge → serial fixture → telemetry control loop');
  await page.getByRole('button', { name: 'PID / 专业调试', exact: true }).click();
  await page.getByLabel('Kp', { exact: true }).fill('42.5');
  await page.getByRole('button', { name: '读回板端值', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pid-row>span').textContent === '20');
  assert(await page.getByLabel('Kp', { exact: true }).inputValue() === '42.5', 'readback must not overwrite the local draft');
  await page.getByRole('button', { name: '应用到板端', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pid-message').textContent.includes('已确认写入'));
  await page.getByRole('button', { name: '读回板端值', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pid-row>span').textContent === '42.5');
  results.push('PID draft/readback separation, correlated write and readback');
  // Pause and clear must not affect the motor.
  await page.getByRole('button', { name: '使能运行', exact: true }).click();
  await target.fill('900'); await page.getByRole('button', { name: '下发目标', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.measurements b').textContent === '900.0');
  await page.getByRole('button', { name: '暂停显示', exact: true }).click();
  await page.getByRole('button', { name: '清空曲线', exact: true }).click();
  assert((await page.locator('.channel-control .badge').textContent()).includes('运行'), 'chart controls must not stop the motor');
  await page.getByRole('button', { name: '继续显示', exact: true }).click();
  await page.getByRole('button', { name: '设备与诊断', exact: true }).click();
  await page.getByRole('button', { name: '控制台', exact: true }).click();
  assert(await target.inputValue() === '900', 'workspace switch must preserve the target draft');
  results.push('chart controls are display-only; workspace switches preserve edits');
  for (const [width,height] of [[1366,768],[1440,900],[1920,1080],[820,1180],[390,844]]) {
    await page.setViewportSize({ width,height });
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, stop: document.querySelector('.estop').getBoundingClientRect().toJSON() }));
    assert(layout.scroll <= layout.width, `horizontal overflow at ${width}`);
    assert(layout.stop.top >= 0 && layout.stop.right <= width && layout.stop.bottom < height, `stop not visible at ${width}`);
    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0,0));
      const run = await page.getByRole('button', { name: '停止输出', exact: true }).boundingBox();
      assert(run.y + run.height < height, 'mobile run/stop must be visible in the first viewport');
      await page.getByRole('button', { name: '收起 PID 参数', exact: true }).click();
      await page.getByRole('button', { name: 'PID / 专业调试', exact: true }).click();
      const heading = page.locator('.pid-panel h2');
      assert(await heading.evaluate(el => document.activeElement === el && el.getBoundingClientRect().top > 100 && el.getBoundingClientRect().top < innerHeight), 'mobile PID entry must reveal and focus its panel');
      await page.evaluate(() => window.scrollTo(0,0));
    }
    await page.screenshot({ path: `output/playwright/workbench-${width}.png`, fullPage: true });
  }
  results.push('1366 / 1440 / 1920 / tablet / 390px layouts; fixed emergency stop');
  await page.setViewportSize({ width:1440,height:900 });
  await page.getByRole('button', { name: '全局急停 ALL STOP', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.stop-message').textContent.includes('板端已禁用'));
  const observer = await page.context().newPage(); await observer.goto('http://127.0.0.1:3301/');
  await observer.getByRole('button', { name: '主动接管', exact: true }).waitFor();
  assert(await observer.getByRole('button', { name: '使能运行', exact: true }).isDisabled(), 'observer cannot enable');
  await observer.close();
  await page.reload();
  await page.getByRole('button', { name: '使能运行', exact: true }).waitFor();
  assert(!(await page.locator('.channel-control .badge').textContent()).includes('正在运行'), 'reload must not restart output');
  await page.getByRole('button', { name: 'PID / 专业调试', exact: true }).click();
  assert(await page.getByLabel('Kp', { exact: true }).inputValue() === '42.5', 'PID local memory survives reload');
  results.push('emergency stop feedback; observer locks; refresh does not re-enable; PID memory');
  assert(errors.length === 0, `browser runtime errors: ${errors.join('; ')}`);
  return { pass: true, results };
}
