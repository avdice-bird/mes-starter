# 第 10 节 · CRUD 模板与字典 · 报告

> 任务卡 10【建】+ 11【磨】的成果总结。详细过程记录见 `docs/log/10.md`、`docs/log/11.md`；本文面向"想直接使用模板与字典模块"的读者。

## 一、CRUD 模块生成模板（`docs/prompts/crud-module.md`）

### 是什么

一份可复用的提示词模板——输入模块的字段表，AI 按项目约定（`CLAUDE.md`）生成完整的 CRUD 模块（后端 schema→DTO→Service→Controller、前端 api→页面、权限码、菜单、测试、矩阵行）。相当于 AI 时代的代码生成器，后续十几个业务模块都从它生成。

### 版本演进

| 版本 | 触发 | 内容 |
|---|---|---|
| **v1** | 第 10 节 | 五段结构：输入（模块名/字段表/权限前缀/软删）、必须遵守（读 CLAUDE.md、分层、DTO 校验、统一响应、@Permissions、审计字段）、输出清单（10 项）、**生成顺序**（分四批，第一批 schema+DTO 确认后继续）、**禁止**（新依赖、公共文件、跳批） |
| **v2** | 第 11 节清单反哺 | 8 条新规则（标 `<!-- v2 -->`）：不可变字段清单（Update DTO 不得出现）、下拉提供方、P2002 转业务消息、删除保护、sortBy 白名单、status 语义、主从抽屉、useDict 缓存规范 |
| **v2.1** | 第 12 节审计模块 | `模块形态：完整 CRUD / 只读` 开关——只读模块省略增删改接口与表单（模板原本不支持审计日志这种"只有查询"的模块） |

### 设计要点

1. **分批生成**是模板的核心价值：第一批只出 schema 和 DTO，人确认字段与唯一约束设计后再继续——返工成本从"重写整个模块"降到"改几行 schema"。
2. **禁止段**防止 AI 的两个高频越界：引入新依赖、改公共文件（拦截器/守卫/main.ts）。
3. **自检段**让 AI 生成完自己核对：测试绿、Swagger 可见、扫描测试通过。

### 使用效果（已验证）

- 数据字典（第 10 节）：模板生成 + 手工边界修复。
- **v2 重生成验证**：临时分支撤掉全部字典代码，按 v2 重新生成，结果与原实现等价（e2e 95/95 绿）——证明规则本身可复现，不是"碰巧那次写对了"。
- 审计日志（第 12 节，只读开关）、BOM（第 16 节）、工艺路线（第 20 节）均从模板生成。

## 二、数据字典模块（`modules/dict`）

### 数据模型

- `Dict`（code @unique, name, remark）：字典分类。**code 被业务代码引用，创建后不可修改**（Update DTO 不收 code + 前端编辑 disabled 三层一致）。
- `DictItem`（dictId, label, value, sort, status）：字典项。value 在**同一字典内唯一**（`@@unique([dictId, value])`，跨字典可重复）。

### 接口

| 接口 | 权限码 | 说明 |
|---|---|---|
| GET/POST /dicts、PATCH/DELETE /dicts/:id | dict:view/create/update/delete | 管理接口 |
| GET /dicts/:id/items、POST /dicts/:id/items、PUT/DELETE /dicts/items/:itemId | dict:view / dict:update | 字典项维护；value 冲突 409"已存在相同 value"；删除有项的字典 → 409 带项数 |
| **GET /dicts/code/:code/options** | 登录即可（扫描白名单） | 下拉用：只返回启用项，按 sort 排序。业务页面不持 dict:view 也能取下拉 |

### 边界规则（第 11 节，全部固化 e2e）

1. 字典 code 不可修改（PATCH 带 code 也不生效）；
2. 删除有字典项的字典 → 409 + 提示项数；
3. 字典项 value 同字典内唯一（P2002 → 409 业务消息）；
4. 停用项不进下拉，但管理列表仍显示（历史数据可查）；
5. `useDict` 有模块级缓存，字典项保存/删除后 `invalidateDict(code)` 定向失效。

## 三、前端 useDict 组合式函数（`composables/useDict.ts`）

```ts
const { options } = useDict('work_order_status'); // 组件里取下拉
invalidateDict('work_order_status');              // 字典维护后失效缓存
```

- 模块级 `Map<string, Promise>`：同一编码全应用只请求一次；
- 失效：定向（传 code）或全清；Vitest 4 例证明"命中 / 定向失效 / 全清"行为。

## 四、测试与质量

| 防线 | 数量 | 覆盖 |
|---|---|---|
| 边界 e2e（dict.e2e-spec） | 4 例 | 上述 5 条边界中 4 条后端行为 |
| useDict Vitest | 4 例 | 缓存命中 / 定向失效 / 全清 / 请求参数 |
| 权限矩阵 | 17 行 | 8 个管理接口 × admin/planner/operator/匿名 |
| 清单 | dict-后端 / dict-前端 | 逐项打勾，N/A 写原因 |

## 五、导入示例文件（`docs/samples/`）

| 文件 | 用途 | 实测 |
|---|---|---|
| `material-import-ok.xlsx` | 20 行合法数据（IMP- 前缀） | 首次导入全部成功；**重复导入会整批拒绝**（导入不覆盖已有数据——这是设计行为） |
| `material-import-ok2.xlsx` | 20 行合法数据（IMP2- 前缀） | fresh 环境（IMP- 已入库时）使用，实测 20/20 成功 |
| `material-import-bad.xlsx` | 9 行覆盖 8 类错误 | 整批拒绝，错误报告逐行定位 |

> **导入报"全部行有错"最常见原因：同一文件导过一次**。编码已入库，再导全部撞"已存在"——换新前缀文件（或删旧数据）即可。若伴随登录等接口 500：检查是否有两个 dev server 实例并发写同一个 SQLite（`关闭.bat` 全停后再启动）。

## 六、遗留

- 字典项拖拽排序（当前数字输入）；Excel 导入字典项。
- 审计/refresh token 过期数据清理（第 58 节统一处理）。
