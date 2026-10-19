import type { Report } from './types.ts';
type Pending = { resolve: (value: Report) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; boardType?: string };
export class BenchConnection {
  ready = false;
  private socket?: WebSocket;
  private retry = 0;
  private sequence = 0;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, Pending>();
  private url: string;
  private receive: (report: Report) => void;
  private status: (online: boolean) => void;
  private deps: { createSocket: () => WebSocket; schedule: typeof setTimeout; cancel: typeof clearTimeout };
  constructor(url: string, receive: (report: Report) => void, status: (online: boolean) => void, deps?: { createSocket: () => WebSocket; schedule: typeof setTimeout; cancel: typeof clearTimeout }) {
    this.url = url; this.receive = receive; this.status = status;
    this.deps = deps ?? { createSocket: () => new WebSocket(this.url), schedule: setTimeout.bind(globalThis), cancel: clearTimeout.bind(globalThis) };
  }
  connect() {
    if (this.stopped) return;
    const socket = this.deps.createSocket(); this.socket = socket;
    socket.onopen = () => { this.retry = 0; this.status(true); socket.send(JSON.stringify({ type: 'getSnapshot' })); };
    socket.onmessage = event => {
      if (socket !== this.socket) return;
      const report: Report = JSON.parse(event.data);
      if (report.type === 'snapshot') this.ready = true;
      const pending = this.pending.get(report.requestId);
      if (pending) {
        if (report.type === 'commandResult' && !report.ok) { pending.reject(Error(report.message)); this.remove(report.requestId); }
        else if ((report.type === 'commandResult' && !pending.boardType) || report.type === pending.boardType) { pending.resolve(report); this.remove(report.requestId); }
      }
      this.receive(report);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.ready = false; this.status(false);
      for (const pending of this.pending.values()) { this.deps.cancel(pending.timer); pending.reject(Error('服务连接中断,操作结果未确认')); }
      this.pending.clear();
      if (!this.stopped) this.timer = this.deps.schedule(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }
  private remove(id: string) { const pending = this.pending.get(id); if (pending) this.deps.cancel(pending.timer); this.pending.delete(id); }
  command(command: Record<string, unknown>, boardType?: string) {
    if (!this.socket || this.socket.readyState !== 1) throw Error('服务离线,正在自动重连');
    if (!this.ready && command.type !== 'stopAll') throw Error('正在同步板端状态,请稍后操作');
    const requestId = `ui-${Date.now()}-${++this.sequence}`;
    const promise = new Promise<Report>((resolve, reject) => {
      const timer = this.deps.schedule(() => { this.pending.delete(requestId); reject(Error('请求超时,结果未确认,请检查连接后核对')); }, 4500);
      this.pending.set(requestId, { resolve, reject, timer, boardType });
      this.socket!.send(JSON.stringify({ ...command, requestId }));
    });
    return { requestId, promise };
  }
  keepAlive() { if (this.ready && this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'keepAlive' })); }
  dispose() { this.stopped = true; if (this.timer) this.deps.cancel(this.timer); this.socket?.close(); }
}
