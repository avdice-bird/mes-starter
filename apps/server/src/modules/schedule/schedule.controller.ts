import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { ProductionOrderService } from './production-order.service';
import { SchedulerService } from './scheduler.service';
import { WorkOrderService } from './work-order.service';
import {
  CreateProductionOrderDto, AdjustPlanDto, ScheduleRunDto, SplitProductionOrderDto, TransitionDto, UpdateProductionOrderDto,
} from './dto/schedule.dto';
import { ProductionOrderListQueryDto, WorkOrderListQueryDto, ScheduleViewQueryDto } from '../../common/dto/module-query.dto';

@ApiTags('production-order')
@ApiBearerAuth()
@Controller('production-orders')
export class ProductionOrderController {
  constructor(private orders: ProductionOrderService) {}

  @Get()
  @Permissions('production-order:view')
  @ApiOperation({ summary: '生产订单分页列表（关键字/状态筛选）' })
  list(@Query() query: ProductionOrderListQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @Permissions('production-order:view')
  @ApiOperation({ summary: '订单详情（含工单列表）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.orders.findOne(id);
  }

  @Post()
  @Permissions('production-order:create')
  @ApiOperation({ summary: '创建生产订单（DRAFT）' })
  create(@Body() dto: CreateProductionOrderDto, @Req() req: Request & { user: { username: string } }) {
    return this.orders.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('production-order:update')
  @ApiOperation({ summary: '编辑订单；已有工单时改数量 409' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductionOrderDto, @Req() req: Request & { user: { username: string } }) {
    return this.orders.update(id, dto, req.user.username);
  }

  @Post(':id/split')
  @Permissions('production-order:split')
  @ApiOperation({ summary: '拆分为工单；数量之和 ≠ 订单数量 400' })
  split(@Param('id', ParseIntPipe) id: number, @Body() dto: SplitProductionOrderDto, @Req() req: Request & { user: { username: string } }) {
    return this.orders.split(id, dto, req.user.username);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('production-order:cancel')
  @ApiOperation({ summary: '取消订单：CREATED 工单级联取消；有已下达/开工工单 409' })
  cancel(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { username: string } }) {
    return this.orders.cancel(id, req.user.username);
  }

  @Delete(':id')
  @Permissions('production-order:delete')
  @ApiOperation({ summary: '删除订单；已有工单 409' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.orders.remove(id);
  }
}

@ApiTags('work-order')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrderController {
  constructor(private workOrders: WorkOrderService) {}

  @Get()
  @Permissions('work-order:view')
  @ApiOperation({ summary: '工单分页列表（只读；状态/产线/延误筛选）' })
  list(@Query() query: WorkOrderListQueryDto) {
    return this.workOrders.list(query);
  }

  @Get(':id')
  @Permissions('work-order:view')
  @ApiOperation({ summary: '工单详情' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const wo = await this.workOrders.findOne(id);
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    return wo;
  }

  @Patch(':id/plan')
  @Permissions('schedule:adjust')
  @ApiOperation({ summary: '手工调整计划（甘特图拖拽回写）；仅 CREATED，end≥start，重算延误' })
  adjustPlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustPlanDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.adjustPlan(id, dto, req.user.username);
  }

  @Get(':id/state-log')
  @Permissions('work-order:view')
  @ApiOperation({ summary: '工单状态变更日志（时间正序）' })
  stateLog(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.listLogs(id);
  }

  @Get(':id/detail')
  @Permissions('work-order:view')
  @ApiOperation({ summary: '工单详情 + 状态日志 + allowedActions（前端按钮显隐数据源）' })
  async detail(@Param('id', ParseIntPipe) id: number) {
    return this.workOrders.detailWithLog(id);
  }

  // ---- 状态机动作（转换表见 work-order.state.ts；统一走 transition()） ----

  @Post(':id/release')
  @Permissions('work-order:release')
  @ApiOperation({ summary: '下达；前置：物料有 ACTIVE 路线（422）' })
  release(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'release', { operatorId: req.user.id, operatorName: req.user.username });
  }

  @Post(':id/start')
  @Permissions('work-order:start')
  @ApiOperation({ summary: '开工' })
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'start', { operatorId: req.user.id, operatorName: req.user.username });
  }

  @Post(':id/pause')
  @Permissions('work-order:pause')
  @ApiOperation({ summary: '暂停' })
  pause(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'pause', { operatorId: req.user.id, operatorName: req.user.username, reason: dto.reason });
  }

  @Post(':id/resume')
  @Permissions('work-order:start')
  @ApiOperation({ summary: '继续（暂停恢复开工）' })
  resume(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'resume', { operatorId: req.user.id, operatorName: req.user.username });
  }

  @Post(':id/complete')
  @Permissions('work-order:complete')
  @ApiOperation({ summary: '完工；部分完工（未达计划数）必须填 reason' })
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'complete', { operatorId: req.user.id, operatorName: req.user.username, reason: dto.reason });
  }

  @Post(':id/close')
  @Permissions('work-order:close')
  @ApiOperation({ summary: '关闭（终态）' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.workOrders.transition(id, 'close', { operatorId: req.user.id, operatorName: req.user.username });
  }

  @Post(':id/cancel')
  @Permissions('work-order:cancel')
  @ApiOperation({ summary: '取消（CREATED/RELEASED/IN_PROGRESS/PAUSED）；reason 必填' })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('取消必须填写原因');
    }
    return this.workOrders.transition(id, 'cancel', { operatorId: req.user.id, operatorName: req.user.username, reason: dto.reason });
  }
}

@ApiTags('schedule')
@ApiBearerAuth()
@Controller('schedule')
export class ScheduleController {
  constructor(private scheduler: SchedulerService) {}

  @Post('run')
  @Permissions('schedule:run')
  @ApiOperation({ summary: '一键排产：填产线与计划起止，返回分组结果与延误数' })
  run(@Body() dto: ScheduleRunDto) {
    return this.scheduler.run(dto);
  }

  @Get()
  @Permissions('work-order:view')
  @ApiOperation({ summary: '排产结果查询：按产线分组的窗口内已排工单' })
  view(@Query() query: ScheduleViewQueryDto) {
    return this.scheduler.view(query);
  }
}
