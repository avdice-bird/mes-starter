#!/usr/bin/env node
/**
 * 一键启动：后台拉起 server(3000)、web(5173) 与 h5(5174)，日志写 logs/，进程记到 .dev-pids.json。
 *   node scripts/start.mjs   （或双击 启动.bat / npm start）
 * 对应关闭：node scripts/stop.mjs（关闭.bat）。
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = path.join(root, '.dev-pids.json');
const logDir = path.join(root, 'logs');
const isWin = process.platform === 'win32';

/** 进程是否还活着 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // EPERM = 存在但无权限
  }
}

/** 监听指定端口的进程 PID 列表（用于检测脚本之外的残留进程） */
function pidsOnPort(port) {
  try {
    if (isWin) {
      // 不加 -p tcp：vite 等可能监听 IPv6（[::]:5173），需要一并解析
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) pids.add(Number(m[2]));
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    return out ? out.split('\n').map(Number) : [];
  } catch {
    return [];
  }
}

// server 跑预编译 dist（node 直接常驻）：nest start --watch 的 npm→node→nest 链在
// 双击 bat + detached 组合下，bat 窗口关闭/Ctrl+C 会整树终止（56/57 节调试确认），
// 且 watch 的热更在常驻场景没意义——start 场景要的是"活着"。
// 先确保 dist 存在且不比 src 旧，否则现场构建一次。
const tasks = [
  { name: 'server', cmd: 'node --use-system-ca apps/server/dist/src/main.js', port: 3000, log: 'server.log', prebuild: { cwd: 'apps/server', check: 'dist/src/main.js', vs: 'src' } },
  { name: 'web', cmd: 'npm run dev -w @mes/web', port: 5173, log: 'web.log' },
  { name: 'h5', cmd: 'npm run dev -w @mes/h5', port: 5174, log: 'h5.log' },
];

function newestMtime(p) {
  let latest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else latest = Math.max(latest, statSync(full).mtimeMs);
    }
  };
  try { walk(p); } catch { /* 目录不存在按 0 */ }
  return latest;
}

function ensureServerDist() {
  const cwd = path.join(root, 'apps', 'server');
  const distMain = path.join(cwd, 'dist', 'src', 'main.js');
  const needBuild = !existsSync(distMain) || newestMtime(path.join(cwd, 'src')) > statSync(distMain).mtimeMs;
  if (!needBuild) return;
  console.log('[start] server dist 缺失或落后于 src，先构建（约 20s）…');
  execSync('npm run build', { cwd, stdio: 'inherit' });
}

// 已按脚本启动过且仍在运行：不重复启动
if (existsSync(pidFile)) {
  const prev = JSON.parse(readFileSync(pidFile, 'utf8'));
  const alive = (prev.tasks ?? []).filter((t) => isAlive(t.pid));
  if (alive.length) {
    console.log(`[start] MES 开发服务已在运行（${alive.map((t) => t.name).join('、')}）。`);
    console.log('[start] 如需重启，先运行：关闭.bat 或 node scripts/stop.mjs');
    process.exit(1);
  }
  rmSync(pidFile); // 记录已失效，清掉重新来
}

// 端口被脚本之外的进程占着（例如上次没按脚本关闭的残留）：拒绝启动，避免端口漂移
for (const t of tasks) {
  const pids = pidsOnPort(t.port);
  if (pids.length) {
    console.log(`[start] 端口 ${t.port} 已被 PID ${pids.join(', ')} 占用。`);
    console.log('[start] 若是本项目残留进程，先运行：关闭.bat 或 node scripts/stop.mjs');
    process.exit(1);
  }
}

ensureServerDist();

mkdirSync(logDir, { recursive: true });
const records = tasks.map((t) => {
  const fd = openSync(path.join(logDir, t.log), 'a');
  // shell:true 兼容 npm.cmd；detached 让子进程在脚本退出后继续跑，日志追加到 logs/
  const child = spawn(t.cmd, { shell: true, cwd: root, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  console.log(`[start] ${t.name} 已后台启动（pid ${child.pid}，端口 ${t.port}，日志 logs/${t.log}）`);
  return { name: t.name, pid: child.pid, port: t.port };
});

writeFileSync(pidFile, JSON.stringify({ startedAt: new Date().toISOString(), tasks: records }, null, 2));
console.log('[start] Web http://localhost:5173 ｜ 移动端 http://localhost:5174 ｜ 接口 http://localhost:3000/api ｜ 文档 http://localhost:3000/api/docs');
console.log('[start] 日志在 logs/，关闭请运行 关闭.bat 或 node scripts/stop.mjs');
