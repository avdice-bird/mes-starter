import { get } from './http';

/** 车间看板汇总（需要 board:view） */
export interface BoardSummary {
  todayGoodQty: number;
  todayDefectQty: number;
  yieldRate: number | null;
  wipOrders: number;
  equipmentStatus: Record<string, number>;
  recentReports: {
    id: number;
    employeeName: string;
    operationName: string;
    goodQty: number;
    defectQty: number;
    reportedAt: string;
  }[];
}

export const getBoardSummary = (workCenterId?: number) =>
  get<BoardSummary>('/board/summary', { workCenterId });
