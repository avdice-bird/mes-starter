# MES 课程骨架（mes-starter）

《企业级Web项目开发（AI驱动MES版）》第 1 节发给学生的起点。前后端能联调，规范、目录、CI、测试、验收脚本框架都已配好；认证、RBAC 与全部业务模块由学生用 AI 完成。

## 技术栈

- `apps/server`：NestJS 10 + Prisma 5 + SQLite，端口 3000，前缀 `/api`，Swagger 在 `/api/docs`
- `apps/web`：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router，端口 5173，`/api` 代理到 3000
- `apps/h5`：移动端 H5，Vue 3 + Vite + TypeScript + Vant 3 + Pinia + Vue Router，端口 5174，`/api` 代理到 3000
- `packages/shared`：前后端共享的错误码、类型

## 启动

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run prisma -- migrate dev --name init   # 生成 dev.db
npm run dev                                 # 同时启动 server、web 与 h5
```

打开 http://localhost:5173 进入 Web 管理端，http://localhost:5174 进入移动端 H5，http://localhost:3000/api/docs 查看 Swagger。

## 目录

```
apps/server/src/common/      拦截器、过滤器、异常、装饰器（已配好，不要改）
apps/server/src/modules/     每个业务模块一个目录（学生新增）
apps/server/prisma/          schema.prisma、seed.ts、migrations
apps/server/test/            集成测试（独立 SQLite 测试库）
apps/web/src/api/http.ts     axios 实例：统一拆包 { code, message, data }、错误提示
apps/web/src/components/     ProTable（搜索栏 + 表格 + 分页）
apps/web/src/layout/         后台布局（侧栏 + 顶栏 + 内容区）
apps/h5/src/                 移动端 H5（Vant 3）：工作台、工单、扫码报工、安灯、通知、库存、质检
docs/                        log/ adr/ acceptance/ checklists/ prompts/ state-machine/
scripts/verify/              里程碑验收脚本 m1–m4
CLAUDE.md                    AI 与人共同遵守的约定
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 同时启动 server、web 与 h5 |
| `npm run dev:h5` | 只启动移动端 H5（端口 5174） |
| `npm test` | 全部单元测试（server Jest + web Vitest） |
| `npm run test:e2e` | server 集成测试 |
| `npm run prisma -- migrate dev` | 建/更新数据库 |
| `npm run seed` | 幂等种子 |
| `npm run verify:m1` | 里程碑 1 验收（第 12 节） |
| `npm run lint` | ESLint |
