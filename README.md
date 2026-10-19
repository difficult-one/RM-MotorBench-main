# RM-MotorBench · RoboMaster 实验室电机测试台

> 机械组自己就能测电机——不用再找电控组烧程序。

一套面向 RoboMaster 实验室的电机测试台：通过**浏览器页面**设定电机种类与转速，指令经 **USB 虚拟串口**下发到**大疆 A 板或 C 板**，驱动 CAN 总线上的大疆/达妙电机，并**实时回传**转速、电流、温度。网页支持切换 **网页控制 / DT7、DR16 遥控器控制**。

**核心特性：换电机不需要改配置表、不需要重新烧固件。** 按电调拨码开关上的实际 ID，在网页上现场添加即可。

新增“步进控制”工作区：脉冲 PU/DR/EN 通过 A/C 板运行，RS-485 通过 USB-485 接入可配置 Modbus RTU，两种均有无硬件演示。脉冲首次接入需烧录新增固件；RS-485 实物须提供匹配的厂家寄存器配置。详见[步进接线与使用说明](docs/2026-10-19-stepper-delivery.md)。

---

## 为什么做这个

实验室里电机型号多（M3508 / M2006 / GM6020 / 达妙 DM-4310…），机械组想测一颗电机好坏，传统流程是找电控组改代码、重新烧板子。本项目把"配置"从固件里搬到了网页上，让测试变成点几下的事。

---

## 系统架构

```
浏览器 ──WebSocket──> Node 服务 ──USB 虚拟串口──> A/C 板 ──CAN──> 电机
                                                    │
                                              遥测实时回传
```

| 环节 | 实现 |
|---|---|
| 前端 | Vue 3 + TypeScript + Vite，离线构建资源 |
| 桥接 | Node + WebSocket + serialport |
| 传输 | USB OTG FS（CDC 虚拟串口，VID:PID = `0483:00CA`） |
| 控制 | A 板 STM32F427IIH6 / C 板 STM32F407IGH6 + FreeRTOS |
| 驱动 | CAN 总线，支持 DJI M3508/M2006/GM6020、达妙 DM-4310 |

---

## 目录结构

| 目录 | 说明 |
|---|---|
| [`basic_framework_atype_usb-master`](basic_framework_atype_usb-master) | **固件工程**（主工程）。基于跃鹿 `basic_framework` 的 A 板适配版，新增 USB CDC 与动态建电机 |
| [`basic_framework_ctype_usb-master`](basic_framework_ctype_usb-master) | **C 板固件**。基于指定参考工程的 F407 板级配置，配套相同网页和遥控器控制 |
| [`motor_bench_host`](motor_bench_host) | **上位机**。Node 串口桥接 + Vue/TypeScript 工作台 |
| `电机测试台方案.md` | 完整方案文档（设计推导、协议定义、排查记录） |

---

## 快速开始

### 1. 编译并烧录固件

#### 在 VS Code 中烧录（本机已配置）

1. 在 VS Code 中直接打开要使用的板型工程目录：A 板为 `basic_framework_atype_usb-master`，C 板为 `basic_framework_ctype_usb-master`。要同时使用两个工程，打开上一级目录的 `RM-MotorBench.code-workspace`，其中已包含总工程、A 板和 C 板三个根目录。
2. 开发板正常供电，使用 CMSIS-DAP 或 J-Link 通过 SWD 接口连接开发板和电脑。
3. 按 `Ctrl+Shift+P`，运行 `Tasks: Run Task`（任务：运行任务），选择下载器对应的烧录任务。单独打开板型目录时只显示本板的三个任务；打开工作区时可选择两板的任务：
   - `MotorBench: 烧录 A 板（CMSIS-DAP）`
   - `MotorBench: 烧录 C 板（CMSIS-DAP）`
   - `MotorBench: 烧录 A 板（J-Link）`
   - `MotorBench: 烧录 C 板（J-Link）`
4. 任务先编译所选板的固件，编译成功后自动写入、校验、复位运行；编译失败则停止烧录。终端出现 `Verified OK` 且任务退出码为 `0` 表示成功。

仅编译时按 `Ctrl+Shift+B`，选择 `MotorBench: 编译 A 板` 或 `MotorBench: 编译 C 板`。这些任务使用 VS Code 内置功能，无需额外扩展；F5 调试不在此配置中。

配置分别位于 `basic_framework_atype_usb-master/.vscode/tasks.json` 和 `basic_framework_ctype_usb-master/.vscode/tasks.json`，由各板目录独立维护，不需要额外烧录脚本。仅打开包含两个板目录的总工程文件夹时，VS Code 不会自动读取子目录的任务，请打开板型目录或上述工作区。

已使用本机路径：Make 为 `D:/mingw/mingw64/bin/mingw32-make.exe`，ARM GCC 为 `D:/Arm_GNU_Toolchain/13.3 rel1/bin`，OpenOCD 为 `D:/hanako/xpack-openocd-0.12.0-7/bin/openocd.exe`，脚本目录为 `D:/hanako/xpack-openocd-0.12.0-7/openocd/scripts`。更换电脑或移动这些工具时，修改对应板任务的 `command`、编译任务的 `options.env.PATH` 和烧录任务的 `-s` 参数。

#### 命令行编译

```powershell
cd basic_framework_atype_usb-master
# ARM GCC 加入 PATH，例如：
$env:PATH = "C:\ST\STM32CubeCLT_1.21.0\GNU-tools-for-STM32\bin;$env:PATH"
mingw32-make -j4
```

产物：`build/basic_framework_ATYPE.hex`，烧录到 A 板。

C 板进入 `basic_framework_ctype_usb-master` 执行相同构建命令，烧录 `build/basic_framework_CTYPE.hex`。C 板引脚、时钟和接收机说明见该目录 README。

### 2. 启动上位机

```powershell
cd motor_bench_host
npm ci
npm run build
npm start
```

需要 Node.js 22.18 或更高版本。浏览器打开 **http://127.0.0.1:3000**；生产资源由同一 Node 服务提供，不依赖在线 CDN。

无需硬件试用：启动后点击「进入无硬件演示」，即可体验 4 颗 DJI + 1 颗 DM 模拟电机、PID 编辑、配置模板、实验记录和只读回放。演示与真实串口互斥，页面及导出始终标注模拟数据；退出后再连接实物。

「配置模板」支持命名、复制和 JSON 导入导出，应用前预览身份/通道及控制来源，应用后保持停机。「测试记录」支持备注、JSON/CSV 导出和离线回放；服务重启会丢失尚未导出的内存记录。详细用法见 [上位机说明](motor_bench_host/README.md)。

新固件1.3支持协议能力协商、绑定应答、通道查询、板端时间及停机原因。「自动测试 · 板端执行」提供有界阶跃、斜坡、正反转速度测试，自动记录并评价超调、稳定时间和稳态误差；演示模式无需硬件即可体验。旧固件继续支持手动操作，自动测试入口会提示升级。

### 3. 使用流程

1. XT30 接 **15~24V** 电源（USB 口不供电）
2. USB 线接 A 板 Micro-USB
3. 连接引导中刷新串口 → 核对设备描述 → 连接开发板
4. 「设备与诊断」登记：型号 / 总线 / 电调 ID
5. 「控制台」选择通道 → 选择已登记电机和控制环 → 绑定 → 使能 → 输入并下发目标

使能从零目标开始；输入框只保存草稿，点击「下发目标」后才发送，板端当前目标单独显示。PID 在「PID / 专业调试」面板展开，读回值不覆盖本地编辑。遥控模式在「控制方式」面板选择通道和最大转速，点「应用控制方式」，右拨杆上档、右摇杆回中后使能。A 板 DR16 使用 USART1，C 板使用 USART3。切换来源、遥控器掉线和急停都会停止输出，恢复后须重新使能；两种模式均须保持 USB 心跳。

---

## ⚠️ CAN ID 规则（重要）

| 电机 | 反馈 ID |
|---|---|
| GM6020 | `0x204 + ID` |
| M3508 / M2006 | `0x200 + ID` |

两段区间**重叠**（`0x205~0x208`），所以：

> 同一总线上反馈 ID 不得冲突；GM6020 与 M3508/M2006 混用时逐项核对反馈 ID。
> 例：6020 用 ID1 会和 3508 用 ID5 撞车。

**建议**：CAN1 只接 6020，CAN2 接 3508/2006。应用最多登记 8 颗电机、8 个逻辑通道，另受 CAN 过滤器及驱动实例容量限制。接线和冲突规则见「设备与诊断」帮助。

---

## 硬件连接

| 接口 | 用途 |
|---|---|
| 接口 21 XT30 | 供电 **15~24V**（**必需**） |
| 接口 17 Micro-USB | USB 通信（OTG FS，PA11/PA12） |
| 接口 14 SWD | 调试下载（PA13/PA14） |
| CAN1 / CAN2 | 接电机电调 |

> ⚠️ **不要**把电机/电调直接接到 A 板的 XT30 输出口（反电动势会烧板）。

---

## 通信协议

自描述帧，统一格式：

```
| 0xA5 | type | len | body[len] | crc8 | 0x5A |
```

- `crc8` 覆盖 `type + len + body`
- 支持流式重同步：帧头误判时右移一字节继续查找
- 上位机与固件端均有 CRC 交叉校验测试

主要帧类型：

| 类型 | 值 | 方向 | 说明 |
|---|---|---|---|
| HEARTBEAT | `0x01` | 上行 | 心跳（安全门闩） |
| MOTOR_BIND | `0x02` | 下行 | 绑定电机到通道 |
| MOTOR_SET | `0x03` | 下行 | 设参考值 |
| MOTOR_ENABLE | `0x04` | 下行 | 使能/停止 |
| ALL_STOP | `0x05` | 下行 | 全部急停 |
| QUERY | `0x06` | 下行 | 查询状态 |
| INVENTORY_QUERY | `0x07` | 下行 | 查询电机清单 |
| **MOTOR_ADD** | `0x08` | 下行 | **动态创建电机** |
| MOTOR_REMOVE | `0x09` | 下行 | 移除电机 |
| CONTROL_SOURCE | `0x0D` | 下行 | 选择网页/遥控器来源、通道和最大转速 |
| CONTROL_REPORT | `0x8E` | 上行 | 来源、遥控器在线、摇杆、回中门闩与转速限幅 |
| TELEMETRY | `0x81` | 上行 | 遥测上报 |
| INVENTORY_REPORT | `0x82` | 上行 | 清单应答 |
| MOTOR_ADD_ACK | `0x8A` | 上行 | 建电机结果 |
| HELLO / CAPABILITIES | `0x0F` / `0x8F` | 双向 | 挑战回显、随机板端会话与能力 |
| BIND_V2 / BIND_ACK | `0x10` / `0x90` | 双向 | 关联会话/序号和完整绑定身份 |
| CHANNEL_QUERY / CHANNEL_REPORT | `0x11` / `0x91` | 双向 | 查询板端实际绑定 |
| TEST_START / TEST_CANCEL / TEST_ACK | `0x12` / `0x13` / `0x94` | 双向 | 有界板端测试与关联结果 |
| BOARD_STATUS | `0x92` | 上行 | 板端时间、测试状态及停机原因 |

新增帧及扩展遥测的完整布局见 [协议与测试设计](docs/superpowers/specs/2026-10-19-protocol-tests-design.md)。

**安全设计**：心跳中断约 1.5s 自动全停；通道未使能时拒绝写参考值；控制页面断开、控制权超时、主动接管和服务退出时下发全停；观察页面关闭不影响控制者。DM 仅在实际反馈新鲜时显示在线，超过 500ms 未反馈会停机，恢复后须重新使能。

---

## 测试

```powershell
cd motor_bench_host
npm run check             # 类型/构建/规范、协议、服务、前端及 A/C 原生回归
npm run test:integration  # 与固件 CRC 表逐字节交叉校验
```

---

## 已知限制

- 电机清单在断电后不保留，重新上电需在网页重新添加（CAN 过滤器为启动期硬件资源）
- PID 默认值沿用现有参数，实际电机需按型号和负载整定
- 电机清单和控制通道均最多 8 个；DM 默认反馈 Master ID 为 0，每条 CAN 总线最多一台 DM，DM 暂不支持网页 PID 设置/查询
- 旧固件无绑定应答/查询，未知通道仅识别显示；运行前须解绑再绑定。新固件由应答/查询确认身份
- 动态指标仅在板端时间、身份、基线及采样连续性合格时有效；模拟数据不能证明实物性能
- 软件交付与待完成的接线/烧录/实机验收见 [协议及自动测试交付](docs/2026-10-19-protocol-tests-delivery.md)

---

## 致谢

- 跃鹿 `basic_framework`：[Gitee](https://gitee.com/hnuyuelurm/basic_framework)
- A 板适配版基础：[basic_framework_atype](https://gitee.com/hnuyuelurm/basic_framework_atype)

---

## 许可

本项目基于 `basic_framework` 修改，请遵循原项目的许可要求。
