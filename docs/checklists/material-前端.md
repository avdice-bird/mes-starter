# material 模块 · 前端细节清单

> 对照 `清单/前端细节清单.md`，第 13-15 节逐项核对。

## 列表页（MaterialList / UnitList / MaterialCategoryList）
- [x] 三个页面均用 ProTable（MaterialList、UnitList）；分类是树，用 el-table 树形展示（row-key + tree-props）替代分页表格
- [x] 操作列按钮 v-permission：`material:create/update/delete/import/export`、`unit:*`、`material-category:*`
- [x] MaterialList 筛选：关键字（编码/名称/规格）+ 分类树下拉（el-tree-select）+ 类型下拉，筛选条件与导出共用
- [x] 状态 tag 颜色：启用绿 / 停用灰；类型 tag：成品绿 / 半成品黄 / 原料灰
- [x] 危险操作 ElMessageBox.confirm，删除提示注明"被引用时无法删除"

## 表单
- [x] 校验规则与后端 DTO 一致：code 正则（字母开头 2-32 位，含下划线/连字符）、name maxlength 64、spec 128
- [x] code 编辑弹窗 disabled + 创建弹窗提示"编码创建后不可修改"（三层一致：DTO 不收 + Service 兜底 + 前端禁用）
- [x] 分类表单父分类下拉：编辑时排除自己与后代（前端体验防线，后端 2005 兜底）
- [x] 分类/单位下拉数据在 onMounted 并行加载；表单 el-tree-select check-strictly（分类树任一级可选）

## 导入导出交互
- [x] 导入对话框先给整批拒绝策略提示（el-alert）：有错误行整批不导入
- [x] 下载模板 / 导出走统一 http 实例（带 token、401 自动刷新），responseType: blob；saveBlobResponse 触发浏览器下载
- [x] 导入超时放宽 120s（默认 15s 对大文件不够）；上传按钮 loading 态
- [x] 成功：显示导入条数并刷新表格；失败：错误表格（行号+原因）+ "下载错误报告"按钮（前端 exceljs 生成，原因列红色）
- [x] 错误原因文案含行号与列名，用户可直接定位修正

## 类型与接口
- [x] 类型全部放 `packages/shared`：UnitRow/CategoryNode/MaterialRow/MaterialQuery/MaterialImportResult 等
- [x] `api/material.ts`、`api/unit.ts`、`api/material-category.ts` 每个函数带返回类型
- [x] vue-tsc 无错误；vitest 既有用例不回归

## 细节
- [x] 表单防重复提交（saving loading 态）；对话框 destroy-on-close
- [x] 数字输入 el-input-number（min 0），安全库存可空
- [x] 空数据显示 el-empty（ProTable 内置）
