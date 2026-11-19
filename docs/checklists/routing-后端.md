# routing / work-center / equipment 模块 · 后端细节清单

> 第 21 节逐项核对。N/A 写原因。

## 输入校验
- [x] DTO 字段校验齐全：WC（code/name/type/dailyCapacity 0–100 万）、Equipment（workCenterId 必填）、RoutingOperation（**standardMinutes ≥ 1**——用例 10 的 0/负数在 DTO 层即 400）
- [x] 分页默认/上限继承 PageQuery 风格
- [x] 不存在的 id → 404（三个模块都先查后操作）
- [x] 不信任前端操作人：createdBy/updatedBy 取 req.user.username

## 数据一致性
- [x] 唯一约束：WorkCenter.code、Equipment.code、Routing @@unique([materialId, version])、**RoutingOperation @@unique([routingId, seq])**（用例 1 的 409 由此保证 + Service 显式检查给友好消息）
- [x] 有关联数据禁止删除：WC 有设备/被工序引用 → 409 带数量；Routing ACTIVE → 409
- [x] 多表写入事务：激活（旧 ACTIVE→OBSOLETE + 本版本→ACTIVE 同事务）；复制路线（建头 + 批量建工序同事务）；工序批量保存（删+建同事务）
- [x] 数量 Int 最小单位（standardMinutes 分钟）；时间 UTC
- [x] 重排的两阶段写（负数暂存 → 最终 10/20/30）防 seq 唯一冲突

## 错误处理
- [x] 全部 BusinessException；P2002 → 409 友好消息
- [x] 不泄漏堆栈（全局 filter）

## 权限与安全
- [x] 每接口 @Permissions 或白名单（扫描测试覆盖，本次新增 13 码全入种子）
- [x] sortBy 白名单（id/createdAt/version）
- [x] 操作人 username 进审计

## 审计与日志
- [x] 审计字段齐全
- [x] 设备转移工作中心 → AuditInterceptor 自动记录 PATCH（用例 8 实测有记录）

## 接口设计
- [x] Swagger summary + DTO 描述
- [x] REST：PUT /routings/:id/operations、POST /routings/:id/activate、POST /routings/:id/copy、PUT /routings/:id/reorder、GET /materials/:id/active-routing
- [x] 响应统一结构
