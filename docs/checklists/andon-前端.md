# 安灯清单 · 前端（第 50 节）

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 拉灯按钮 | 报工页定位工单后显示，大、红、显眼；类型+描述必填 | `WorkReportPage.vue` andon-btn + 拉灯对话框（带工单/工序上下文） | ✅ |
| 2 | 安灯列表 | 状态筛选、分页；响应/关闭/取消按钮按状态机与权限显隐 | `AndonList.vue`（canRespond/canClose 按权限码） | ✅ |
| 3 | 铃铛未读数 | 30s 轮询 unread-count；面板点一条标一条，未读高亮 | `AdminLayout.vue`（notification:view 权限才显示） | ✅ |
| 4 | 看板红块 | 有 OPEN 呼叫时红色闪烁块（升级的标"已升级"），全部关闭后消失 | `Board.vue` andon-block + andon.* 事件触发 scheduleReload | ✅ |
| 5 | 合并反馈 | 合并呼叫时提示"已合并到未关闭呼叫 AD-xxx（不重复通知）" | 拉灯对话框/列表页 createAndonCall 返回 merged 分支 | ✅ |
| 6 | 关闭必填 resolution | 前端空值拦截 + 后端 400 双防线 | openClose 对话框 inputPattern / submitClose 校验 | ✅ |
