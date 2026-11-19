# OWASP Top 10 审查（第 57 节）

逐项审查全项目，每条附证据（文件与行为）。审查日 2026-10-10。

## A01 访问控制失效 ✅

- 所有 Controller 方法都有 `@Permissions(...)` 或 `@Public()`：扫描测试 `test/permissions-scan.e2e-spec.ts` 实测通过（"每个 Controller 方法都有 @Permissions 或 @Public"）。
- 权限守卫双防线：`JwtAuthGuard`（APP_GUARD）+ `PermissionsGuard`（`src/modules/auth/auth.module.ts:32-33`）。
- AI 查询不绕权限：工具执行器复用现有 Service（`src/modules/ai/ai-tool-executor.service.ts`），LLM 本身无数据库连接。
- 未发现 IDOR 漏洞需修复：资源接口均按 id 查询并校验存在性；安灯响应人从 token 取（`andon.service.ts respond`，第 51 节用例 9）。

## A02 加密机制失败 ✅

- 密码 bcrypt（`auth.service.ts`），cost 默认 10；用户不存在时也跑同强度比对防时序探测（`auth.service.ts:17` 注释）。
- JWT 签名密钥来自 env（`JWT_SECRET`），不允许代码写死。
- `.env` 未入库：`git ls-files` 仅 `.env.example`（key 全空）；`.gitignore:5-7` 覆盖 `.env`/`.env.*`。

## A03 注入 ✅

- 全项目 `$queryRawUnsafe/$executeRawUnsafe` 仅 3 处：`health.controller.ts:15`（`SELECT 1`）、`prisma.service.ts:12-13`（PRAGMA）——全部无用户输入。
- 带 `${}` 的模板查询用 tagged template（`main.ts` 的 board:view 查询、`board-socket.e2e-spec.ts`）——Prisma tagged template 本身参数化。
- 其余查询全走 Prisma Client（参数化）。AI 工具参数经白名单正则/长度校验后传入 Prisma（红队用例 4 实测注入无效）。
- 前端 AI 回答经 DOMPurify 消毒再 `v-html`（`AiChat.vue` renderMarkdown）。

## A04 不安全设计 ✅（含 1 项改进）

- 报表/看板口径集中（`docs/acceptance/*.md`），状态机用转换表防非法流转。
- 改进（本节）：`AllExceptionsFilter` 将 body-parser `PayloadTooLargeError` 归为 400 `1001 请求体过大`——原先 500 泄漏内部错误类别。

## A05 安全配置错误 ✅

- Swagger 仅非生产注册（`main.ts:46` `if (process.env.NODE_ENV !== 'production')`）。
- CORS：`WEB_ORIGIN` 白名单；未配置时生产拒绝、开发放开（`main.ts:17-22`）。
- CORS 不开 credentials（防反射任意来源 + credentials 组合，`main.ts:15` 注释）。
- 无 `simulate`/debug 接口（全项目 grep 无此路由）。
- JWT_SECRET 示例值提示更换（`.env.example`）。

## A06 自带缺陷和过时的组件 ⚠️（记录，不阻塞）

- `npm audit --workspaces`（官方 registry）：62 项（4 low / 17 moderate / 40 high / 1 critical）。
- **逐项核对：全部位于 devDependencies 工具链**（jest 生态、@nestjs/cli→@angular-devkit→handlebars、glob CLI、braces、js-yaml），无一进入运行时 bundle（server `dependencies` 列表核对：@nestjs/*、@prisma/client、bcrypt、exceljs、qrcode、socket.io 等均无告警）。
- 处置：跟进 jest/@nestjs/cli 升级（跨版本，超出本节范围）；运行时零高危。

## A07 身份认证和会话管理失效 ✅

- 登录限流 `@Throttle(default: 20/min)`（`auth.controller.ts:18`）；连续失败锁定（`failedAttempts/lockedUntil`，第 5 节）。
- access 2h / refresh 7d 轮换 + 登出撤销（RefreshToken.revoked）。
- 审计拦截器脱敏：`audit.interceptor.ts:8` SENSITIVE_KEYS（password/token 类）→ `***`。

## A08 软件和数据完整性失效 ✅

- lockfile（package-lock.json）入库；CI `npm ci`（`ci.yml`），与仓库 npm workspaces 一致。
- 附件上传：服务端 uuid 生成落盘路径（`attachment.service.ts`），客户端文件名仅存库作下载名——路径穿越/同名冲突均不可利用（第 55 节实测）。

## A09 日志和监控不足 ✅

- 审计拦截器记录所有非 GET（用户、动作、params 摘要脱敏）。
- 异常日志含请求路径与异常名（`all-exceptions.filter.ts` `Logger('Exception')`）；不向前端泄漏堆栈/SQL（404 实测响应仅 `{code:1004,message:"工单不存在"}`）。
- AI 上游错误只记前 200 字符（`ai.service.ts`），不带 key。

## A10 SSRF ✅

- 服务端仅出站调用：AI 上游（env 配置的固定 baseUrl）与本地文件读（uuid 路径）——无用户可控 URL 拉取。

## 敏感数据专项抽查（实测）

- 登录/`/me` 响应无密码哈希（`JSON.stringify` 检索无 `$2b`）。
- 日志无 token：audit interceptor 脱敏 + 无请求头 dump。
- `AI_API_KEY` 只在服务端 env；`.env.example` 该项为空。

## 本节修复汇总

1. `PayloadTooLargeError` → 400（`all-exceptions.filter.ts`），消除超长请求 500。
2. 红队用例 6/7/8 的实测记录入 `docs/security/llm-redteam.md`。
3. `npm audit` 结论登记：62 项均在 dev 工具链，运行时零高危；升级计划记入遗留。
