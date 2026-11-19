#!/usr/bin/env node
/**
 * 一键关闭：优先按 .dev-pids.json 记录整树强杀；没有记录或杀不干净时，按端口 3000/5173/5174 兜底清理残留。
 *   node scripts/stop.mjs   （或双击 关闭.bat / npm stop）
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = path.join(root, '.dev-pids.json');
const isWin = process.platform === 'win32';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** 整树强杀（npm → node → nest/vite 一串都要杀掉） */
function killTree(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGKILL'); // detached 启动的子进程自成进程组
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
    return true;
  } catch {
    return false;
  }
}

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

let killed = 0;

if (existsSync(pidFile)) {
  const { tasks = [] } = JSON.parse(readFileSync(pidFile, 'utf8'));
  for (const t of tasks) {
    if (isAlive(t.pid) && killTree(t.pid)) {
      console.log(`[stop] 已停止 ${t.name}（pid ${t.pid}）`);
      killed++;
    } else {
      console.log(`[stop] ${t.name}（pid ${t.pid}）已不在运行`);
    }
  }
  rmSync(pidFile);
} else {
  console.log('[stop] 没有运行记录（.dev-pids.json），按端口清理残留…');
}

// 兜底：端口上还有 LISTENING 进程（记录丢失、上次手动启动等），一并清掉
for (const port of [3000, 5173, 5174]) {
  for (const pid of pidsOnPort(port)) {
    if (killTree(pid)) {
      console.log(`[stop] 已清理端口 ${port} 的残留进程（pid ${pid}）`);
      killed++;
    }
  }
}

console.log(killed ? `[stop] 完成，共停止 ${killed} 个进程` : '[stop] 没有需要停止的进程');
