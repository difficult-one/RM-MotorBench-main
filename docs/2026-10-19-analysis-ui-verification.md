# 第三阶段记录与分析界面验收

日期：2026-10-19。

## actual scope

本轮为既有 Operate 仪器工作台的普通扩展：配置模板、PID 预设、测试记录与只读回放、多通道速度分析、底盘轮序方向预览。依据 `PRODUCT.md`、`DESIGN.md` 与 `docs/superpowers/plans/2026-10-19-analysis-workspace.md`；没有新视觉世界合同或概念稿。

核对来源：`motor_bench_host/frontend/style.css`、`App.vue`、`ScenePanel.vue`、`RecordsPanel.vue`、`LiveComparison.vue`、`TracePlot.vue`，以及 `tests/browser_analysis_regression.js` 与下列截图。文档收尾仅写本文件；不重跑浏览器、静态 detect 或硬件流程。

独立完整 UI review 对 persistence、fidelity、ceiling 多数判为 match，并提出下列两项 material fixes。后续独立 Verdict Pass **仅复核这两项修复**，结果均为 resolved，remaining: clear，disposition: ship。该结论不等于全界面无问题的批准，也不覆盖实物验收。

## persistence

沿用并保留 `PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`，不重写色板、字体、组件或断点。当前扩展仍以基础操作集中、专业功能按需展开为原则；配置和 PID 本地编辑不冒充板端事实，记录与回放不改变电机运行。

场景与 PID 预设各最多保存 20 项；服务记录仅驻内存、最多 5 条，界面说明重启丢失与 JSON 导出。离线文件明确标注来源，名称和备注仅保留本页，须导出 JSON 才能保留；服务记录的名称和备注才写回服务。

## fidelity

| 核对项 | 当前实现与既有系统的关系 |
| --- | --- |
| 色板与表面 | 继续使用既有深色背景、面板、蓝色操作、黄色情况提示和红色急停；以 1px 边线和色面分区，无新增装饰阴影。 |
| 字体与信息层级 | 使用本地系统中文无衬线，沿用 22px 主标题、17px 分区标题、14px 正文与13px 标签；数值读数使用等宽数字。 |
| 控件与焦点 | 按钮和主要输入沿用至少 40px 高、轻圆角和 2px 蓝色焦点轮廓；文件入口提供可见焦点。 |
| 配置预览 | 同表比较当前身份与应用后身份/环，覆盖目标通道和全部实际解绑通道；未再绑定的原通道明确显示“解绑后空闲”。应用仍先全停，再解绑、登记、绑定和配置控制来源。 |
| 回放与分析 | 标明主机接收时间、来源、固件/会话和模拟数据；rpm 与 rad/s 分开纵轴，虚线目标、实线实测，窗口/游标只影响查看。 |
| 底盘预览 | 轮序与反向箭头来自编辑配置；不将方向预览表达为实物方向已验证。 |
| 响应式与安全入口 | 保留 1600/1150/760px 断点；窄屏工具栏分行、记录列表纵排。五种回放视口无横向溢出且急停可见；原工作台回归确认手机运行/停止仍在首屏。 |
| PID | 保留按需展开与定位/焦点；预设只填本地编辑，板端应用仍走既有入口。 |

## ceiling

继续以任务、数值、状态和明确操作为表达上限。新增表格、Canvas 曲线、可折叠上下文和轮序示意服务于调试，没有新增外部字体、装饰图像或视觉身份。完整 UI review 的上述维度多数 match；后续 Verdict Pass 的 clear/ship 仅适用于两项 material fixes。

## material_fixes

| 原发现 | 已完成修复与证据 | 后续复核 |
| --- | --- | --- |
| 电机移位预览漏掉原通道解绑 | `ScenePanel.vue` 的预览行取目标通道与全部实际解绑通道并集；回归断言原通道出现“解绑”，并保存 1440/390px 移位预览截图。 | resolved |
| 离线导入记录与服务记录同 ID 时，保存备注误写服务 | `RecordsPanel.vue` 独立保留 service/file 来源；仅 service 发出 `recordUpdate`。浏览器回归先保存服务备注，再导入同 ID 文件并保存离线备注，发送次数保持一次。 | resolved |

主线程已完成的验证：`npm run check` 通过；最终 UI 修复后的 lint、类型检查、构建及完整分析浏览器回归再次通过，pageerror 为 0；原工作台和反馈过期回归通过。静态 detect 仅执行一次，结果为 `[]`，未重复执行。此处记录主线程结果；文档收尾核对源码和既有截图，不新增测试结论。

## keep

保留持续可见的急停、请求与板端事实区分、目标草稿与实测分离、PID 按需展开、不同单位独立纵轴、模拟数据持续标识，以及离线文件与服务记录的来源边界。

设计系统文件保持原样。现有 sidecar 的字体片段和早期导航示例只作为既有示例保留，不将示例覆盖限制或单点样式差异固化为新增系统规则；本轮不修复预存设计漂移。

## evidence

截图全部使用演示/模拟数据。主线程已逐项验证截图有效；本轮文档核对抽看回放 1440px 和移位预览 390px。模拟器结果不替代实物方向、保护时序或长时运行验收。

| 场景 | 证据路径 |
| --- | --- |
| 只读回放，1366×768 | `output/playwright/analysis-1366.png` |
| 只读回放，1440×900 | `output/playwright/analysis-1440.png` |
| 只读回放，1920×1080 | `output/playwright/analysis-1920.png` |
| 只读回放，820×1180 | `output/playwright/analysis-820.png` |
| 只读回放，390×844 | `output/playwright/analysis-390.png` |
| 配置场景，1440/390px | `output/playwright/analysis-scene-1440.png`、`output/playwright/analysis-scene-390.png` |
| 底盘方向，1440/390px | `output/playwright/analysis-chassis-1440.png`、`output/playwright/analysis-chassis-390.png` |
| 电机移位预览，1440/390px | `output/playwright/analysis-moved-preview-1440.png`、`output/playwright/analysis-moved-preview-390.png` |
