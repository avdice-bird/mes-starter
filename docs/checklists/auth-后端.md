# auth 模块 · 后端细节清单

> 从 `清单/后端细节清单.md` 复制，第 03 节逐项核对。N/A 写明原因。

## 输入校验
- [x] 每个 DTO 字段都有校验装饰器：`LoginDto` username（trim / IsString / MinLength(1) / MaxLength(50)）、password（MinLength(1) / MaxLength(72)，与 bcrypt 输入上限一致）；`RefreshDto` refreshToken（MinLength(1) / MaxLength(128)）。长度上限是磨课补的，初版只有 MinLength
- [x] 分页参数有默认值和上限 — **N/A**：auth 无列表接口（第 6 节用户列表做）
- [x] 传入不存在的 id → 404 — **N/A**：auth 无按 id 取资源的接口；`/me` 的 userId 取自 token，用户不存在时返回 401（语义更准，不暴露 id 存在性）
- [x] 不信任前端传的 userId / 操作人：`logout`、`me` 一律取 `req.user.id`（JwtStrategy 从 token 解出）
- [x] 数量类字段拒绝负数 — **N/A**：无数量字段

## 数据一致性
- [x] 编码/名称类唯一字段有 `@unique`：`User.username`、`RefreshToken.token`；重复冲突由全局过滤器 P2002 → 409
- [x] 删除：有关联数据时禁止删除 — **N/A**：auth 无删除接口；RefreshToken 只做 revoked 软失效
- [x] 多表写入在一个 `prisma.$transaction` 内：登录"清零失败计数 + 写入新 refresh"、刷新"作废旧 refresh + 写入新 refresh"均已入事务（磨课修复，初版是两次独立写入）
- [x] 数量用 Int 或 Decimal — **N/A**：无数量字段（failedAttempts 是 Int 计数）
- [x] 时间统一 UTC 存储：Prisma DateTime 默认 UTC，锁定剩余分钟在服务端计算后下发
- [x] 并发修改有乐观锁或串行化 — **N/A + 说明**：`failedAttempts` 并发丢失一次计数可接受（最多多给一次尝试机会，不放大风险，锁定阈值兜底）；引入 version 字段的成本对认证不值得

## 错误处理
- [x] 业务异常用 `BusinessException(ErrorCode.XXX)`：登录失败 1002、限流 1008、账号锁定 1009、需要滑块 1010，无裸 `throw new Error`
- [x] 错误码与消息符合 CLAUDE.md 错误码表（1008/1009/1010 均已在共享错误码表登记：1009→423、1010→400）
- [x] 不向前端泄漏堆栈、SQL、内部路径：AllExceptionsFilter 对未知异常只回"服务器内部错误"，堆栈仅进日志
- [x] 未捕获异常有日志：filter 记 method + url + stack（部分通过：请求 id 尚未引入，用户 id 待第 12 节审计日志统一补）

## 权限与安全
- [x] Controller 方法有 `@Permissions` 或显式 `@Public()`：login / captcha / refresh 标 `@Public()`，logout / me 走全局 JwtAuthGuard
- [x] 响应里没有密码哈希、内部字段：`pickUser` 白名单只取 id/username/name（登录响应中的 refreshToken 是签发给本人的，不算泄漏）
- [x] 文件上传限制 — **N/A**：无上传接口
- [x] 查询参数不拼接原生 SQL — **N/A**：全部走 Prisma 查询构造器

## 审计与日志
- [x] 创建/修改有 createdBy / updatedBy / createdAt / updatedAt：User、RefreshToken 均带（默认 system）
- [x] 关键业务操作写审计日志 — **N/A（暂缓）**：审计日志表第 12 节建，届时回补登录成功/失败记录
- [x] 状态类对象有状态变更记录表 — **N/A**：User.status 变更接口第 6 节才有

## 接口设计
- [x] Swagger 上每个接口有 summary，每个 DTO 字段有 `@ApiProperty` 描述
- [x] 列表分页 — **N/A**：无列表接口
- [x] 响应结构统一 `{ code, message, data }`（全局拦截器包装）
- [x] 接口路径符合 REST：`POST /api/auth/login|captcha|refresh|logout`、`GET /api/auth/me`

## 登录安全（2026-11-03 新增）
- [x] 连续 3 次密码错误后要求滑块；5 次锁定 15 分钟；滑块校验失败不计入密码错误次数
- [x] 滑块挑战绑定用户名、单次有效（先校验归属再作废）、2 分钟过期；总量上限 5000 + 单用户名上限 5 并优先淘汰泛洪者，防止刷接口挤掉他人挑战
- [x] 下发给客户端的是**不透明 PNG 位图**，答案不以 SVG 坐标文本形式出现在响应里（否则脚本可直接解析求解）
- [x] 锁定检查在密码校验前，且与"不存在用户名被锁定"分支做等量哑哈希比对，避免时序枚举真实账号
- [x] 不存在的用户名同样走 3/5 阈值，避免通过“是否出现滑块”枚举账号
- [x] 新增错误码 1009 ACCOUNT_LOCKED（423）/ 1010 CAPTCHA_REQUIRED（400），已登记共享错误码表
- [x] 单元测试覆盖成功/失败/锁定/到期/防枚举；另加 `captcha.service.spec.ts` 覆盖一次性/绑定/过期/容差/答案不泄露/泛洪
