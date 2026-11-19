import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { EquipmentStatusService } from './equipment-status.service';
import { DowntimeQueryDto, DailyReportQueryDto } from '../../common/dto/module-query.dto';
import { ChangeStatusDto, CreateDowntimeDto, GenerateDailyReportDto } from '../../common/dto/module-query.dto';

@ApiTags('equipment-status')
@ApiBearerAuth()
@Controller('equipment')
export class EquipmentStatusController {
  constructor(private status: EquipmentStatusService) {}

  @Post(':id/status')
  @Permissions('equipment:change-status')
  @ApiOperation({ summary: '切换设备状态：FAULT/MAINTENANCE 自动开停机，切回自动关；重复状态 409' })
  changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.status.changeStatus(id, dto, req.user.id, req.user.username);
  }

  @Get(':id/status-logs')
  @Permissions('equipment:view')
  @ApiOperation({ summary: '设备状态变更日志' })
  statusLogs(@Param('id', ParseIntPipe) id: number) {
    return this.status.listStatusLogs(id);
  }

  @Get('downtimes')
  @Permissions('downtime:view')
  @ApiOperation({ summary: '停机记录列表' })
  downtimes(@Query() query: DowntimeQueryDto) {
    return this.status.listDowntimes(query);
  }

  @Post('downtimes')
  @Permissions('downtime:update')
  @ApiOperation({ summary: '补录停机：endedAt < startedAt 400；与已有停机重叠 409' })
  createDowntime(
    @Body() dto: CreateDowntimeDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.status.createDowntime(dto, req.user.username);
  }

  @Get('daily-reports')
  @Permissions('downtime:view')
  @ApiOperation({ summary: '设备日报列表' })
  reports(@Query() query: DailyReportQueryDto) {
    return this.status.listReports(query);
  }

  @Post('daily-reports/generate')
  @Permissions('downtime:update')
  @ApiOperation({ summary: '手动生成某天日报（定时任务每天 00:05 调同一方法；幂等 upsert）' })
  generate(@Body() dto: GenerateDailyReportDto) {
    return this.status.generateDailyReport(dto.date);
  }
}
