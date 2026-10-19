import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd();
const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'motorbench-optimization-baseline-'));
fs.copyFileSync(path.join(root, '.git/index'), path.join(destination, 'git-index'));
fs.cpSync(path.join(root, 'motor_bench_host'), path.join(destination, 'motor_bench_host'), {
  recursive: true, filter: source => !source.split(path.sep).includes('node_modules'),
});
for (const board of ['atype', 'ctype']) {
  const directory = `basic_framework_${board}_usb-master/modules`;
  fs.cpSync(path.join(root, directory), path.join(destination, directory), { recursive: true });
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
console.log(JSON.stringify({ destination, indexHash: hash('.git/index'), copies: ['server.js', 'ui.js'].map(file => ({
  file, identical: hash(`motor_bench_host/${file}`) === hash(`RM-MotorBench/motor_bench_host/${file}`),
})) }, null, 2));
