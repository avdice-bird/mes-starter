import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DispatchService } from './dispatch.service';
import { AssignOperationDto } from './dto/dispatch.dto';

@ApiTags('work-order-operation')
@ApiBearerAuth()
@Controller('work-order-operations')
export class DispatchController {
  constructor(private dispatch: DispatchService) {}

  @Get('work-order/:workOrderId')
  @Permissions('work-order-operation:view')
  @ApiOperation({ summary: '某工单的工序任务列表（按 seq 排序）' })
  list(@Param('workOrderId', ParseIntPipe) workOrderId: number) {
    return this.dispatch.listByWorkOrder(workOrderId);
  }

  @Post(':id/assign')
  @Permissions('work-order-operation:assign')
  @ApiOperation({ summary: '派工：班组/员工/设备；员工技能与设备归属校验' })
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOperationDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.dispatch.assign(id, dto, req.user.username);
  }

  @Post(':id/start')
  @Permissions('work-order-operation:start')
  @ApiOperation({ summary: '任务开工：READY → IN_PROGRESS；首道开工工单自动 IN_PROGRESS' })
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.dispatch.start(id, req.user.username);
  }

  @Post(':id/skip')
  @Permissions('work-order-operation:start')
  @ApiOperation({ summary: '跳过工序（质检点禁止）；本道 COMPLETED 下道 READY' })
  skip(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.dispatch.skip(id, req.user.username);
  }


}
