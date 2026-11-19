# RBAC 验收标准（第 6 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 有权限的接口返回 200 | admin 调 `GET /api/users` | ✅ 200（矩阵测试 矩阵 05） |
| 2 | 无权限的接口返回 403 | planner 调 `POST /api/users` | ✅ 403 code 1003（用例 1、矩阵 18） |
| 3 | 菜单按角色不同 | admin 与 planner 分别登录对比 `/auth/me` 的 menus | ✅ admin 见系统管理 4 项；planner 菜单为空（截图验证） |
| 4 | 按钮按权限显隐 | `v-permission` 指令 + 动态路由；planner 访问 `/system/users` 无路由 | ✅（直接调接口仍被后端 403 兜底） |
| 5 | admin 全有 | admin permissions = 种子权限码全集（15 个） | ✅（登录响应 permissions.length = 15） |

补充：`/auth/me` 同时返回 `roles / permissions / menus`；权限码格式 `<模块>:<动作>`；5 个种子角色 admin / planner / operator / qc / maintainer。
