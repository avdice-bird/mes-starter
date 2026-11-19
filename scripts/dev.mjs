#!/usr/bin/env node
/**
 * 并行启动 server、web 与 h5 的开发服务（npm workspaces 下手动并行）：
 *   node scripts/dev.mjs  （即 npm run dev）
 * 任一进程退出时，终止其他进程并以其退出码退出。
 */
import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tasks = [
  { name: 'server', args: ['run', 'dev', '-w', '@mes/server'] },
  { name: 'web', args: ['run', 'dev', '-w', '@mes/web'] },
  { name: 'h5', args: ['run', 'dev', '-w', '@mes/h5'] },
];

let exitCode = 0;
const children = tasks.map(({ name, args }) => {
  // Node 20+（CVE-2024-27980 后）在 Windows 上 spawn .cmd 必须 shell:true，否则 EINVAL
  const child = spawn(npmCmd, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (exitCode === 0 && code) exitCode = code;
    for (const other of children) {
      if (other !== child && other.exitCode === null) other.kill();
    }
  });
  console.log(`[dev] 已启动 ${name} (pid ${child.pid})`);
  return child;
});

process.on('SIGINT', () => {
  for (const child of children) if (child.exitCode === null) child.kill();
});
