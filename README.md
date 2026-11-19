# MES 制造执行系统（mes-starter）

《企业级Web项目开发（AI驱动MES版）》课程项目。以一家小型电子装配厂（SMT → 插件 → 组装 → 包装）为背景，用 AI 从零交付一套可运行的 MES：Web 管理端 + 移动端 H5，后端 NestJS + Prisma + SQLite。覆盖认证与 RBAC、主数据、BOM 展开、工艺路线、排产、工单状态机、派工报工、库存批次、质检与报表，共 29 个业务模块、45 张数据模型，配套 25 组集成测试、18 个单元测试文件与 M1–M4 验收脚本。

## 技术栈

- `apps/server`：NestJS 10 + Prisma 5 + SQLite，端口 3000，前缀 `/api`，Swagger 在 `/api/docs`
- `apps/web`：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router，端口 5173，`/api` 代理到 3000
- `apps/h5`：移动端 H5，Vue 3 + Vite + TypeScript + Vant 3 + Pinia + Vue Router，端口 5174，`/api` 代理到 3000
- `packages/shared`：前后端共享的错误码、类型

## 启动

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run prisma -- migrate deploy   # 应用已提交的 migrations，生成 dev.db
npm run seed                       # 幂等种子：RBAC、主数据、演示数据
npm run dev                        # 同时启动 server、web 与 h5
```

打开 http://localhost:5173 进入 Web 管理端，http://localhost:5174 进入移动端 H5，http://localhost:3000/api/docs 查看 Swagger。

## 目录

```
apps/server/src/common/      配置、装饰器、DTO、异常、过滤器、守卫、拦截器
apps/server/src/modules/     29 个业务模块，每个模块一个目录
apps/server/prisma/          schema.prisma、migrations、seed.ts（RBAC/主数据/演示数据分层）
apps/server/test/            25 组集成测试（独立 SQLite 测试库）
apps/web/src/api/http.ts     axios 实例：统一拆包 { code, message, data }、错误提示
apps/web/src/components/     ProTable（搜索栏 + 表格 + 分页）
apps/web/src/layout/         后台布局（侧栏 + 顶栏 + 内容区）
apps/h5/src/                 移动端 H5（Vant 3）：工作台、工单、扫码报工、安灯、通知、库存、质检
docs/                        log/ adr/ acceptance/ checklists/ prompts/ state-machine/ security/ issues/
scripts/verify/              里程碑验收脚本 m1–m4
CLAUDE.md                    AI 与人共同遵守的约定
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 同时启动 server、web 与 h5 |
| `npm run dev:h5` | 只启动移动端 H5（端口 5174） |
| `npm test` | 全部单元测试（server Jest + web/h5 Vitest） |
| `npm run test:e2e` | server 集成测试（25 组） |
| `npm run prisma -- migrate dev` | 建/更新数据库 |
| `npm run seed` | 幂等种子（RBAC + 主数据 + 演示数据） |
| `npm run verify:m1` … `m4` | 里程碑 1–4 验收（对应第 12 / 22 / 43 / 54 节） |
| `npm run lint` | ESLint |
