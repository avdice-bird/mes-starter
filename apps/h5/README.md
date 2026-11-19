# @mes/h5 · MES 移动端 H5

基于项目现有 NestJS 接口实现的车间移动工作台，Vue 3 + Vite + TypeScript + **Vant 3** + Pinia + Vue Router。

## 功能

| 页面 | 说明 | 需要的权限 |
|---|---|---|
| 登录 | 账号密码登录，token 自动刷新（并发 401 单飞）；连续 3 次密码错误滑块验证，5 次锁定 15 分钟；30 分钟无操作自动退出 | — |
| 工作台 | 今日良品/不良/直通率/在制工单、快捷入口、待处理安灯、最近报工 | `board:view`（无则降级为工单统计） |
| 工单列表 | 状态页签、关键字搜索、仅看延误、下拉刷新、上拉分页 | `work-order:view` |
| 工单详情 | 进度、计划、状态流转按钮（按 allowedActions ∩ 权限显隐）、工序任务、报工记录、状态日志 | `work-order:view` 及对应动作权限 |
| 扫码报工 | 扫码/手输工单号 → 工序开工 → 报工（良品/不良/工时，幂等键防重复提交） | `work-report:create` |
| 安灯 | 待响应/处理中/已关闭列表，响应、关闭、取消、发起呼叫（同产线同类型未关闭自动合并） | `andon:view` / `andon:create` / `andon:respond` / `andon:close` |
| 消息通知 | 未读/全部、点击已读、详情弹层 | `notification:view` |
| 库存查询 | 库存余额、出入库流水、仓库筛选 | `inventory:view` |
| 质检任务 | 来料检/过程检/终检结果、缺陷明细、处置结果（只读） | `inspection:view` |
| 我的 | 用户、角色、权限点、功能入口、退出登录 | — |

底部 Tabbar 与首页快捷入口都会按当前账号权限自动裁剪；隐藏只是体验，真正的权限校验在后端守卫。

## 启动

在仓库根目录：

```bash
npm install          # 首次安装（会一并安装 apps/h5 依赖）
npm run dev          # 同时启动 server:3000、web:5173、h5:5174
# 或只启动移动端
npm run dev:h5
```

打开 http://localhost:5174 。手机真机调试时 Vite 已开启 `host: true`，用电脑局域网 IP + 5174 访问即可（需保证 `/api` 代理指向的 3000 端口可访问）。

构建：

```bash
npm run build -w @mes/h5
```

## 目录

```
apps/h5/
  src/api/         接口封装（http 拦截器 + 各业务模块）
  src/stores/      Pinia（登录态、权限码）
  src/router/      路由与登录/权限守卫
  src/layout/      TabbarLayout（底部导航）
  src/views/       页面
  src/utils/       状态字典、格式化、Vant 3 Toast/Dialog 封装
  src/styles/      移动端主题（与 Web 端同一套品牌色）
```

## 实现说明

- **接口契约与 Web 端一致**：统一 `{ code, message, data }` 拆包；401 时用 refresh token 换新并重放原请求，失败才回登录页。
- **Vant 3 函数式 API**：Vant 3 只导出 `Toast` / `Dialog` 对象，`src/utils/toast.ts` 做了统一封装，页面不直接依赖版本差异。
- **扫码**：优先使用浏览器原生 `BarcodeDetector`（Chrome/Edge/部分 Android WebView）；不支持时提示改用手动输入，不引入额外扫码依赖。二维码内容可以是纯工单编码、`wo:编码`，或带 `?wo=编码` 的 URL。
- **报工幂等**：每个工序表单持有一个 `idempotencyKey`，提交成功后轮换，失败保留，原样重试不会重复记账。
- **单位与分页**：全部数量按后端契约为整数最小单位；列表统一 10~15 条/页滚动加载。
- **移动端适配**：`viewport-fit=cover` + `env(safe-area-inset-*)`，适配刘海屏与底部手势区。
- **账号水印**：登录后由 `Watermark.vue` 在全局背景绘制当前账号名的重复斜向水印（canvas，`pointer-events: none`，不遮挡操作）。

## 账号说明

种子数据中的 `operator`（操作工）已按第 37 节报工场景补齐权限：安灯、通知、产线/设备只读，以及工单/工序只读、工序开工、报工和员工只读。因此操作工登录后可见「工作台 / 工单 / 报工 / 安灯 / 我的」五个入口。库存、质检入口仍需要 `inventory:view` / `inspection:view`（如 `admin`、`planner`、`qc`）。若在 Web 端角色管理里调整了权限，移动端下一次刷新即按新权限裁剪。

## 部署注意

- 构建产物在 `apps/h5/dist`。部署时 Web 服务器需要把 `/api` 反向代理到后端 3000 端口，并为前端路由做 history fallback（nginx：`try_files $uri $uri/ /index.html;`）。
- 微信 / 钉钉等内置浏览器若不支持 `BarcodeDetector`，扫码按钮会提示并降级为手动输入；如需在这些容器内强制扫码，可后续接入微信 JS-SDK 或 jsQR。
- 后端 CORS 白名单由 `WEB_ORIGIN` 控制；同域部署（H5 与 API 同源反代）时无需额外配置。

