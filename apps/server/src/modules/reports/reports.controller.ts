import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';
import { ReportsExportService } from './reports-export.service';
import { WorkOrderProgressQueryDto, YieldQueryDto, OeeQueryDto, DefectTopQueryDto } from './dto/reports.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private reports: ReportsService,
    private exportService: ReportsExportService,
  ) {}

  @Get('work-order-progress')
  @Permissions('report:view')
  @ApiOperation({ summary: '工单进度报表（可 ?export=xlsx）' })
  async workOrderProgress(@Query() q: WorkOrderProgressQueryDto, @Res() res: Response) {
    if ('export' in q && (q as Record<string, unknown>).export) {
      const buffer = await this.exportService.workOrderProgress(q);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('工单进度.xlsx'));
      res.send(buffer);
      return;
    }
    res.json({ code: 0, message: 'ok', data: await this.reports.workOrderProgress(q) });
  }

  @Get('yield')
  @Permissions('report:view')
  @ApiOperation({ summary: '良率报表（groupBy=material|operation|shift|team|date；可 ?export=xlsx）' })
  async yield(@Query() q: YieldQueryDto & { export?: string }, @Res() res: Response) {
    if (q.export) {
      const buffer = await this.exportService.yield(q);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('良率报表.xlsx'));
      res.send(buffer);
      return;
    }
    res.json({ code: 0, message: 'ok', data: await this.reports.yield(q) });
  }

  @Get('yield/defect-top')
  @Permissions('report:view')
  @ApiOperation({ summary: '缺陷 TOP N（InspectionDefect 聚合）' })
  @Header('Cache-Control', 'no-store')
  defectTop(@Query() q: DefectTopQueryDto) {
    return this.reports.defectTop(q);
  }

  @Get('oee')
  @Permissions('report:view')
  @ApiOperation({ summary: 'OEE 报表（可用率×表现性×良率；可 ?export=xlsx）' })
  async oee(@Query() q: OeeQueryDto & { export?: string }, @Res() res: Response) {
    if (q.export) {
      const buffer = await this.exportService.oee(q);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('OEE报表.xlsx'));
      res.send(buffer);
      return;
    }
    res.json({ code: 0, message: 'ok', data: await this.reports.oee(q) });
  }
}
