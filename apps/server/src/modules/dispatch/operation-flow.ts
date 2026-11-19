/**
 * 工序流转纯函数（第 34 节实现，第 36 节单测对象）。
 *
 * 核心不变量（第 35 节用例 5 钉死）：下道工序的可做数量 ≤ 上道的良品数，不良品不往下流。
 * 数量策略：任务 plannedQty 初始 = 工单 qty；上道完工（含跳过）时，下道 plannedQty 补齐为
 *   min(上道良品数, 工单 qty)——若下道 plannedQty 原本更大则下调，保证不变量恒成立。
 */

export interface OperationState {
  id: number;
  seq: number;
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  plannedQty: number;
  completedQty: number;
  defectQty: number;
  skipped: boolean;
  isInspectionPoint: boolean;
}

/** 按 seq 排序的任务列表中，某任务的前一道（不含 CANCELLED/SKIPPED 空洞按最近未取消道算） */
export function prevOperation(ops: OperationState[], seq: number): OperationState | null {
  const sorted = [...ops].filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  const idx = sorted.findIndex((o) => o.seq === seq);
  return idx > 0 ? sorted[idx - 1] : null;
}

/** 末道（未取消的最后一道） */
export function lastOperation(ops: OperationState[]): OperationState | null {
  const sorted = [...ops].filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * 报工/完工后的流转计算：输入全部任务与本道（更新后的）数量，输出需要变更的任务。
 * 纯函数：不写库，由调用方在事务内执行变更。
 */
export function computeFlowTransitions(
  ops: OperationState[],
  currentOpId: number,
): { opId: number; to: 'READY' | 'COMPLETED'; plannedQty?: number }[] {
  const sorted = [...ops].filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  const idx = sorted.findIndex((o) => o.id === currentOpId);
  if (idx < 0) return [];
  const current = sorted[idx];
  const changes: { opId: number; to: 'READY' | 'COMPLETED'; plannedQty?: number }[] = [];

  const currentDone = current.completedQty + current.defectQty;
  const isFilled = current.skipped || currentDone >= current.plannedQty;

  // 本道：数量补满 → COMPLETED（调用方已在累加时判断状态；此处只处理"数量到位"的收尾）
  if (current.status === 'IN_PROGRESS' && isFilled) {
    changes.push({ opId: current.id, to: 'COMPLETED' });
  }

  // 下道：补 plannedQty（不超过本道良品数）并转 READY
  const next = sorted[idx + 1];
  if (next && isFilled) {
    const wanted = Math.min(current.completedQty, current.plannedQty);
    if (next.status === 'PENDING') {
      changes.push({ opId: next.id, to: 'READY', plannedQty: wanted });
    } else if (next.status === 'READY' && next.plannedQty > wanted) {
      changes.push({ opId: next.id, to: 'READY', plannedQty: wanted });
    }
  }

  // 末道 COMPLETED 后无下道——工单层 complete 由调用方根据 lastOperation 判断
  return changes;
}

/** 是否所有未取消任务都已完成（含跳过）→ 工单可以 complete */
export function allOperationsCompleted(ops: OperationState[]): boolean {
  const active = ops.filter((o) => o.status !== 'CANCELLED');
  return active.length > 0 && active.every((o) => o.status === 'COMPLETED');
}
