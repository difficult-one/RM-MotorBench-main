# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
实验室机械组和电控组，共用 A/C 板电机测试台。

## Product Purpose
连接、登记、绑定、输入目标、使能、观察和停机形成清晰闭环；专业调试可展开。

## Capabilities and Constraints
依据用户要求实施的 2026-10-19 优化提案：Vue 3 + TypeScript、Node 串口桥接、现有 USB/CAN 协议；8 电机/8 通道；本机优先、离线可用；PID 本地编辑和板端事实分开；重连不恢复输出；急停持续可见。手机保留必要操作。

## Product Principles
- 所有运行状态来自板端反馈，请求发送不等于板端成功。
- 基础操作集中，配置和专业参数按需展开。
- 量纲明确，未校准值标注原始量。
- 状态恢复只恢复观察，不自动使能。

## Evidence on Hand
现有协议、绑定恢复、波形历史及 A/C 原生固件回归；暂无本轮改动的实物验收结果。
