# dict 模块 · 后端细节清单

> 从 `清单/后端细节清单.md` 复制，第 11 节逐项核对。每条不通过项都反哺为模板规则（见 `docs/prompts/crud-module.md` v2 标记）。

## 输入校验
- [x] DTO 每个字段有校验装饰器：code（正则 2-32 位小写开头）、name（1-32）、remark（0-200）、label/value/sort/status 全有
- [x] 分页参数默认值与上限：继承 `PageQueryDto`（page ≥ 1、pageSize ≤ 200），service 再兜底
- [x] 不存在的 id → 404：dict 详情/删除、字典项更新/删除均先查再操作，404 + 中文消息
- [x] 不信任前端 userId：审计字段 createdBy/updatedBy 取 `req.user.username`
- [x] 数量类字段拒绝负数/超限：sort `@Min(0) @Max(9999)`

## 数据一致性
- [x] 唯一字段 `@unique`：Dict.code 全局唯一；DictItem 用 `@@unique([dictId, value])` 复合唯一（value 只在同一字典内唯一，**跨字典可重复**——这是业务要求，不是疏漏）；冲突 409 + "已存在相同 value"（Service 捕获 P2002 转友好消息，比过滤器默认消息更明确）
- [x] 有关联数据禁止删除：删除有字典项的字典 → 409 + 提示项数（用例 2，e2e 覆盖）
- [x] 多表写入事务：本模块单表写，N/A（列表接口的 findMany+count 用了 $transaction 保证一致性）
- [x] 时间 UTC（Prisma 默认）
- [x] 并发修改乐观锁：N/A + 原因——字典是低频管理数据，无并发冲突面；等业务单据模块再引入 version

## 错误处理
- [x] `BusinessException` 全覆盖：404（不存在）、409（value 冲突、有项禁删），无裸 throw
- [x] 错误码符合 CLAUDE.md 错误码表，无新码（复用 1004/1005）
- [x] 不泄漏堆栈/SQL（全局过滤器兜底）
- [x] 未捕获异常有日志（全局 filter）

## 权限与安全
- [x] 每个接口 `@Permissions` 或登记白名单：8 个管理接口全部 dict:view/create/update/delete；`optionsByCode`（下拉、登录即可、只读）在扫描测试白名单登记并注明理由
- [x] 响应无敏感字段（字典数据本身无敏感面）
- [x] 文件上传 N/A；SQL 全走 Prisma
- [x] sortBy 白名单（id/code/name/createdAt），防任意字段排序

## 审计与日志
- [x] 四个审计字段齐全，createdBy/updatedBy 取真实操作人

## 接口设计
- [x] Swagger summary + DTO @ApiProperty 全覆盖
- [x] 列表分页 `{ list, total, page, pageSize }`
- [x] 响应统一结构（全局拦截器）
- [x] REST 路径：`GET/POST /dicts`、`PATCH/DELETE /dicts/:id`、`GET/POST /dicts/:id/items`、`PUT/DELETE /dicts/items/:itemId`；下拉按编码 `GET /dicts/code/:code/options`
- <!-- v2 --> 字典 code 不可修改：UpdateDictDto **不收 code 字段**（DTO 层即拒绝，Service 不写 code），前端编辑弹窗 code 输入框 disabled——三层一致，防止"传了也不生效"的隐式行为让调用方误以为成功改名
