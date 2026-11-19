# shift / team / employee 模块 · 后端细节清单

> 第 24 节核对。

## 输入校验
- [x] DTO 校验齐全：Shift（HH:mm 正则、24:00 拒绝）、Team（code/name/workCenterId）、Employee（工号 2-32）、Skill（level 1-5、工序/工作中心二选一）
- [x] 分页默认与上限
- [x] 不存在的 id → 404（三模块先查后操作）
- [x] 操作人取 token

## 数据一致性
- [x] 唯一约束：Shift.code、Team.code、**Employee.code（工号）@unique**、**Employee.userId @unique**（一个用户只能关联一个员工，用例 11 库层兜底）
- [x] 有关联禁删：班组有员工 → 409 带人数（用例 9）
- [x] 多表事务：调组（更新 + EmployeeTransfer 同事务）；技能整体覆盖同事务
- [x] 历史不变原则：调组留 EmployeeTransfer 轨迹表；报工侧快照在第 37 节落表（本节预留）
- [x] 数量 Int（level/standardMinutes 风格一致）

## 错误处理
- [x] BusinessException 全覆盖；P2002 → 409"工号或关联用户已被使用"
- [x] 404 消息明确（"物料 RT_FIN 没有生效中的工艺路线"风格）

## 权限与安全
- [x] 13 个新权限码全入种子（shift/team/employee 各 4+）；扫描测试通过
- [x] 员工不等于用户：userId 可选关联且一人一户

## 审计与日志
- [x] 审计字段齐全；调组另有 EmployeeTransfer 业务轨迹表

## 时区（任务卡 24 用例 12，重点）
- [x] **factoryLocal()：UTC 毫秒 + 固定时区偏移表（Asia/Shanghai=+8）**，不用 `new Date().getHours()`（取决于服务器时区）
- [x] FACTORY_TZ 环境变量可配（.env 已有）；偏移表覆盖常见工厂时区，未列出回退 +8
- [x] getCurrentShift(at) **时间作为参数**（第 25 节检查项：可测性——测试传固定 ISO，不 mock 时钟）
- [x] 已知局限：偏移表是固定值不含夏令时；中国无夏令时所以本项目够用，多国工厂需换 dayjs.tz
