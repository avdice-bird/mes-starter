# 库存与批次验收标准（第 41-43 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 领料扣减 | 生成领料单（BOM 展开 × 工单数量，含损耗）→ 执行领料 → 余额减少、ISSUE 流水 +N 条 | ✅ |
| 2 | 库存不足拒绝 | 领料量 > 余额 → 2001，**整单回滚**（事务内逐行扣，任一行不足全部还原） | ✅ |
| 3 | 入库生成批次 | `POST /inventory/receipts/:workOrderId` → 成品仓新 Lot + 余额 + RECEIPT 流水 | ✅ |
| 4 | 流水不可改 | `InventoryTransaction` 只有 create；**没有 update/delete 接口**（检查项） | ✅ |
| 5 | 余额 = 流水和 | `GET /inventory/audit`：逐（仓,料,批）比对余额与流水和，不平列出清单 | ✅ |
| 6 | 批次号规则 | `<物料编码>-<yyyyMMdd>-<序号>`，同日序号自增，事务内重查保证并发不重复 | ✅ |
| 7 | FIFO 领料 | 默认按批次 producedAt 升序扣减（先进先出） | ✅ |
| 8 | 入库量校验 | qty ≤ 工单 completedQty − 已入库，超出 2002；工单未 IN_PROGRESS/COMPLETED 拒绝 | ✅ |
| 9 | 权限 | `inventory:view`、`material-issue:create/issue`、`receipt:create`、`inventory:adjust` | ✅ |
| 10 | 批次追溯 | `GET /lots/:lotNo/trace-back`（反向）/ `trace-forward`（正向），一次查流水内存建图（ADR-002 策略） | ✅ |

口径说明：

- **期初**：种子给原料仓每种原料一个批次（lotNo `<物料编码>-INIT`）10000 + INIT 流水。
- **余额 = 流水和**是铁律：任何余额变动都必须有对应流水；调整走 ADJUST 流水（需 `inventory:adjust` + reason）。
- **领料单**：DRAFT 可重复生成前复用；ISSUED 后不可再执行；issuedQty 累加支持多次部分领料。
