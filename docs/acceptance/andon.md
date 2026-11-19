# 安灯验收标准（第 50-52 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 呼叫流转 | operator 拉灯（OPEN）→ 责任角色响应（RESPONDED）→ 关闭（CLOSED，需 resolution）→ 取消仅呼叫人限 OPEN | ☐ |
| 2 | 责任角色通知 | 创建呼叫 → 责任角色（字典 andon_responder_role 映射）所有用户各一条站内信，铃铛未读数 +1 | ☐ |
| 3 | 实时推送 | andon.created/responded/closed 推到看板 `wc:<id>` 与 `all`；OPEN 时看板红色闪烁块出现，CLOSED 后消失 | ☐ |
| 4 | 重复呼叫合并 | 同工作中心同类型已有 OPEN → 合并（返回已有 id），不重复通知（第 51 节） | ☐ |
| 5 | 超时升级 | OPEN 超过 `andon_timeout_minutes`（默认 10）→ escalated=true + 通知 admin，只升级一次（第 51 节） | ☐ |
| 6 | 权限 | andon:create/respond/close/view 四码；非责任角色响应 403；admin 兜底可响应（第 51 节） | ☐ |
| 7 | 数据校验 | 呼叫时设备不属于该工作中心 400；关闭无 resolution 400；关闭后再响应/关闭 1006（第 51 节） | ☐ |
| 8 | 通知已读 | 未读数减少；标记别人的通知已读 403（第 51 节） | ☐ |

状态机（转换表唯一正本：`src/modules/andon/andon.state.ts`，对照 `docs/state-machine/andon.md`）：

| 状态 \ 动作 | respond | close | cancel |
|---|---|---|---|
| OPEN | RESPONDED | — | CANCELLED |
| RESPONDED | — | CLOSED（需 resolution） | — |
| CLOSED / CANCELLED | — | — | — |

表结构：`AndonCall`、`Notification` 两张新表（第 50 节 migrate）。
