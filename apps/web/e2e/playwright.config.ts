import { defineConfig } from '@playwright/test';
// 第 49 节启用：npx playwright install chromium
export default defineConfig({
  testDir: './e2e', // 只收 e2e 目录；testDir '.' 会扫到 src/__tests__（vitest 文件）与 vite 产物
  // 串行：用例间共享后端限流（登录 20/min）与"当日产量"数据，并行会互相污染
  workers: 1,
  retries: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, cwd: '..' },
});
