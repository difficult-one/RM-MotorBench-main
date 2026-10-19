# Protocol and bounded tests implementation plan

**Goal:** 完成能力协商、明确绑定/清单、板端时间/停止原因、有界测试与受采样条件约束的评价。

**Architecture:** 保留旧帧；新增V2模块分离编解码、序列规则和评价。板端任务执行，Node协调控制权/记录，Vue展示配置、进度和结果。A/C保留板级独立工程并同步相同业务增量。

**Tech Stack:** 当前C11、Node、Vue3/TypeScript、Canvas；不增加运行依赖。

## Global Constraints

遵循同日spec完整字节布局与界限；不提交/暂存/重置、不碰嵌套副本、不接物理串口或烧录。旧固件手动兼容；自动测试必须协商能力并显式开始。所有结束/失联路径板端停机，不重连续跑。评价不对坏采样编造有效指标。

## Tasks

- [x] 1. `protocol_v2.js`及`shared.js`：先写`tests/protocol_v2_test.mjs`字节/范围/损坏数据测试，运行红灯；实现HELLO、绑定/清单、TEST、STATUS及扩展遥测的编解码。`node --test tests/protocol_v2_test.mjs`通过。
- [x] 2. 两板`modules/motor_bench/bench_v2.inc`及motor_bench.c/h：在`tests/protocol_v2_firmware_test.c`通过USB真实解析与实际驱动断言时序。先断言握手/绑定ACK存在得到红灯，再实现。测试序列、取消/全停/反馈/失联/会话切换、序号拒绝和旧命令兼容。扩展`tests/firmware_behavior_test.mjs`编译执行两板。
- [x] 3. `test_sequence.js`与`test_metrics.js`：先用独立手算样本测试step/ramp/reversal目标和指标、掉点/跨身份拒绝；实现同一公开规则及纯指标函数。无通信副作用。命令`node --test tests/test_sequence_test.mjs tests/test_metrics_test.mjs`。
- [x] 4. bridge/channel_bindings/demo_port/command_validation：扩展真实服务回归，先验证新能力、权威恢复、迟到/跨会话拒绝、旧固件不能启动自动测试、运行命令互斥、控制权丢失停止与自动记录；实现新旧能力选择及应答关联。保留旧测试。
- [x] 5. recording格式/store与Vue：保留可选板端字段与test上下文；新增TestPanel、设备能力/原因、记录指标。浏览器完整运行/取消/导出回放，与旧固件提示和5视口验证；新回归先失败再实现。
- [x] 6. `npm run check`、新旧浏览器、两板make、独立代码及界面复审；修复发现，更新README/spec协议表及交付证据。索引hash与前态一致，清理自启测试服务。实机验收单独列明。

原生测试实际运行MotorBenchTask，不能仅匹配源码。服务回归只替换外部串口设备，不能把新协议同形mock当作C实现证明。浏览器/格式测试覆盖真正使用链路，避免复述实现。
