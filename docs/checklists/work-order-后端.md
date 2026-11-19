# 工单状态机边界清单 · 后端（第 31 节）

任务卡 12 个用例的落地位置（全部固化进 `test/work-order.e2e-spec.ts`，第 32 节提交）。

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | CREATED 直接 start | 1006，消息含当前状态与允许动作 | `nextStatus()` 抛错文案 | ✅ |
| 2 | COMPLETED 再 complete | 1006 | 同上 | ✅ |
| 3 | 两个并发 start | 一个成功一个冲突，log 只一条 | `transition()` 事务内二次查表 + version 条件 updateMany | ✅ |
| 4 | 每次转换记 operatorId/reason | log 快照 operatorName | `WorkOrderStatusLog` 表 + `transition()` 写入 | ✅ |
| 5 | cancel 不填 reason | 400 | Controller `cancel()` 前置校验（1001） | ✅ |
| 6 | release 时物料无 ACTIVE 路线 | 422，消息明确 | `assertRouting()` → 2004 | ✅ |
| 7 | complete 完工数 < 计划数 | **选择：允许并要求 reason**（第 30 节定）；报工表第 37 节接入前完工数恒 0，等价于 complete 必填 reason | `assertComplete()` | ✅ |
| 8 | 前端按钮按状态显隐 | 接口返回 `allowedActions: string[]`，后端算 | `allowedActions()` + `GET /work-orders/:id/detail`；前端不复制转换表 | ✅ |
| 9 | 关闭后所有写接口拒绝 | CLOSED 行全 ✗；PATCH plan 状态校验 409 | 转换表 + `adjustPlan()` status 校验 | ✅ |
| 10 | 取消已下达工单 | 允许；已有报工则拒绝（预留，第 37 节生效） | 转换表放行 RELEASED/IN_PROGRESS→CANCELLED；报工校验 TODO(37) | ✅ |
| 11 | 状态变更有审计日志 | 审计拦截器自动记 POST /work-orders/:id/<action>，params 含 action（在 URL） | `AuditInterceptor`（全局） | ✅ |
| 12 | 列表状态筛选/颜色用字典 | `work_order_status` 字典种子（7 项）；前端 `useDict` 取 label，本地映射颜色 | `seedDicts()` + WorkOrderList.vue | ✅ |

补充（自加）：

- `transition()` 存在性校验前置；转换合法性在**事务内**二次查表判定（并发窗口内状态可能已变）
- 乐观锁 updateMany count=0 → 1007"已被他人修改，请刷新重试"
- `resume` 复用 `work-order:start` 权限码（同一业务动作"开工"，避免码表膨胀）
- `release` 成功路径写 `routingId`（"下达时定路线"，任务卡 26 节遗留）
