import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { WorkReportService } from './work-report.service';
import { CreateWorkReportDto, ReverseWorkReportDto } from './dto/work-report.dto';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('work-report')
@ApiBearerAuth()
@Controller('work-reports')
export class WorkReportController {
  constructor(
    private reports: WorkReportService,
    private prisma: PrismaService,
  ) {}

  @Post()
  @Permissions('work-report:create')
  @ApiOperation({ summary: '报工（幂等键去重；事务内累加与流转）' })
  create(@Body() dto: CreateWorkReportDto, @Req() req: Request & { user: { username: string } }) {
    return this.reports.create(dto, req.user.username);
  }

  @Get('work-order/:workOrderId')
  @Permissions('work-report:view')
  @ApiOperation({ summary: '某工单的报工流水（含撤销负数流水）' })
  listByWorkOrder(@Param('workOrderId', ParseIntPipe) workOrderId: number) {
    return this.reports.listByWorkOrder(workOrderId);
  }

  @Post(':id/reverse')
  @Permissions('work-report:reverse')
  @ApiOperation({ summary: '撤销报工：生成负数流水并回退数量；下道已开工拒绝' })
  async reverse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReverseWorkReportDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.reports.reverse(id, dto.reason, req.user.username);
  }
}

@ApiTags('work-report')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrderQrcodeController {
  constructor(private prisma: PrismaService) {}

  /** 扫码定位接口：由 `wo:<code>` 内容反查工单 + 任务（页面直接用 code 查询，无需登录外的信息） */
  @Get('by-code/:code')
  @Permissions('work-report:view')
  @ApiOperation({ summary: '按工单编码定位工单与可报任务（扫码页数据源）' })
  async byCode(@Param('code') code: string) {
    const wo = await this.prisma.workOrder.findUnique({
      where: { code },
      include: { material: { select: { code: true, name: true } } },
    });
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, `工单 ${code} 不存在`);
    const ops = await this.prisma.workOrderOperation.findMany({
      where: { workOrderId: wo.id, status: { in: ['READY', 'IN_PROGRESS'] } },
      orderBy: { seq: 'asc' },
      include: { workCenter: { select: { name: true } } },
    });
    return { workOrder: wo, operations: ops };
  }

  @Get(':id/qrcode')
  @Permissions('work-order:view')
  @ApiOperation({ summary: '工单二维码 PNG（内容 wo:<code>，扫码进报工页）' })
  async qrcode(@Param('id', ParseIntPipe) id: number, @Query('size') size?: string, @Res() res?: Response) {
    const wo = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    const px = Math.min(Math.max(Number(size) || 240, 120), 600);
    const buffer = await QRCode.toBuffer(`wo:${wo.code}`, { width: px, margin: 2, errorCorrectionLevel: 'M' });
    // @Res() 绕过 ResponseInterceptor（Buffer 不能被 JSON 包装）；headersSent 检查在拦截器里已有
    if (res) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="${wo.code}.png"`);
      res.send(buffer);
      return;
    }
    throw new BusinessException(ErrorCode.INTERNAL, 'unreachable');
  }
}
