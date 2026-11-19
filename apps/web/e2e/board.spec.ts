import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

/**
 * 第 49 节【测】看板 E2E（Playwright）：
 * 双 page——page A 开看板读当日产量，page B 提交报工，page A 3 秒内产量增加；
 * 无权限用户打开看板菜单不可见/接口 403。
 * 前提：webServer(5173) + API(3000) 已启动，种子数据已灌（npm run seed）。
 */

const ADMIN = { username: 'admin', password: 'Admin@123' };
const API = 'http://localhost:3000/api';

/** 登录拿 token + 找一个可报工的员工（id 随库重建变化，不能硬编码）。
 *  token 进程级缓存：登录接口限流 20/min，用例间复用避免打满。 */
let cachedToken: string | null = null;
async function apiSetup(minRemaining = 10): Promise<{ token: string; employeeId: number; opId: number | null }> {
  if (!cachedToken) {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    const { data } = (await loginRes.json()) as { data: { accessToken: string } | null };
    if (!data) throw new Error('admin 登录失败（可能限流）');
    cachedToken = data.accessToken;
  }
  const token = cachedToken;
  const auth = { Authorization: `Bearer ${token}` };
  const emps = (await (await fetch(`${API}/employees?pageSize=1`, { headers: auth })).json()) as { data: { list: { id: number; teamId: number }[] } };
  const employeeId0 = emps.data.list[0]?.id ?? 0;

  // 找有余量且员工可报的工序：员工须在该工序派工班组内（第 38 节一致性校验）
  let opId: number | null = null;
  let employeeId = employeeId0;
  const wos = (await (await fetch(`${API}/work-orders?status=IN_PROGRESS&pageSize=20`, { headers: auth })).json()) as { data?: { list: { id: number }[] } };
  for (const wo of wos.data?.list ?? []) {
    const ops = (await (await fetch(`${API}/work-order-operations/work-order/${wo.id}`, { headers: auth })).json()) as { data?: { id: number; status: string; completedQty: number; plannedQty: number; teamId: number | null }[] };
    const open = (ops.data ?? []).find((o) => o.status === 'IN_PROGRESS' && o.plannedQty - o.completedQty >= minRemaining);
    if (!open) continue;
    if (open.teamId) {
      const teamEmps = (await (await fetch(`${API}/employees?teamId=${open.teamId}`, { headers: auth })).json()) as { data: { list: { id: number; status: string }[] } };
      const emp = teamEmps.data.list.find((e) => e.status === 'ACTIVE');
      if (!emp) continue;
      opId = open.id; employeeId = emp.id; break;
    }
    opId = open.id; employeeId = employeeId0; break;
  }
  return { token, employeeId, opId };
}

async function report(token: string, employeeId: number, opId: number, goodQty: number): Promise<Response> {
  return fetch(`${API}/work-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workOrderOperationId: opId, employeeId, goodQty, defectQty: 0, idempotencyKey: `e2e-${Date.now()}-${Math.random()}` }),
  });
}

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/用户名/).fill(ADMIN.username);
  await page.getByPlaceholder(/密码/).fill(ADMIN.password);
  await page.getByRole('button', { name: /登 录|登录/ }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 });
}

test('看板实时更新：page A 开看板，page B 报工，A 的产量 3 秒内增加', async ({ browser }) => {
  const { token, employeeId, opId } = await apiSetup();
  test.skip(opId === null, '无进行中工序任务（先跑业务造数）');

  // page A：登录并打开看板
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await login(pageA);
  await pageA.goto('/board');
  const qtyEl = pageA.getByTestId('today-qty');
  await expect(qtyEl).toBeVisible({ timeout: 10000 });
  // 等 summary 稳定（页面 socket connect 后会再拉一次）再记基线
  await pageA.waitForTimeout(1500);
  const before = Number((await qtyEl.textContent()) ?? '0');

  // page B（第二个 context）：报工
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto('/');
  const repStatus = await report(token, employeeId, opId as number, 5);
  expect(repStatus.status).toBe(201);

  // page A 3 秒内产量增加 5（用轮询：允许基数并发波动，断言出现过 before+5）
  await expect
    .poll(async () => Number((await qtyEl.textContent()) ?? '0'), { timeout: 3000, intervals: [200, 300, 500] })
    .toBe(before + 5);
  await contextA.close();
  await contextB.close();
});

test('无 board:view 权限的用户：summary 接口 403、socket 被拒', async ({ browser }) => {
  const api = API;
  const loginRes = await fetch(`${api}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'operator', password: 'User@123' }),
  });
  const { data: { accessToken } } = (await loginRes.json()) as { data: { accessToken: string } };

  // summary 接口 403
  const res = await fetch(`${api}/board/summary`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(res.status).toBe(403);

  // socket 握手被拒（connect_error）
  const error = await new Promise<string>((resolve) => {
    const socket: Socket = io('http://localhost:3000/board', {
      path: '/board/socket.io', auth: { token: accessToken }, transports: ['websocket'],
    });
    socket.on('connect_error', (e: Error) => { resolve(e.message); socket.disconnect(); });
    setTimeout(() => resolve('timeout'), 5000);
  });
  expect(error).toContain('rejected');

  // UI：operator 登录后看板菜单不可见（菜单按权限剪枝）
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  await page.goto('/');
  await expect(page.getByText('车间看板')).toHaveCount(0);
  await context.close();
});

test('用例9：1366×768 与 1920×1080 看板布局不溢出', async ({ browser }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page);
    await page.goto('/board');
    await expect(page.getByTestId('today-qty')).toBeVisible({ timeout: 10000 });
    // 横向不溢出：页面滚动宽度不超过视口宽度
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${viewport.width}×${viewport.height} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(0);
    // 核心区块可见（限定看板卡片标题，避免命中左侧菜单同名项）
    for (const locator of [page.getByRole('heading', { name: '设备状态' }), page.getByRole('heading', { name: '最近报工' }), page.getByText('当日产量')]) {
      const box = await locator.boundingBox();
      expect(box, `${viewport.width}×${viewport.height} 区块不可见`).not.toBeNull();
    }
    await context.close();
  }
});

test('用例6：事件风暴——连续 5 次报工后产量终值正确（前端 500ms 节流合并）', async ({ browser }) => {
  const { token, employeeId, opId } = await apiSetup();
  test.skip(opId === null, '无进行中工序任务（先跑业务造数）');

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  await page.goto('/board');
  const qtyEl = page.getByTestId('today-qty');
  await expect(qtyEl).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const before = Number((await qtyEl.textContent()) ?? '0');

  // 连续 5 次报工（每次 +2），间隔 < 500ms——前端 500ms 节流合并刷新，最终显示 +10
  for (let i = 0; i < 5; i += 1) {
    const res = await report(token, employeeId, opId as number, 2);
    expect(res.status).toBe(201);
  }
  await expect
    .poll(async () => Number((await qtyEl.textContent()) ?? '0'), { timeout: 5000, intervals: [300, 500, 800] })
    .toBe(before + 10);
  await context.close();
});
