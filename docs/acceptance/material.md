# 物料（material）验收标准

> 第 13 节 · 物料主数据与导入导出；第 14 节导入边界；第 15 节测试。Given/When/Then 格式。

## 1. 单位 / 分类 / 物料 CRUD

- **Given** admin 已登录
- **When** `POST /api/units`、`POST /api/material-categories`、`POST /api/materials` 传合法数据
- **Then** 返回 201、`code=0`；`GET /api/materials` 分页列表可见，含分类/单位名称

## 2. 分类树

- **Given** 存在根分类 A 与子分类 A1（parentId=A）
- **When** `GET /api/material-categories`
- **Then** 返回树形结构，A1 嵌套在 A 的 children 内；删除有子分类或物料的分类返回 409

## 3. 编码唯一

- **Given** 物料 M-001 已存在
- **When** 再创建编码 M-001 的物料（或导入含 M-001 的文件）
- **Then** 返回 409（创建）/ 整批拒绝并报错行（导入），提示"已存在"

## 4. 编码创建后不可修改

- **Given** 物料 M-001 已存在
- **When** `PATCH /api/materials/:id` 传 `code: 'M-HACKED'`
- **Then** 返回 200 但 code 仍为 M-001（Update DTO 不收 code；前端编辑弹窗 code 输入框 disabled）

## 5. 导入成功（Excel 正常文件）

- **Given** 已创建分类 CAP 与单位 PCS，已下载导入模板
- **When** `POST /api/materials/import` 上传 200 条合法数据的 xlsx（multipart，字段名 file）
- **Then** 返回 `successCount=200, errorCount=0`，列表可查到全部 200 条

## 6. 导入含错误行（整批拒绝策略）

- **Given** 文件内有编码重复 / 单位不存在 / 非法类型 / 必填列缺失的行
- **When** 导入该文件
- **Then** 库中 0 条新增（整批拒绝）；响应 errors 数组逐行给出 `rowNumber` 与原因；错误报告可下载（Excel，含"错误原因"列）

## 7. 导入边界（对应第 14 节 12 种错法）

| # | 错法 | 期望 | 测试 |
|---|---|---|---|
| 1 | 文件内两行编码相同 | 报错指出两行行号 | e2e + 单测 |
| 2 | 编码与库中重复 | 报错整批不写入（**选定策略：不更新**） | e2e + 单测 |
| 3 | 中间空行 | 跳过不报错 | e2e |
| 4 | 必填列缺失（无名称） | 报错行号+列名 | e2e |
| 5 | 单位编码不存在 | 报错含单位编码 | e2e + 单测 |
| 6 | 分类不存在 | 报错含分类编码 | 单测 |
| 7 | 类型"原材料" | 报错提示可选值 原料/半成品/成品 | e2e + 单测 |
| 8 | 5000 行 | 上限 5000 行，超出 400；导入超时放宽到 120s（前端） | 接口上限保护 |
| 9 | 不是 xlsx（改名 txt） | 400 友好提示（zip 魔数校验） | e2e |
| 10 | 表头打乱/多列 | 按表头名识别 | e2e |
| 11 | 前后空格/全角 | trim；全角报错 | e2e |
| 12 | 错误报告下载 | 前端生成 Excel（错误行+原因列，红色标记） | 手工验收 |

## 8. 导出

- **Given** 库中 2 条物料，带关键字筛选
- **When** `GET /api/materials/export?keyword=...`（或前端"导出"按钮）
- **Then** 返回 xlsx，解析后行数=筛选结果数，列头与模板一致

## 9. 引用保护

- **Given** 单位 PCS 被物料引用 / 分类 CAP 有物料 / 分类有子分类
- **When** 删除该单位或分类
- **Then** 409，提示具体数量

## 10. 权限

- **Given** planner（有 material:*、unit:view、category:*）与 operator（无）
- **When** 分别访问物料/单位/分类接口
- **Then** planner 通过（200/201），operator/qc/maintainer 403，未登录 401（permissions-matrix 34 行覆盖）
