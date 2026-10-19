/** Browser-safe facts; wire encoders remain in protocol.js. */
export const FRAME_HEAD = 0xa5;
export const FRAME_TAIL = 0x5a;

/** 单帧最大负载长度,需与固件 MB_PAYLOAD_MAX 一致(越界即判为假帧头) */
export const MAX_PAYLOAD = 64;

/** 帧类型,需与固件 MB_FrameType_e 一致 */
export const FrameType = {
  HEARTBEAT: 0x01,
  MOTOR_BIND: 0x02,
  MOTOR_SET: 0x03,
  MOTOR_ENABLE: 0x04,
  ALL_STOP: 0x05,
  QUERY: 0x06,
  INVENTORY_QUERY: 0x07,
  MOTOR_ADD: 0x08,
  MOTOR_REMOVE: 0x09,
  PID_SET: 0x0a,
  PID_QUERY: 0x0b,
  MOTOR_UNBIND: 0x0c,
  CONTROL_SOURCE: 0x0d,
  CHASSIS_ENABLE: 0x0e,
  HELLO: 0x0f, BIND_V2: 0x10, CHANNEL_QUERY: 0x11, TEST_START: 0x12, TEST_CANCEL: 0x13,
  CAPABILITIES: 0x8f, BIND_ACK: 0x90, CHANNEL_REPORT: 0x91, BOARD_STATUS: 0x92, TEST_ACK: 0x94,
  TELEMETRY: 0x81,
  INVENTORY_REPORT: 0x82,
  MOTOR_ADD_ACK: 0x8a,
  PID_REPORT: 0x8b,
  PID_SET_ACK: 0x8c,
  UNBIND_ACK: 0x8d,
  CONTROL_REPORT: 0x8e,
};

export const Capability={BIND_ACK:1,CHANNELS:2,BOARD_TIME:4,TEST_SEQUENCE:8};
export const StopReasonText=['开机/未运行','用户急停','主机心跳失联','遥控失联或未回中','电机反馈丢失','配置改变','输出被禁用','测试完成','测试已取消','链路会话改变','USB连接丢失'];
export const TestStateText=['未运行','正在测试','测试完成','已取消','故障中止'];

/** 电机种类,需与固件 MB_MotorKind_e 一致 */
export const MotorKind = {
  NONE: 0,
  GM6020: 1,
  M3508: 2,
  M2006: 3,
  DM: 4,
  LK: 5,
  HT: 6,
};

export const MotorKindLabel = {
  [MotorKind.GM6020]: '大疆 GM6020',
  [MotorKind.M3508]: '大疆 M3508',
  [MotorKind.M2006]: '大疆 M2006',
  [MotorKind.DM]: '达妙 DM 系列',
  [MotorKind.LK]: 'LK9025',
  [MotorKind.HT]: 'HT04',
};

/** 闭环类型,需与固件 Closeloop_Type_e 一致 */
export const LoopType = {
  OPEN_LOOP: 0b0000,
  CURRENT_LOOP: 0b0001,
  SPEED_LOOP: 0b0010,
  ANGLE_LOOP: 0b0100,
};

export const LoopLabel = {
  [LoopType.OPEN_LOOP]: '开环',
  [LoopType.CURRENT_LOOP]: '电流环',
  [LoopType.SPEED_LOOP]: '速度环',
  [LoopType.ANGLE_LOOP]: '角度环',
};

/**
 * 单通道遥测的字节数,需与固件 MB_TelemetryItem_s 的 sizeof 一致。
 * 结构:u16 channel_id + u16 status + f32 ref + f32 speed + f32 torque + f32 angle + i8 temp
 *     = 2+2+4+4+4+4+1 = 21 字节(pack(1) 对齐后仍为 21)
 */
export const TELEMETRY_ITEM_BYTES = 21;


export const MBResult = {
  OK: 0,
  BAD_PARAM: 1,
  DUPLICATE: 2,
  NOT_PROVISIONED: 3,
  NOT_ENABLED: 4,
  UNSUPPORTED: 5,
  NO_RESOURCE: 6,
};

/** 返回码 → 给人看的原因(直接用于界面提示) */
export const MBResultText = {
  [MBResult.OK]: '成功',
  [MBResult.BAD_PARAM]: '参数不合法(总线只能填 1 或 2,ID 不能为 0)',
  [MBResult.DUPLICATE]:
    '冲突:该总线上已有电机占用同一 ID。' +
    '注意 6020 用 0x204+ID、3508/2006 用 0x200+ID,两者区间重叠,必须分开挂在不同 CAN 总线上',
  [MBResult.NOT_PROVISIONED]: '板端没有这颗电机,请先刷新清单',
  [MBResult.NOT_ENABLED]: '通道未使能',
  [MBResult.UNSUPPORTED]: '该电机种类尚未接入测试台',
  [MBResult.NO_RESOURCE]: '资源不足:应用最多登记 8 颗电机,请检查过滤器和驱动容量',
};


export const PidLoop = {
  SPEED: 0,
  CURRENT: 1,
  ANGLE: 2,
};

export const PidLoopLabel = {
  [PidLoop.SPEED]: '速度环',
  [PidLoop.CURRENT]: '电流环',
  [PidLoop.ANGLE]: '位置环',
};

/**
 * PID 默认参数 —— 与固件 motor_bench_app.c 的 bench_dji_*_pid[] 逐项对应。
 *
 * 来源:gimbal-fed infantry 工程实机整定值(2026-10-12 迁移)。
 *   M3508  -> shoot.c   摩擦轮 friction_config
 *   M2006  -> shoot.c   拨弹盘 loader_config (速度环部分)
 *   GM6020 -> gimbal.c  yaw 轴
 *
 * @note 放在 protocol.js 而非 ui.js:这是**协议层数据**,不是界面状态。
 *   ui.js 要在页面里显示默认值,selftest.js 要校验与固件一致,
 *   两边都 import 同一份就消除了"页面显示一套、固件生效另一套"的风险。
 */
export const PID_DEFAULTS = {
  // 大疆 M3508 —— 摩擦轮实参(close_loop = SPEED|CURRENT)
  [MotorKind.M3508]: {
    speed: { Kp: 20, Ki: 1, Kd: 0, MaxOut: 15000, IntegralLimit: 10000, improve: 0 },
    current: { Kp: 0.7, Ki: 0.1, Kd: 0, MaxOut: 15000, IntegralLimit: 10000, improve: 0 },
    angle: { Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 },
  },
  // 大疆 M2006 —— 拨弹盘速度环实参
  [MotorKind.M2006]: {
    speed: { Kp: 10, Ki: 1, Kd: 0, MaxOut: 5000, IntegralLimit: 5000, improve: 0 },
    current: { Kp: 0.7, Ki: 0.1, Kd: 0, MaxOut: 5000, IntegralLimit: 5000, improve: 0 },
    angle: { Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 },
  },
  // 大疆 GM6020 —— yaw 轴实参
  [MotorKind.GM6020]: {
    speed: { Kp: 50, Ki: 200, Kd: 0, MaxOut: 20000, IntegralLimit: 3000, improve: 5 },
    current: { Kp: 0.7, Ki: 0.1, Kd: 0, MaxOut: 20000, IntegralLimit: 3000, improve: 0 },
    angle: { Kp: 8, Ki: 0, Kd: 0, MaxOut: 500, IntegralLimit: 100, improve: 5 },
  },
  // 达妙 DM —— 暂不引入,延用原测试台配置(用户明确要求"达妙暂时不变")
  [MotorKind.DM]: {
    speed: { Kp: 5, Ki: 0, Kd: 0, MaxOut: 10, IntegralLimit: 8, improve: 0 },
    current: { Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 },
    angle: { Kp: 0, Ki: 0, Kd: 0, MaxOut: 0, IntegralLimit: 0, improve: 0 },
  },
};

