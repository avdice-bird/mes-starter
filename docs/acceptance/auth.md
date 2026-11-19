# 认证（auth）验收标准

> 第 02 节 · JWT 登录。Given/When/Then 格式，逐条打勾后才算完成。

## 1. 正确登录

- **Given** 种子用户 admin 已存在（密码 Admin@123）
- **When** `POST /api/auth/login` 传 `{ "username": "admin", "password": "Admin@123" }`
- **Then** 返回 200、`code=0`，`data` 含 `accessToken`、`refreshToken` 和 `user`（含 id/username/name，不含 password）

## 2. 错误密码

- **Given** 种子用户 admin 已存在
- **When** `POST /api/auth/login` 传正确用户名但错误密码
- **Then** 返回 401、`code=1002`，不返回任何 token

## 3. 刷新成功

- **Given** 已通过登录拿到一对 token
- **When** `POST /api/auth/refresh` 传未过期的 `refreshToken`
- **Then** 返回 200、`code=0`，返回新的 `accessToken` 和新的 `refreshToken`，旧 refresh 失效（再次用旧 refresh 刷新返回 401）

## 4. 登出后刷新失败

- **Given** 已通过登录拿到一对 token
- **When** 先 `POST /api/auth/logout`（带 access token），再用原 `refreshToken` 调 `/api/auth/refresh`
- **Then** 登出返回 200；刷新返回 401、`code=1002`

## 5. 未登录访问 /me

- **Given** 请求不带 Authorization 头
- **When** `GET /api/auth/me`
- **Then** 返回 401、`code=1002`

## 6. 已登录访问 /me（补充）

- **Given** 已登录并持有有效 access token
- **When** `GET /api/auth/me` 带该 token
- **Then** 返回 200，`data` 为当前用户信息（不含 password）

## 7. 连续 3 次密码错误后要求滑块验证

- **Given** 某用户名连续 3 次密码错误（`failedAttempts=3`）
- **When** 第 4 次调用登录，不携带 `captchaId/captchaOffset`
- **Then** 返回 400、`code=1010`，`failedAttempts` 保持 3（滑块失败不累加密码错误次数）

## 8. 滑块验证通过

- **Given** 已通过 `POST /api/auth/captcha` 领取一次性挑战（绑定用户名、2 分钟过期）
- **When** 登录携带正确的 `captchaId` 与拖动偏移，密码正确
- **Then** 登录成功；挑战立即作废；成功登录清零 `failedAttempts/lockedUntil`
- **And** 偏移错误返回 1010 并作废挑战，不累加密码错误次数；同一挑战不可重复使用

## 9. 连续 5 次密码错误锁定 15 分钟

- **Given** 连续 5 次密码错误（第 3 次起每次携带有效滑块）
- **When** **第 5 次**密码错误发生的当次调用（不是第 6 次）
- **Then** 即返回 423、`code=1009`；`lockedUntil ≈ now + 15 分钟`；消息含剩余分钟数（`failedAttempts` 清零）
- **And** 锁定期间第 6 次及以后调用（即使密码正确）仍返回 1009；锁定到期后可以重新登录；成功登录清零计数

## 10. 不存在的用户名

- **Given** 用户名不存在
- **When** 连续错误登录
- **Then** 同样在 3 次后返回 1010、5 次后返回 1009，避免通过“是否出现滑块”枚举用户是否存在

## 11. 30 分钟无操作自动退出

- **Given** 已登录进入业务页面
- **When** 连续 30 分钟没有点击、键盘、滚轮、触摸或滚动操作
- **Then** 前端调用登出接口、清除 token，并跳转 `/login?redirect=当前页`
- **And** 期间任意操作会重置计时；同一应用的多个标签页共享最近活动时间；Web 车间看板 `/board` 作为常驻大屏不参与自动退出
