# 车间看板验收标准（第 48-49 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 实时推送 | 报工/设备状态切换/工单状态变化 → 同产线看板 2 秒内更新（事件推送，不推状态） | ✅ |
| 2 | 初始化数据 | `GET /board/summary`：当日产量、良率、在制工单数、设备状态分布、最近 10 条报工 | ✅ |
| 3 | 按工作中心筛选 | 房间 `wc:<id>`；只加入 wc:1 收不到 wc:2 的事件 | ✅ |
| 4 | 连接鉴权 | 握手无 token / 过期 token → 服务端拒绝；无 `board:view` 权限 → 拒绝 | ✅ |
| 5 | 断线重连 | socket.io 自动重连，重连成功后重新拉 summary 补齐断线期间变化 | ✅ |
| 6 | 事件风暴 | 并发 50 次报工：前端 500ms 节流合并刷新，不卡 | ✅ |
| 7 | 页面隐藏恢复 | visibilitychange → 回来时拉一次 summary | ✅ |
| 8 | payload 脱敏 | 事件只带 id/编码/数量等摘要，不含报工人明细、成本等敏感字段 | ✅ |
| 9 | 权限码 | `board:view`（summary 接口 + socket 握手双防线） | ✅ |

设计要点（log/48.md 详述）：

- **推送事件，不推送状态**：业务 Service 发领域事件（BoardEventBus），Gateway 监听后广播——业务代码不依赖 WebSocket；
- `@nestjs/event-emitter` 与 `@nestjs/websockets` 均为 ESM（Jest CJS 不兼容）：事件总线用底层依赖 `eventemitter2`（CJS）直接实现，Gateway 改为纯 socket.io 服务由 `main.ts` 挂载（test 环境不加载，e2e 不受污染）；
- 前端收到事件后重新拉 summary（拉状态简单可靠，避免前端维护增量状态机）。
