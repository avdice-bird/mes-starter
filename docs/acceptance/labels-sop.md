# 标签打印与 SOP 验收标准（第 55 节）

## 标签

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 三种标签数据 | `GET /labels/material/:id`、`/labels/work-order/:id`、`/labels/lot/:lotNo` → 二维码内容 + 编码 + 名称 + 数量 + 日期 | ☐ |
| 2 | 打印样式 | `views/labels/Print.vue`：60×40mm 固定尺寸标签，`@media print` 隐藏页面其余元素，`window.print()` | ☐ |
| 3 | 批量打印 | 多选（物料/工单/批次勾选）→ 一页多标签排版 → 一次打印（用例：5 个批次标签） | ☐ |
| 4 | 权限码 | `label:print`（接口 + 菜单）；打印页无数据时空态而非报错 | ☐ |

二维码内容约定：`MAT:<code>`、`WO:<code>`（工单扫码即第 37 节报工页定位 `?wo=` 的 code）、`LOT:<lotNo>`。

## 附件与 SOP

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 5 | Attachment 表 | fileName/path/mimeType/size/refType/refId/uploadedBy；path 服务端生成（uuid），不信任客户端文件名 | ☐ |
| 6 | 上传 | `POST /attachments`（multipart，FileInterceptor）：限 pdf/png/jpg（mime + 扩展名双校验），≤ 10MB；越限 400 | ☐ |
| 7 | 下载 | `GET /attachments/:id/download`：流式回原文件名；不存在 404 | ☐ |
| 8 | SOP 上传 | 工序编辑页（路线工序）传附件 refType=ROUTING_OPERATION | ☐ |
| 9 | SOP 继承 | 工序任务（报工页）按 工单.routingId + 任务.operationCode 找到路线工序的附件 | ☐ |
| 10 | 报工页查看 | 任务卡旁"查看 SOP"按钮 → pdf 内嵌预览 / 图片预览 | ☐ |
| 11 | 权限码 | `attachment:upload` / `attachment:download` | ☐ |

## 遗留风险（课外磨/测清单）

- 路径穿越：客户端 fileName 含 `../`——path 由服务端 uuid 生成，fileName 仅存库用于下载命名（已防）
- 上传同名文件：uuid 落盘天然不冲突（待 e2e 补）
- 删除工序后附件：ROUTING_OPERATION 删除是物理删（路线版本化），附件变孤儿——列表按 refId 查询自然为空（待评估清理任务）
- 打印页无数据：id 不存在 → 接口 404，前端空态
