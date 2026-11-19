# 安灯边界清单 · 后端（第 51 节）

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 同工作中心同类型已有 OPEN | 合并到已有（返回同 id + merged=true），描述追加"再次呼叫"，不重复通知 | `AndonService.create` findFirst(OPEN) 分支；验证：拉灯两次同 id，planner 未读数仍 1 | ✅ |
| 2 | OPEN 超过 `andon_timeout_minutes`（默认 10） | escalated=true + 通知 admin 角色 + andon.escalated 事件；只升级一次 | `escalateTimeouts(now)`：escalated=false 且 calledAt<deadline 才升级，更新后查询排除 → 幂等；验证：手动调用两次，第一次 1 第二次 0，admin 收到"安灯升级 AD-…" | ✅ |
| 3 | 非责任角色响应 | 403 | `respond` 查 userRole 对比责任角色（admin 用户名兜底放行除外）；验证 operator 响应 EQUIPMENT → 403 | ✅ |
| 4 | admin 响应 | 兜底允许 | `respond` username==='admin' 跳过角色检查 | ✅ |
| 5 | 关闭无 resolution | 400 | `close` 前置校验 trim 长度 <2 → 1001 | ✅ |
| 6 | 呼叫人取消已 RESPONDED 的 | 拒绝（1006） | 转换表 RESPONDED.cancel=null → nextAndonStatus 抛 STATE_NOT_ALLOWED | ✅ |
| 7 | 非呼叫人取消 | 403 | `cancel` 先查 callerId!==caller.id → 1003；验证 admin 取 operator 的呼叫被拒 | ✅ |
| 8 | 通知已读 | 未读数减少；标记别人的 → 403 | `NotificationService.markRead` userId 校验；验证：标记后 unreadCount 递减 | ✅ |
| 9 | 响应人从 token 取 | 不信任请求体 | `respond(id, req.user)` 无 responderId 入参 | ✅ |
| 10 | 设备不属于该工作中心 | 400 | `create` 校验 eq.workCenterId!==dto.workCenterId → 1001；验证 EQ-SMT-01(87) 挂到 85 被拒 | ✅ |
| 11 | 关闭后再响应/关闭 | 1006 | 转换表 CLOSED 全 null → STATE_NOT_ALLOWED；验证两条路径均 1006 | ✅ |
| 12 | 通知列表分页、按已读筛选 | 正常 | `NotificationService.list` page/pageSize/read（read/unread） | ✅ |
| 13 | 定时扫描任务 | 每分钟；重启不重复升级 | require('cron') 每分钟（同设备日报模式，test 环境跳过）；escalateTimeouts 幂等保证重复调度不重复通知。**注意：`@nestjs/schedule` ESM 不兼容才用 cron 包；dev 环境曾因两个 nest --watch 实例并存误判任务未跑，清进程重启后确认** | ✅ |

单测（第 52 节）：转换表遍历、合并逻辑、escalateTimeouts 传 now 不 sleep——`andon.service.spec.ts` + `andon.e2e-spec.ts`。
