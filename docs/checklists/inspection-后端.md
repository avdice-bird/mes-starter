# 质检联动边界清单 · 后端（第 45 节）

| # | 用例 | 期望 | 落点 | ✓ |
|---|---|---|---|---|
| 1 | 质检点（isInspectionPoint）工序报工 | 自动生成 IPQC 待检单（refType=OPERATION）；下道保持 PENDING | `applyFlow` 里 isQcHold 判断（在流转变更前拦截下道 READY）+ 生成 IPQC | ✅ |
| 2 | IPQC FAIL | 下道不 READY；REWORK 标记处理（数量回退由 38 节撤销流水承担，不静默改数） | qcHold 期间无 PASS/CONCESSION → 下道不放行 | ✅ |
| 3 | requireFqc 物料入库前 | 必须有 PASS/CONCESSION 的 FQC，否则 422（校验顺序：状态→FQC→数量） | `InventoryService.receipt` FQC gate | ✅ |
| 4 | passQty + failQty ≠ sampleQty | 400 | `validateSubmission` 纯函数 | ✅ |
| 5 | failQty > 0 无缺陷记录 | 400 | 同上 | ✅ |
| 6 | PASS 但 failQty > 0 | 结构性杜绝：failQty>0 时结论硬编码为 FAIL（本课不做 AQL） | `submit()` | ✅ |
| 7 | 让步接收 | 需要 `inspection:concession` 权限（实时查库，planner 有/qc 无）；记录 reason；结论转 CONCESSION 放行 | `disposition()` $queryRaw 检查 | ✅ |
| 8 | 重复提交 | 409（version + result=PENDING 条件更新） | `submit()` | ✅ |
| 9 | 缺陷代码停用 | 不出现在录入下拉（status=1 过滤）；历史检验单详情仍显示 | `submit()` 停用校验 + list status 过滤 | ✅ |
| 10 | 删除被引用的缺陷代码 | 409（可停用） | `deleteDefectCode()` | ✅ |
| 11 | IPQC PASS 放行 | 下道 PENDING → READY，plannedQty = 本道良品数（不合格不往下流） | `submit()` 放行补做 | ✅ |

实现要点（评审记录）：

- qcHold 拦截必须在 `computeFlowTransitions` 的变更落地**之前**过滤"下道 READY"，否则先 READY 再撤销会有窗口；
- qcHold 的 early return 原本跳过了工单 completedQty 同步 → 分批入库被 2002 卡死（互测式自测发现），同步逻辑移到 early return 之前；
- completedQty 口径最终版：**最后一道有产出的工序的良品数**（M3 互测发现的覆盖 bug 的第三次修复——前两次修复各处理了一种场景，这次的 find-withOutput 覆盖所有场景）。
