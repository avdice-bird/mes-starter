# 工单状态机边界清单 · 前端（第 31 节）

| # | 检查项 | ✓ |
|---|---|---|
| 1 | 详情抽屉顶部状态条：状态 tag（字典 label）+ 延误徽标 + 动作按钮 | ✅ |
| 2 | 按钮只显示 `allowedActions` 里的动作——**后端算，前端不复制转换表**（用例 8 核心项） | ✅ |
| 3 | cancel 弹 `ElMessageBox.prompt` 且校验必填；complete 弹窗带可选原因输入 | ✅ |
| 4 | 动作成功后：详情重取（状态/按钮/日志联动刷新）+ 列表 reload | ✅ |
| 5 | 状态变更时间线：动作名、状态迁移、操作人、时间、原因全部展示 | ✅ |
| 6 | 列表状态列颜色走约定（草稿灰/进行中蓝/完成绿/暂停黄/取消灰），label 走字典 `work_order_status`（用例 12） | ✅ |
| 7 | 状态筛选下拉数据源 = 字典（不再本地硬编码） | ✅ |
| 8 | 动作按钮按权限码控制：release/start/pause/complete/close/cancel → v-permission 由后端 allowedActions + 前端权限指令双层过滤 | ✅ |
| 9 | transition 请求 loading（`transitioning`）防双击重复提交 | ✅ |

已知限制：抽屉里按钮的显隐依赖 `allowedActions` 快照，并发下他人先操作会拿到 1007/1006——点击后刷新详情即可恢复一致（防线在后端）。
