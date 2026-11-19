# 设备状态边界清单 · 后端（第 47 节）

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 停机 22:00–次日 02:00 | 两天日报各 120 分钟（不是 240 全给结束那天） | `splitByDay` 纯函数（工厂时区 +480min 切分）+ e2e 补录跨天 | ✅ |
| 2 | 生成日报时停机未结束 | 算到当天 24:00，标记 open | `generateDailyReport`（d.endedAt 为 null → segEnd=dayEndUtc，open=true） | ✅ |
| 3 | 同一天生成两次 | 第二次 upsert，数据不翻倍 | `@@unique([equipmentId, date])` + upsert | ✅ |
| 4 | 定时任务重启 | **选择：不补跑**（任务体只在 00:05 触发生成昨天；重启错过就用手动接口补）——upsert 幂等保证即使补跑也不重复 | cron 注册 + upsert | ✅ |
| 5 | 切换到当前状态 | 409 不生成 log | `changeStatus` eq.status === dto.status | ✅ |
| 6 | 补录 endedAt < startedAt | 400 | `createDowntime` | ✅ |
| 7 | 补录与已有停机重叠 | 409（开放停机视为延伸到无限） | 重叠检测 startedAt < probeEnd AND (endedAt null OR endedAt > startedAt) | ✅ |
| 8 | FAULT 设备派工 | 400（联动第 35 节） | `DispatchService.assertEquipment` | ✅ |
| 9 | reasonCode 必填 | 400 | `createDowntime` | ✅ |
| 10 | 时区 | 日报的"天"按工厂时区（固定偏移 +480 分钟，复用第 24 节口径） | `factoryDateOf` / `splitByDay` | ✅ |
| 11 | `/inventory/audit` 同款守恒 | —（不适用库存，日报幂等即守恒） | — | — |

单测（equipment-time.spec.ts，8 例）：跨天各 120、单日 90、跨 UTC 日但同工厂日、整 24 小时恰一个工厂日、30 小时 1440+360、零/负时长空数组、工厂日切分点（UTC 16:00 = 北京次日 00:00）。

**手算复核又立功一次**：AI 写的"整 24 小时 → 两条各 1440"期望值是错的——北京 01-11 00:00–01-12 00:00 恰好完整落在一个工厂日，正确期望是单条 1440。复算后修正，并补了跨两工厂日的 30 小时用例。
