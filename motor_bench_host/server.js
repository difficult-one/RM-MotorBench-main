import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBridge } from './bridge.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
const args = { port: Number(process.env.PORT ?? 3000), host: '127.0.0.1', baud: 115200 };
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (argument === '--port' || argument === '-p') args.port = Number(process.argv[++i]);
  else if (argument === '--host') args.host = process.argv[++i];
  else if (argument === '--baud' || argument === '-b') args.baud = Number(process.argv[++i]);
  else if (argument === '--help') { console.log('node server.js [--port 3000] [--host 127.0.0.1] [--baud 115200]'); process.exit(0); }
  else throw Error(`不支持的参数: ${argument}`);
}
if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) throw Error('HTTP 端口无效');
const root = path.join(directory, 'dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let requested;
  try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('前端尚未构建或资源不存在,请先运行 npm run build'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); res.end(bytes);
  });
});
const bridge = attachBridge(server, args);
async function shutdown() { bridge.stop('服务退出,已请求全停'); await bridge.close(); server.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
server.listen(args.port, args.host, () => console.log(`电机测试台: http://${args.host}:${server.address().port}`));
