# routing / work-center / equipment 模块 · 前端细节清单

> 第 21 节核对（RoutingList.vue 单页三 Tab：路线 / 工作中心 / 设备）。

## 状态反馈
- [x] 加载 loading（ProTable 内置 + 表格 loading）
- [x] 空状态（暂无数据）
- [x] 失败提示（409"有 N 台设备""seq 重复"均弹 ElMessage）
- [x] 保存按钮 :loading 防重复
- [x] 成功提示 + 列表刷新

## 表单
- [x] 校验与 DTO 一致（required + maxlength；standardMinutes el-input-number min=1）
- [x] 后端错误能显示
- [x] 编辑回填完整；弹窗 destroy-on-close
- [x] 下拉数据来自接口：工作中心下拉 loadWcs()、物料远程搜索
- [x] 危险操作 confirm：删除 WC/设备/路线、激活路线

## 表格
- [x] 工序可编辑表格：seq/编码/名称/工作中心/标准工时/质检点开关
- [x] 状态 tag 带颜色（DRAFT 灰 / ACTIVE 绿 / OBSOLETE 红；设备四态四色）
- [x] 操作列 fixed right；设备按工作中心筛选

## 权限
- [x] 按钮显隐 v-permission（routing:activate 只对非 ACTIVE 显示"激活"）
- [x] ACTIVE 版本工序编辑禁用 + 文案"请复制新版本"
- [x] token 过期自动刷新（全局拦截器）

## 体验
- [x] 浏览器流程 console 无报错
- [x] 弹窗/抽屉 Esc 可关
- [x] 主从（路线→工序）用抽屉；三 Tab 切换模块
