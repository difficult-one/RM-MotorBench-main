// Run after browser_workbench_regression against the same serial fixture session.
async page => {
  const unknown = await page.context().newPage();
  unknown.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  try {
    await unknown.routeWebSocket('**/socket', route => {
      const service = route.connectToServer();
      service.onMessage(raw => {
        const report = JSON.parse(raw.toString());
        if (report.type === 'snapshot') report.data.bindings.items = [];
        if (report.type === 'bindings') report.data.items = [];
        if (report.type !== 'telemetry') route.send(JSON.stringify(report));
      });
    });
    await unknown.goto('http://127.0.0.1:3301/');
    await unknown.getByRole('button', { name: '仅识别显示', exact: true }).waitFor();
    assert((await unknown.locator('.measurements').textContent()).includes('单位待确认'), 'unknown identity must not imply rpm');
    assert(!(await unknown.locator('.measurements').textContent()).includes('电流原始量'), 'unknown identity must not imply DJI current');
    await unknown.waitForFunction(() => document.querySelector('.channel-tab small').textContent.includes('反馈过期'));
    assert(await unknown.getByRole('button', { name: '使能运行', exact: true }).isDisabled(), 'stale channel cannot be enabled while board heartbeat continues');
    assert((await unknown.locator('.link-summary').textContent()).includes('板端在线'), 'test must retain actual board heartbeat');
    return { pass:true, results:['unknown identity does not invent units','expired channel status overrides fresh board heartbeat','expired feedback locks enable'] };
  } finally { await unknown.close(); }
}
