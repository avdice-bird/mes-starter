import { test, expect } from '@playwright/test';

test('登录后首页显示后端连接正常', async ({ page }) => {
  // 首页在 AdminLayout 内，未登录会被路由守卫重定向到 /login——先登录
  await page.goto('/login');
  await page.getByPlaceholder(/用户名/).fill('admin');
  await page.getByPlaceholder(/密码/).fill('Admin@123');
  await page.getByRole('button', { name: /登 录|登录/ }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 });
  await page.goto('/');
  await expect(page.getByText('后端连接正常')).toBeVisible({ timeout: 10000 });
});
