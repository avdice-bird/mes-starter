# 设备状态验收标准（第 46-47 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 状态切换留痕 | `POST /equipment/:id/status` → EquipmentStatusLog（from/to/operator/reason） | ✅ |
| 2 | 停机自动开关 | 切 FAULT/MAINTENANCE 自动开 Downtime；切回 RUNNING/IDLE 自动关并计算时长 | ✅ |
| 3 | 日报定时任务 | 每天 00:05 生成前一天日报（`@nestjs/schedule` cron；test 环境跳过注册，手动接口覆盖） | ✅ |
| 4 | 日报幂等 | `@@unique([equipmentId, date])` + upsert：跑两次数据不翻倍 | ✅ |
| 5 | 跨天停机分摊 | 22:00–次日 02:00 → 两天日报各 120 分钟（`splitByDay` 纯函数，工厂时区切分） | ✅ |
| 6 | 未结束停机 | 生成日报时算到当天 24:00，标记 open | ✅ |
| 7 | 重复状态切换 | 409（不生成 log） | ✅ |
| 8 | 补录校验 | endedAt ≤ startedAt → 400；与已有停机重叠 → 409 | ✅ |
| 9 | FAULT 派工拒绝 | FAULT 设备派工 → 400（联动第 35 节） | ✅ |
| 10 | 时区 | 日报的"天"按工厂时区（固定偏移 +480 分钟，与第 24 节同口径） | ✅ |
| 11 | 权限 | `equipment:change-status`、`downtime:view/update`；状态日志 `equipment:view` | ✅ |

实现说明：

- **"生成某天日报"抽成可手动调用的方法**（`EquipmentStatusService.generateDailyReport(date)`），定时任务（00:05 cron）只是调它——测试用手动接口覆盖。
- `@nestjs/schedule` 是 ESM 包、Jest CJS 转换不兼容：Cron 注册改为 task 的 `onApplicationBootstrap` 里 `require('cron')` 直接建 job，**test 环境跳过**（日报生成幂等，测试走手动接口）。
- 停机原因字典：`downtime_reason`（故障/换型/保养/待料/无订单/其他），种子提供。
- 模拟接口：手动"生成日报"按钮 + 补录停机表单即为开发模拟入口（随机状态切换对验收无增益，未加）。
