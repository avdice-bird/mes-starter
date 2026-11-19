# 报表验收标准（第 53-54 节）

## 口径公式（唯一正本，实现与对账都以此为准）

**日期边界**：`from/to` 均为工厂时区（Asia/Shanghai，固定 +8，复用第 47 节 `FACTORY_TZ_OFFSET_MIN=480` 口径）的 `yyyy-MM-dd`；后端换算为 UTC 区间 `[from 00:00 +08, to+1d 00:00 +08)`。

### 1. 工单进度 `GET /reports/work-order-progress?from&to&workCenterId&status`

- 范围：工单 `createdAt` 落在 `[from, to]`（工厂时区日期）
- 计划数 = 工单 `qty`；完成数 = 该单全部工序任务的 `completedQty` 之和（允许超产时报表如实显示 >100%）
- 进度 % = min(完成数 / 计划数 × 100, 999)；延误 = `dueDate < 今天` 且状态非 COMPLETED/CLOSED/CANCELLED
- **手算期望值**（对账序列，见 `docs/reports-reconcile.md`）：工单 A 计划 100，报 60良+5不良、35良 → 完成 100，进度 **100%**

### 2. 良率 `GET /reports/yield?from&to&groupBy=material|operation|shift|team|date&workCenterId`

- 分母 = 良品 + 不良（报工流水 `WorkReport`，含撤销负数流水抵扣）；良率 = 良品 / 分母 × 100（分母 0 → null）
- 分组维度：material（工单→生产订单→物料）、operation（工序任务名）、shift（报工快照班次）、team（报工快照班组）、date（`reportedAt` 的工厂时区日期）
- 缺陷 TOP5 独立子接口 `GET /reports/yield/defect-top?from&to`：`InspectionDefect` 按 defectCode 聚合 qty
- **手算期望值**：早班（SH-EARLY）良 80 不良 5 → 良率 **84.2%**；缺陷 TOP1 数量 **5**

### 3. OEE `GET /reports/oee?from&to&equipmentId&workCenterId`

简化口径（每因子数据来源）：

- **可用率** = (计划时间 − 停机时间) / 计划时间。计划时间 = 480 分钟/天 × 区间天数（简化：3 班 × 8h）；停机时间 = `Downtime` 区间交集时长（跨天按分钟切分，复用第 47 节 splitByDay 口径）
- **表现性** = (标准工时 × 良品数) / 实际运行时间。标准工时来自报工关联工序任务的 `standardMinutes`（快照），实际运行时间 = 计划时间 − 停机时间；运行时间为 0 → null
- **良率** = 该设备报工的良品 / (良品 + 不良)；无报工 → null
- **OEE** = 可用率 × 表现性 × 良率（三者齐全才计算，否则 null）
- **手算期望值**：E1 在对账日：停机 60 分钟 → 可用率 **87.5%**（420/480）；表现性 = 5min × 95 良 / 420 = **113.1%**；良率 = 95/100 → **95%**；OEE = 0.875 × 1.131 × 0.95 = **94.0%**

## 其他验收项

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 三接口筛选：from/to/workCenterId/状态或分组 全部生效 | ☐ |
| 2 | 导出 `?export=xlsx`（exceljs，与物料导出同模式） | ☐ |
| 3 | 权限码 `report:view` / `report:export`（admin/planner 视图） | ☐ |
| 4 | SQL 全部参数化（Prisma groupBy 或 $queryRaw 占位符），禁止拼接 | ☐ |
| 5 | 索引：`WorkReport(reportedAt, workOrderId)`、`WorkReport(equipmentId, reportedAt)`、`Downtime(equipmentId, startedAt)`；1 万条报工报表 < 1s | ☐ |
| 6 | 对账：固定序列手算 vs 报表一致（`docs/reports-reconcile.md`） | ☐ |
| 7 | `verify:m4` 通过 | ☐ |
