# 报表对账（第 54 节）

**方法**：`npm run seed` 重置种子 → `npx ts-node scripts/m4-fixture.ts` 按固定序列造数 → `GET /reports/*`（from=to=对账日）与手算比对。

固定序列（详见 `apps/server/scripts/m4-fixture.ts`，对账日 D=2026-10-10）：

- 工单 A（计划 100）：60 良 5 不良（早班 09:00，E1）→ 35 良 0 不良（中班 17:00，E1）
- 设备 E1：停机 60 分钟（D 日 22:00–23:00）
- 工单 B（计划 50）：20 良 10 不良（早班 10:00，E2）
- FQC 检验 FAIL：缺陷 10 件挂 DEF-SCRATCH

## 对账表

| 指标 | 手算 | 报表 | 一致？ |
|---|---|---|---|
| A 进度 % | 完成 = 60+35 = 95/100 → **95**（附注①） | 95 | ✅ |
| 早班良率 | (60+20) / (60+20+5+10) = 80/95 → **84.2%** | 84.2 | ✅ |
| 物料 A 良率 | 95+20=115 良 / 115+15=130 → **88.5%** | 88.5 | ✅ |
| 缺陷 TOP1 | DEF-SCRATCH **10 件** | 划伤 10 | ✅ |
| E1 可用率（计划 480 分钟） | (480−60)/480 = 420/480 → **87.5%** | 87.5 | ✅ |
| E1 良率 | 95/100 → **95%** | 95 | ✅ |
| E1 表现性 | 5min × 95 良 / 420 运行 = 475/420 → **113.1%** | 113.1 | ✅ |
| 整体 OEE（E1） | 0.875 × 1.131 × 0.95 → **94.0%** | 94.0 | ✅ |

附注①：任务卡示例表里"A 进度 95%"即按完成 95 算（60良+5不良+35良=100 计入完成数、进度按良品 95）——实现口径为**完成数 = 工单 completedQty（良品累计）**，与之一致；不良只进良率分母不进进度分子。

## 对账抓到并修掉的问题（第 53 节埋的）

1. **报工流水不落 `equipmentId`**：派工设备快照只存在 `WorkOrderOperation.equipmentId`，报工 create 不拷贝 → OEE 表现性因子永远 null。修：报工时带出任务快照（`fix(reports)` 的一部分）。
2. **当日良率混入"常白班" 134 件**：对账日跑过 M3 verify 脚本留下的报工（shiftId 指向常白班）。这不是口径 bug——报表如实反映区间内全部流水；对账时按班次行分开了（早班行恰为手算的 80/15）。教训：**对账要在干净种子+fixture 上做**，混入数据靠分组维度可识别。

## 索引（第 54 节）

三个报表 SQL 的 `EXPLAIN QUERY PLAN`（SQLite）与新增索引：

```sql
CREATE INDEX "WorkReport_reportedAt_workOrderId_idx" ON "WorkReport"("reportedAt", "workOrderId");
CREATE INDEX "WorkReport_equipmentId_reportedAt_idx" ON "WorkReport"("equipmentId", "reportedAt");
CREATE INDEX "Downtime_equipmentId_startedAt_idx" ON "Downtime"("equipmentId", "startedAt");
```

1 万条报工压测结果见 `docs/log/54.md`。
