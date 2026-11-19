# ADR-001：token 存储方案

- 日期：2026-09-18
- 状态：已采纳
- 关联节次：第 05 节

## 背景

前端拿到 access token（2 小时）与 refresh token（7 天）后需要存起来：每次请求带 access，刷新页面不丢登录态。候选位置是 localStorage 与 httpOnly cookie，选择直接影响 XSS 风险面与实现复杂度。约束：前后端分离、课程项目单人开发、后端 NestJS 与前端 Vite 开发期跨端口（5173 → 3000 代理）。

## 候选方案

1. **方案 A：localStorage（已采纳）**
   - 优点：实现简单，Bearer 头与后端无 cookie 依赖，跨域/代理都不牵扯 SameSite、CSRF；与 axios 拦截器的写法最直白，便于教学理解双 token 流程。
   - 缺点：任何 XSS 都能读到 token。
2. **方案 B：httpOnly cookie**
   - 优点：JS 读不到，天然抗 XSS 窃取。
   - 缺点：必须配 CSRF 防护（跨站请求会自动带上 cookie）；开发期 5173/3000 跨端口要处理 cookie domain 与代理；`/api/auth/refresh` 等接口改从 cookie 取 token，后端与 e2e 都要改；移动端/API 客户端复用变难。
3. **AI 建议的方案**：先 localStorage 快速跑通，把"换 httpOnly cookie"列为上线前改造项。**采纳**——课程项目的首要风险是实现错误而非定向攻击，先把流程做对。

## 决定

选方案 A（localStorage），refresh token 同样存 localStorage，靠轮换 + 登出吊销 + 7 天过期控制泄漏后果。

## 后果

- 好处：第 02 节已跑通的拦截器/守卫逻辑保持简单；后端无 cookie/CSRF 代码。
- 代价：XSS 得手即可同时偷走双 token。缓解措施（本项目实际做了的）：
  - 不使用 `v-html`/`dangerouslySetInnerHTML`，Vue 模板默认转义，无第三方富文本渲染；
  - access 2 小时短命，refresh 每次使用即轮换作废，被盗旧 refresh 一次即失效；
  - 依赖只从 npm 官方源装（`.npmrc` 已配），锁定版本；
  - 后续若引入富文本（如公告），必须先过安全评审再上线。
- 以后要注意：一旦项目要对外真实部署，重估本 ADR，优先迁移 httpOnly cookie + CSRF token。
