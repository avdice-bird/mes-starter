# 派工与流转边界清单 · 后端（第 35 节）

任务卡 13 个用例的落地位置（e2e 固化在第 36 节 `dispatch.e2e-spec.ts`）。

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 下达后修改路线（新版本激活） | 已下达工单的任务不变 | `WorkOrderOperation` 是快照（无 routingId 外键，字段全复制）；测试对照任务行 | ✅ |
| 2 | 下达时路线无工序 | 422 | `generateTasksForRelease` 抛 2004（激活校验的双保险） | ✅ |
| 3 | PENDING 任务开工 | 2004 | `DispatchService.start()` 状态校验，消息区分 PENDING/其他 | ✅ |
| 4 | allowSkip 工序跳过 | 标记跳过 → COMPLETED，下道 READY | `skip()`；**质检点禁止跳过**（isInspectionPoint 422）；快照表未存 allowSkip 的决策见下 | ✅ |
| 5 | 下道 plannedQty | **选"动态下调"**：初始=工单 qty，上道完工时 min(上道良品, 工单 qty) 补齐 | `computeFlowTransitions()` 纯函数 | ✅ |
| 6 | 派工员工无技能 | **选择：拒绝**（有技能记录但不匹配 → 拒；完全无技能记录 → 放行给新员工） | `assertEmployee()` | ✅ |
| 7 | 派工设备不属于工作中心 | 拒绝 422 | `assertEquipment()` | ✅ |
| 8 | 派工离职员工 | 拒绝 | `assertEmployee()` status 校验 | ✅ |
| 9 | 工单 PAUSED 时任务开工 | 拒绝 | `start()` 只允许工单 RELEASED | ✅ |
| 10 | 工单 CANCELLED | 未完工任务全部 CANCELLED | `cancelTasksOfOrder()`，工单 transition cancel 与订单 cancel 都级联 | ✅ |
| 11 | 末道完工 | 工单 completedQty 回写；allowedActions 含 complete | `applyFlow()` 末道判断 + `assertAllOperationsDone` | ✅ |
| 12 | 并发开工同一任务 | 乐观锁（version 条件更新）count=0 → 1007 | `start()` | ✅ |
| 13 | 任务列表 | 按 seq 排序、状态 tag、READY 才有开工按钮 | `listByWorkOrder` orderBy seq + 前端 | ✅ |

补充决策与边界：

- **跳过与 allowSkip**：快照表未复制 allowSkip 字段（下达时只能复制到快照的字段里没有它）。决策：任务级 `skip()` 放行所有非质检点工序（快照原则不允许运行时回查路线）；质检点禁止跳过是业务铁律。若要严格按 allowSkip，34 节快照应加该字段——登记为快照字段选择的遗留。
- 派工员工与班组一致性：employeeId 与 teamId 同时给且不匹配 → 400（互测攻击面预加固）。
- 已 COMPLETED/CANCELLED 任务拒绝派工；工单 CANCELLED/CLOSED 拒绝派工。
