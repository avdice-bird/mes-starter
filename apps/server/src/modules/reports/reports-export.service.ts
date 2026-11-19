import * as ExcelJS from 'exceljs';
import { Injectable } from '@nestjs/common';
import { ReportsService } from './reports.service';
import type { WorkOrderProgressQueryDto, YieldQueryDto, OeeQueryDto } from './dto/reports.dto';

/** 报表 xlsx 导出（与物料导出同模式：exceljs → Buffer，Controller 以附件下发） */
@Injectable()
export class ReportsExportService {
  constructor(private reports: ReportsService) {}

  private async toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async workOrderProgress(q: WorkOrderProgressQueryDto): Promise<Buffer> {
    const rows = await this.reports.workOrderProgress(q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('工单进度');
    ws.addRow(['工单编码', '状态', '产线', '计划数', '完成数', '进度%', '计划开始', '计划结束', '交期', '是否延误']);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        r.code, r.status, r.workCenterName ?? '', r.plannedQty, r.completedQty, r.progressPct,
        r.plannedStart?.toISOString().slice(0, 16).replace('T', ' ') ?? '',
        r.plannedEnd?.toISOString().slice(0, 16).replace('T', ' ') ?? '',
        r.dueDate ?? '', r.delayed ? '是' : '否',
      ]);
    }
    return this.toBuffer(wb);
  }

  async yield(q: YieldQueryDto): Promise<Buffer> {
    const rows = await this.reports.yield(q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('良率');
    ws.addRow(['分组', '良品', '不良', '良率%']);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow([r.label, r.goodQty, r.defectQty, r.yieldRate ?? '']);
    return this.toBuffer(wb);
  }

  async oee(q: OeeQueryDto): Promise<Buffer> {
    const rows = await this.reports.oee(q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('OEE');
    ws.addRow(['设备', '名称', '计划分钟', '停机分钟', '运行分钟', '可用率%', '表现性%', '良率%', 'OEE%']);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow([r.equipmentCode, r.equipmentName, r.plannedMinutes, r.downtimeMinutes, r.runningMinutes,
        r.availability ?? '', r.performance ?? '', r.yieldRate ?? '', r.oee ?? '']);
    }
    return this.toBuffer(wb);
  }
}
