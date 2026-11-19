#!/usr/bin/env node
/**
 * 里程碑验收脚本框架：node scripts/verify/run.mjs m1
 * 通过 HTTP 调用运行中的服务（默认 http://localhost:3000），输出"通过 N/M 项"。
 * 每个里程碑的检查项在 mN.mjs 里，返回 [{ name, run: async (ctx) => void }]，抛错即失败。
 */
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000/api';
const which = process.argv[2];
if (!which) { console.error('用法: node scripts/verify/run.mjs m1|m2|m3|m4'); process.exit(2); }

const ctx = {
  base: BASE,
  tokens: {},
  async call(method, path, { body, token, raw } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = raw ? null : await res.json().catch(() => null);
    return { status: res.status, body: json };
  },
  async login(username, password) {
    const r = await this.call('POST', '/auth/login', { body: { username, password } });
    if (r.status !== 200) throw new Error(`登录失败 ${username}: ${r.status} ${r.body?.message ?? ''}`);
    this.tokens[username] = r.body.data.accessToken;
    return r.body.data;
  },
  expect(cond, msg) { if (!cond) throw new Error(msg); },
};

const { default: checks } = await import(`./${which}.mjs`);
let pass = 0;
for (const c of checks) {
  try { await c.run(ctx); pass++; console.log(`  ✓ ${c.name}`); }
  catch (e) { console.log(`  ✗ ${c.name}\n      ${e.message}`); }
}
console.log(`\n${which.toUpperCase()}：通过 ${pass}/${checks.length} 项`);
process.exit(pass === checks.length ? 0 : 1);
