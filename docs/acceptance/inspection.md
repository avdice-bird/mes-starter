# 质检验收标准（第 44-45 节）

| # | 验收项 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 检验单创建 | `POST /inspections`：type（IQC/IPQC/FQC）+ refType+refId 关联批次/工序任务/工单 | ✅ |
| 2 | 提交结果 | `POST /inspections/:id/submit`：passQty+failQty=sampleQty；缺陷多行录入（Σqty=failQty） | ✅ |
| 3 | 让步接收 | FAIL 后 disposition=CONCESSION → 结论转 CONCESSION（放行），需 `inspection:concession` 权限 + reason | ✅ |
| 4 | 不合格处理 | FAIL → REWORK/SCRAP/CONCESSION，reason 必填 | ✅ |
| 5 | 缺陷代码 | 15 个种子（5 类 × 3 严重度）；停用后不出现在录入下拉（`status=1` 过滤），历史可见 | ✅ |
| 6 | 删除保护 | 被检验记录引用的缺陷代码 → 409（可停用） | ✅ |
| 7 | IPQC 联动 | 质检点（isInspectionPoint）工序报工 → 自动生成 IPQC 待检单；下道保持 PENDING 直到 PASS/CONCESSION | ✅ |
| 8 | FQC 联动 | 物料 `requireFqc`=true 时，入库前必须有 PASS/CONCESSION 的 FQC → 否则 422 | ✅ |
| 9 | 数量校验 | pass+fail≠sample 400；fail>0 无缺陷 400；PASS 但 fail>0 400；Σ缺陷=failQty | ✅ |
| 10 | 重复提交 | 已提交检验单再提交 → 409 | ✅ |
| 11 | 权限 | `defect-code:*`、`inspection:view/create/submit/disposition/concession` | ✅ |

跑通记录（第 44 节检查项）：对成品批次建 FQC → 抽 10 判 8 合格 2 不良（DF-WELD 焊接不良 ×2）→ 结论 FAIL → 处理 REWORK ✅
