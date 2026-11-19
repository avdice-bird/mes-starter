# 工艺路线与设备验收标准（第 20 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 创建路线与工序 | `POST /api/routings` + `PUT /api/routings/:id/operations`（批量，4 道工序） | 待测 |
| 2 | 工序按 seq 排序 | 列表与 `/materials/:id/active-routing` 均按 seq 升序 | 待测 |
| 3 | 激活规则 | `POST /api/routings/:id/activate`：同物料旧 ACTIVE 自动 OBSOLETE；无工序拒绝 | 待测 |
| 4 | 工序绑定工作中心 | 工序的 workCenterId 必须存在；被工序引用的工作中心不可删 | 待测 |
| 5 | 设备归属工作中心 | `Equipment.workCenterId` 必填；有设备的工作中心不可删；设备可转移（审计记录） | 待测 |

补充：权限码 `work-center:view/create/update/delete`、`equipment:view/create/update/delete`、`routing:view/create/update/delete/activate`；路线版本化同 BOM 策略（激活让位，ADR-002 同款）。
