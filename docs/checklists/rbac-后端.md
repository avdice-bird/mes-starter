# RBAC · 后端清单（第 7 节磨）

复制自 `清单/后端细节清单.md`，只保留 RBAC 相关并逐项核实。N/A 项写明原因。

## 输入校验
- [x] 每个 DTO 字段都有校验装饰器（user/role/menu DTO：必填、长度、正则、枚举、范围）
- [x] 分页参数有默认值和上限（service 再兜底 page≥1、pageSize≤200）
- [x] 传入不存在的 id → 404（user/role/menu 都先 findUnique 再操作）
- [x] 不信任前端传的操作人，一律从 token 取（req.user.id）
- [x] 数量类字段 N/A（RBAC 无数量）

## 数据一致性
- [x] 唯一字段 `@unique`（User.username、Role.code、Permission.code、Menu.path），冲突返回 409
- [x] 删除：有关联数据禁止删除（角色有关联用户拒删并提示数量；菜单有子节点拒删）
- [x] 多表写入在 `prisma.$transaction`（删除用户三表、分配角色、分配权限）
- [x] 数量字段 N/A
- [x] 时间 UTC 存储
- [x] 并发修改乐观锁 N/A（角色/用户无状态机与数量竞争）

## 权限与安全（重点）
- [x] 每个 Controller 方法都有 `@Permissions` 或显式 `@Public()`——有扫描测试兜底（test/permissions-scan）
- [x] 响应里没有密码哈希、refresh token（UserRow 剔除 password；token 只在登录/刷新响应）
- [x] 文件上传 N/A
- [x] 查询参数不拼接原生 SQL（Prisma 参数化；分表删除用白名单表名）
- [x] 不能删除/停用自己；不能修改自己的角色（防自我提权）
- [x] 内置角色（isBuiltin）不能删、不能改名、不能改权限
- [x] 菜单 parentId 循环拒绝（错误码 2005，新增登记）

## 审计与日志
- [x] createdBy / updatedBy / createdAt / updatedAt（主实体；关联表带 createdAt）
- [x] 关键业务操作审计日志 N/A（审计日志模块在第 12 节，先记录为遗留）

## 接口设计
- [x] Swagger 每个接口有 summary，DTO 字段有 @ApiProperty 描述
- [x] 列表分页参数统一；角色/权限/菜单为全量接口（字典性质）
- [x] 响应结构统一 `{ code, message, data }`
- [x] REST 路径：`PUT /users/:id/roles`、`PUT /roles/:id/permissions`
