# 排产与拆分边界清单 · 后端（第 27 节）

任务卡 13 个用例的落地位置。全部固化进 `test/schedule.e2e-spec.ts`（第 28 节提交）。

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 拆分数量之和 ≠ 订单数量 | 400，提示差额 | `production-order.service.ts split()` sum 校验 | ✅ |
| 2 | 拆分某项 qty=0 或负数 | 400 | DTO `@Min(1)`（`SplitItemDto.qty`） | ✅ |
| 3 | 已拆分的订单再次拆分 | **选择：拒绝**（只允许 DRAFT 拆分，PLANNED 再拆 409）。理由：重拆意味着先作废旧工单，属于"重排计划"而非"拆分"，第 30 节状态机给工单取消/重排通道后再放开 | `split()` status 校验 | ✅ |
| 4 | 订单数量修改（已有工单） | **选择：拒绝**（409，提示先取消工单）。理由：直接改数量必然破坏守恒，让用户走"取消→重建→重拆"的显式路径 | `update()` qty 分支 | ✅ |
| 5 | 产线当天产能已占满 | 顺延到下一天 | `firstFreeRun` 空闲判定（占用>0 即不可用）；已开工占用由 `buildExistingLoad` 注入 | ✅ |
| 6 | 日产能为 0 的产线 | 跳过并提示 | 算法 `eligible` 过滤；指定产能 0 产线的工单 skipped，reason 随排产结果返回 | ✅ |
| 7 | 工单 qty > 单日产能 | 跨多天，plannedEnd 正确 | `days = ceil(qty / dailyCapacity)` | ✅ |
| 8 | plannedEnd > dueDate | isDelayed=true；列表红色标记；run 返回汇总 delayed 数 | 算法 isDelayed + 前端 el-tag danger + `ScheduleRunResult.delayed` | ✅ |
| 9 | 重排不动已开工工单 | 只重排 CREATED；RELEASED/IN_PROGRESS 产能被扣除 | `run()` where status=CREATED + existingLoad | ✅ |
| 10 | 指定 workCenterId 的工单 | 只排该产线；未指定的排最早空闲 | 算法 candidates 分支 | ✅ |
| 11 | 订单取消 | CREATED 工单级联 CANCELLED；有 RELEASED/IN_PROGRESS/COMPLETED 工单时 409 | `cancel()` | ✅ |
| 12 | 同优先级同交期 | 按创建时间稳定排序（同毫秒 id 兜底），结果可复现 | 算法排序链 + `seq` 兜底 | ✅ |
| 13 | 不考虑周末 | 明确不考虑，登记 ADR-003 扩展点 | `docs/adr/003-排产按自然日不考虑周末.md` | ✅ |

补充边界（自加）：

- 拆分项指定的工作中心不存在 → 404（`assertWorkCenter`）
- 取消已完成订单 → 409；重复取消 → 409
- 删除有工单的订单 → 409（提示走取消）
- 排产 `to < from` → 400；窗口缺省 90 天
