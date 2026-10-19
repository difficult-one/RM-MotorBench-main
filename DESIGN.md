---
name: Motor Bench 工作台
description: 面向机械组与电控组的本地电机测试台
colors:
  bg: "#10151c"
  panel: "#181f29"
  panel-alt: "#202936"
  line: "#344153"
  text: "#e8edf5"
  muted: "#a8b6c9"
  accent: "#75afff"
  ok: "#71d9b0"
  warning: "#f0c277"
  danger: "#ff969f"
  stop-fill: "#a92335"
typography:
  body:
    fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  heading:
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
  section:
    fontSize: "17px"
    fontWeight: 600
  label:
    fontSize: "13px"
rounded:
  control: "6px"
  input: "5px"
  badge: "4px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#101e33"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-stop:
    backgroundColor: "{colors.stop-fill}"
    textColor: "#ffffff"
    height: "46px"
    rounded: "{rounded.control}"
---

# Motor Bench 工作台

## Overview

模式为 Operate，依据实施提案第 3 节：基础操作集中、专业参数按需展开。系统使用深色平面和明确边线，优先展示当前电机、板端状态及运行操作。此记录以 `motor_bench_host/frontend/style.css` 与 Vue 组件的实际实现为准。

## Colors

背景、面板和次级面区分工作区层级；蓝色用于主操作与选择，绿色辅助在线状态，黄色表示待确认，红色用于停机和严重错误。颜色始终配合文字。

## Typography

使用本地系统中文无衬线，不加载外部字体。正文和标签采用固定字号；测量值使用 `tabular-nums`。主要读数为 28px，次级读数为 20px，手机次级读数为 18px。说明文字最大 75ch。

## Layout

固定顶栏展示链路、控制权与急停。默认通道栏 232px，专业模式为 220px 通道栏、弹性控制/波形和 320px PID 面板。1600px 以上使用 260px / 弹性 / 350px。1150px 以下 PID 排到主控制区后；760px 以下改为单列、横向紧凑通道选择。手机首屏保留使能与停止；PID 入口定位并聚焦标题，避开固定顶栏。

## Elevation & Depth

使用色面和 1px 边线分层，不依赖阴影。顶栏位于内容上方，消息不遮盖运行状态。

## Shapes

表单和按钮使用轻圆角；输入、选择与主按钮至少 40px 高。聚焦使用 2px 蓝色轮廓，状态过渡为 160ms ease-out，尊重减少动态效果设置。

## Components

通道列表、板端实测、运行操作、目标草稿及波形按任务顺序组织。设备登记与诊断单独进入；切换工作区保留曲线与草稿。PID 分别展示本地编辑、读回及默认值，读回不覆盖编辑。未知身份的单位标为待确认，反馈过期不继续宣称正在运行。

## Do's and Don'ts

- Do 使用板端回传标记实际运行与目标。
- Do 让急停持续可见，PID 入口提供实际定位和焦点。
- Don't 把请求已发送或用户识别信息表达为板端确认。
- Don't 用模拟数据填充真实设备的未连接状态。
