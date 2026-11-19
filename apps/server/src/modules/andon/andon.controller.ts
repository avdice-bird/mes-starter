import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AndonService } from './andon.service';
import { NotificationService } from './notification.service';
import { CreateAndonCallDto, RespondAndonDto, CloseAndonDto, CancelAndonDto, ListNotificationDto } from './dto/andon.dto';

type ReqUser = Request & { user: { id: number; username: string } };

@ApiTags('andon')
@ApiBearerAuth()
@Controller('andon-calls')
export class AndonController {
  constructor(private andon: AndonService) {}

  @Post()
  @Permissions('andon:create')
  @ApiOperation({ summary: '发起安灯呼叫（同工作中心同类型 OPEN 合并）' })
  create(@Body() dto: CreateAndonCallDto, @Req() req: ReqUser) {
    return this.andon.create(dto, req.user);
  }

  @Post(':id/respond')
  @Permissions('andon:respond')
  @ApiOperation({ summary: '响应（责任角色；admin 兜底）' })
  respond(@Param('id', ParseIntPipe) id: number, @Body() dto: RespondAndonDto, @Req() req: ReqUser) {
    return this.andon.respond(id, req.user, dto.remark);
  }

  @Post(':id/close')
  @Permissions('andon:close')
  @ApiOperation({ summary: '关闭（需 resolution）' })
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: CloseAndonDto, @Req() req: ReqUser) {
    return this.andon.close(id, dto.resolution, req.user);
  }

  @Post(':id/cancel')
  @Permissions('andon:create')
  @ApiOperation({ summary: '取消（仅呼叫人，仅 OPEN）' })
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelAndonDto, @Req() req: ReqUser) {
    return this.andon.cancel(id, dto.reason, req.user);
  }

  @Get()
  @Permissions('andon:view')
  @ApiOperation({ summary: '安灯列表（状态/工作中心筛选）' })
  list(@Query('page') page?: number, @Query('pageSize') pageSize?: number, @Query('status') status?: string, @Query('workCenterId') workCenterId?: number) {
    return this.andon.list({ page, pageSize, status, workCenterId });
  }

  @Get('open')
  @Permissions('andon:view')
  @ApiOperation({ summary: '当前 OPEN 呼叫（看板红块数据源）' })
  open(@Query('workCenterId') workCenterId?: number) {
    return this.andon.openCalls(workCenterId ? Number(workCenterId) : undefined);
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private notifications: NotificationService) {}

  @Get()
  @Permissions('notification:view')
  @ApiOperation({ summary: '我的通知（分页、按已读筛选）' })
  list(@Query() query: ListNotificationDto, @Req() req: ReqUser) {
    return this.notifications.list(req.user.id, query);
  }

  @Get('unread-count')
  @Permissions('notification:view')
  @ApiOperation({ summary: '未读数（顶栏铃铛）' })
  unreadCount(@Req() req: ReqUser) {
    return this.notifications.unreadCount(req.user.id);
  }

  @Post(':id/read')
  @Permissions('notification:view')
  @ApiOperation({ summary: '标记已读（仅本人）' })
  markRead(@Param('id', ParseIntPipe) id: number, @Req() req: ReqUser) {
    return this.notifications.markRead(id, req.user.id);
  }
}
