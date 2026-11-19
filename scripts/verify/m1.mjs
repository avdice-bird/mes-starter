/** M1（第 12 节）：登录/刷新/登出；错密码 401；无权限 403；字典 CRUD；审计日志有记录；全部测试通过 */
export default [
  { name: '健康检查', async run(c) { const r = await c.call('GET', '/health'); c.expect(r.status === 200 && r.body.code === 0, `health ${r.status}`); } },
  { name: 'admin 登录返回双 token 且 user 无 password', async run(c) {
    const d = await c.login('admin', 'Admin@123');
    c.expect(d.accessToken && d.refreshToken, '缺 token'); c.expect(d.user && d.user.password === undefined, '响应含 password');
  } },
  { name: '错误密码 401 且消息统一', async run(c) {
    const r = await c.call('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } });
    c.expect(r.status === 401, `status ${r.status}`); c.expect(r.body.message === '用户名或密码错误', `消息 ${r.body.message}`);
  } },
  { name: 'refresh 成功且旧 refresh 重放被拒', async run(c) {
    const d = await c.login('admin', 'Admin@123');
    const r1 = await c.call('POST', '/auth/refresh', { body: { refreshToken: d.refreshToken } });
    c.expect(r1.status === 200 && r1.body.data.accessToken, 'refresh 失败');
    const r2 = await c.call('POST', '/auth/refresh', { body: { refreshToken: d.refreshToken } });
    c.expect(r2.status === 401, `重放应 401，实际 ${r2.status}`);
  } },
  { name: 'operator 访问 /users 返回 403', async run(c) {
    await c.login('operator', 'User@123'); // 种子密码见 prisma/rbac-data.ts USERS
    const r = await c.call('GET', '/users', { token: c.tokens.operator });
    c.expect(r.status === 403, `status ${r.status}`);
  } },
  { name: '未登录访问 /auth/me 返回 401', async run(c) { const r = await c.call('GET', '/auth/me'); c.expect(r.status === 401, `status ${r.status}`); } },
  { name: '字典 CRUD', async run(c) {
    const t = c.tokens.admin ?? (await c.login('admin', 'Admin@123')).accessToken;
    const code = 'verify_m1_' + Date.now().toString(36);
    const cr = await c.call('POST', '/dicts', { body: { code, name: '验收字典' }, token: t });
    c.expect(cr.status === 201 || cr.status === 200, `create ${cr.status}`);
    const id = cr.body.data.id;
    const dup = await c.call('POST', '/dicts', { body: { code, name: '重复' }, token: t });
    c.expect(dup.status === 409, `重复编码应 409，实际 ${dup.status}`);
    const up = await c.call('PATCH', `/dicts/${id}`, { body: { name: '改名' }, token: t });
    c.expect(up.status === 200, `update ${up.status}`);
    const del = await c.call('DELETE', `/dicts/${id}`, { token: t });
    c.expect(del.status === 200, `delete ${del.status}`);
  } },
  { name: '写操作产生审计日志', async run(c) {
    const t = c.tokens.admin;
    const r = await c.call('GET', '/audit-logs?pageSize=5', { token: t });
    c.expect(r.status === 200 && r.body.data.total > 0, '审计日志为空');
  } },
];
