# 报工边界清单 · 后端（第 38 节）

| # | 用例 | 决策/期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 同 idempotencyKey 提交两次 | 第二次返回第一次的记录 id（200），不重复累计；事务内兜底再查 + unique 约束双保险 | `create()` 快速路径 + 事务内 dup 检查 + P2002 捕获 | ✅ |
| 2 | 10 并发各 10 件（不同 key） | completedQty=100，流水 10 条 | 原子累加 `{ increment }`，非读改写 | ✅ |
| 3 | 累计超 plannedQty | **选：拒绝（2002）**，超产容差 0%（`OVERPRODUCTION_RATE_PCT` 常量，将来挪字典 `overproduction_rate`） | 数量校验分支 | ✅ |
| 4 | goodQty + defectQty = 0 | 400 | `create()` 入口 | ✅ |
| 5 | 负数 / 小数 | 400（DTO `@Min(0)` / `@IsInt`；负数同时被 Min 拦） | DTO | ✅ |
| 6 | workMinutes = 0 | **选：允许**（有些工序没记录工时，硬卡会逼人乱填）；上限 1440 | DTO `@Min(0) @Max(1440)` | ✅ |
| 7 | 任务 PENDING / COMPLETED | 2004 | `create()` 状态校验 | ✅ |
| 8 | 工单 PAUSED | 409（1006） | `create()` 工单状态校验 | ✅ |
| 9 | reportedAt 未来 | 400（容差 60 秒时钟偏移） | `create()` | ✅ |
| 10 | reportedAt 早于下达 | 400（取 release log 的 createdAt） | `create()` | ✅ |
| 11 | 员工不在派工班组 | **选：拒绝（400）**；任务未派班组时不校验 | `create()` 班组一致性 | ✅ |
| 12 | 撤销报工 | 负数流水（reversedById 双向索引）+ 原子回退 + COMPLETED→IN_PROGRESS + 下道 READY→PENDING + 工单 completedQty 回退；**下道已开工 → 409** | `reverse()` | ✅ |
| 13 | 撤销已撤销的 | 409 | `reverse()` reversedById 检查 | ✅ |
| 14 | 报工超上道良品 | 2002（第 35 节不变量在报工时的硬校验） | `create()` prevGoodQty | ✅ |
| 15 | 前端重复点提交 | 按钮 loading + 打开表单生成新 key + 失败同 key 重试成功换 key | WorkReportPage.vue | ✅ |

补充（自加固）：

- employeeId 不存在 → 404（原 FK 约束 500）；离职员工 → 400（互测攻击项 4 的正面加固）
- 超大批量（2^31）→ 400（DTO @Max 1e7）
