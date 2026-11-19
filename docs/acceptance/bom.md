# BOM 验收标准（第 16 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 创建 BOM 版本 | `POST /api/boms`（同物料同版本重复 → 409） | 待测 |
| 2 | 维护明细（批量保存） | `PUT /api/boms/:id/items` 批量写入，用量/损耗率校验 | 待测 |
| 3 | 激活版本 | `POST /api/boms/:id/activate`；激活 v2 时旧 ACTIVE 自动置 OBSOLETE（同父物料同一时刻只有一个 ACTIVE） | 待测 |
| 4 | 树形展开三级 | `GET /api/boms/:id/tree`：成品 → 半成品 → 原料，嵌套结构与数量正确 | 待测 |
| 5 | 同一父物料不能有两个 ACTIVE | 激活第二个时第一个自动 OBSOLETE（二选一策略见 ADR-002/日志 17） | 待测 |

补充约定：权限码 `bom:view/create/update/delete/activate`；损耗率口径 = **用量 × (1 + 损耗率%)**（第 17 节日志确认）；明细在 ACTIVE 版本上不可修改（409，须新建版本）。
