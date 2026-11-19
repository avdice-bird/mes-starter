# 库存守恒边界清单 · 后端（第 42 节）

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 领料量 > 余额 | 2001，**整单回滚**（事务内逐行扣，R1 扣了也随 R2 不足还原） | `deductFifo` 不足抛 2001，事务回滚 | ✅ |
| 2 | 两个工单并发领同一批次 | 余额不为负；一方成功一方 2001 | version 条件更新 + FIFO 顺序扣减 + 排队 | ✅ |
| 3 | 余额扣到 0 | 允许；负库存双保险（应用层校验 + ADJUST 拒绝负结果） | `deductFifo` / `adjust` | ✅ |
| 4 | 领料量 > 需求量 | **选择：拒绝**（需求量由 BOM 展开计算，接口无手工改量入口，结构性杜绝） | `generateIssue` | ✅ |
| 5 | 部分领料 | issuedQty 累加；重复执行 ISSUED 单 → 409 | `issue()` | ✅ |
| 6 | 退料 | RETURN 流水、余额回增、issuedQty 减少 | `POST /inventory/returns` | ✅ |
| 7 | 调用 PUT/DELETE 流水 | 404（接口不存在） | Controller 无路由 | ✅ |
| 8 | 直接改余额 | 无此接口；调整走 `POST /inventory/adjust` + ADJUST 流水 + reason + `inventory:adjust` 权限 | `adjust()` | ✅ |
| 9 | 入库 > completedQty − 已入库 | 2002 | `receipt()` | ✅ |
| 10 | 同一工单分两次入库 | **选择：每次入库生成新批次**（每次完工入库是独立产出事件，追溯链更清晰；同批累加会模糊产出时间） | `receipt()` createProductionLot | ✅ |
| 11 | 入库工单未 IN_PROGRESS/COMPLETED | 拒绝 409 | `receipt()` 状态校验 | ✅ |
| 12 | 批次号规则 | `<物料码>-<yyyyMMdd>-<序号>`，事务内重查 + 序号自增，并发不重复 | `createProductionLot` | ✅ |
| 13 | 批次拆分（分仓） | 余额两行、流水两条、Lot 不变 | ADJUST 建第二仓余额行 | ✅ |
| 14 | 领料批次选择 | 默认 FIFO（producedAt 升序） | `deductFifo` 排序 | ✅ |
| 15 | `/inventory/audit` | 所有用例做完后仍平（每例末尾断言） | `audit()` 逐（仓,料,批）比对 | ✅ |

关键发现（第 41→42 节）：测试夹具直接改库/建余额而不写流水会被 audit 正确检测为不平——**audit 先行**让夹具错误无所遁形，这正是任务卡"测试之上的测试"的价值。
