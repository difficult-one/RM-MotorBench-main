export interface Motor { kind: number; canBus: number; motorId: number; outerLoop: number }
export interface Binding extends Motor { channelId: number; identified?: boolean }
export interface Telemetry { channelId: number; online: boolean; enabled: boolean; ref: number; speed: number; torque: number; angle: number; temperature: number; receivedAt?: number }
export interface Pid { Kp: number; Ki: number; Kd: number; MaxOut: number; IntegralLimit: number; improve: number }
export interface Control { source: number; channelId: number; ready: boolean; online: boolean; maxRef: number; channels?: number[]; reverseMask?: number; result: number }
export interface LogEntry { time: number; message: string; level: string }
export interface Report { type: string; data?: any; [key: string]: any }
