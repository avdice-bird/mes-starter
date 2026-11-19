# 报工验收标准（第 37-40 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 报工累计 | `POST /work-reports` 流水 1 条 + 任务 completedQty/defectQty 原子累加；30 良 + 再报 70 → 任务 COMPLETED、下道 READY | ✅ |
| 2 | 幂等 | 同 idempotencyKey 二次提交返回同一条记录（200），不重复累计；unique 约束兜底并发竞态 | ✅ |
| 3 | 班次快照 | 按 reportedAt 用工厂时区推算班次（对齐第 23 节区间判断），无班次为 null；记录 teamId 快照 | ✅ |
| 4 | 扫码 | `GET /work-orders/:id/qrcode` 返回 PNG（内容 `wo:<code>`）；`GET /work-orders/by-code/:code` 定位工单 + 可报任务 | ✅ |
| 5 | 报工页 | `/report?wo=code`：窄屏友好大按钮，READY/IN_PROGRESS 任务可报；提交失败同 key 重试 | ✅ |
| 6 | 超量拒绝 | 累计（含本次）≤ plannedQty × (1+超产容差 0%)，超出 2002；本道累计良品 ≤ 上道良品（第 35 节不变量） | ✅ |
| 7 | 撤销 | `POST /work-reports/:id/reverse` 生成负数流水 + 数量回退 + 状态回退（COMPLETED→IN_PROGRESS、下道 READY→PENDING）；下道已开工拒绝 | ✅ |
| 8 | 临时接口删除 | 第 34 节 `complete-qty` 已删除（测试改走报工接口） | ✅ |
| 9 | 权限 | `work-report:view/create/reverse`；扫码定位接口 `work-report:view` | ✅ |

设计口径（写实现前先定）：

- **超产策略**：不允许超产（容差 0%），常量 `OVERPRODUCTION_RATE_PCT` 收敛在一处，第 40 节后可挪字典 `overproduction_rate`。
- **0 报工**：goodQty + defectQty = 0 → 400（两者可独立为 0，如整批不良）。
- **reportedAt**：未来（>当前+1 分钟）400；早于下达时间 400（以 release log 的 createdAt 为准）。
- **员工班组一致性**：任务已派班组时，报工员工必须属于该班组（400）。
- **completedQty 回写**：末道良品数（第 35 节修复后口径）。
