import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RoutingService } from './routing.service';
import { CreateRoutingDto, QueryRoutingDto, SaveOperationsDto, UpdateRoutingDto } from './dto/routing.dto';

@ApiTags('routing')
@ApiBearerAuth()
@Controller('routings')
export class RoutingController {
  constructor(private routings: RoutingService) {}

  @Get()
  @Permissions('routing:view')
  @ApiOperation({ summary: '路线分页列表（工序按 seq 排序）' })
  list(@Query() query: QueryRoutingDto) {
    return this.routings.list(query);
  }

  @Get(':id')
  @Permissions('routing:view')
  @ApiOperation({ summary: '路线详情（含工序）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.routings.findOne(id);
  }

  @Post()
  @Permissions('routing:create')
  @ApiOperation({ summary: '创建路线版本' })
  create(@Body() dto: CreateRoutingDto, @Req() req: Request & { user: { username: string } }) {
    return this.routings.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('routing:update')
  @ApiOperation({ summary: '编辑路线备注' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoutingDto, @Req() req: Request & { user: { username: string } }) {
    return this.routings.update(id, dto, req.user.username);
  }

  @Put(':id/operations')
  @Permissions('routing:update')
  @ApiOperation({ summary: '工序批量保存（整体覆盖；seq 重复 409；ACTIVE 拒改）' })
  saveOperations(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveOperationsDto, @Req() req: Request & { user: { username: string } }) {
    return this.routings.saveOperations(id, dto, req.user.username);
  }

  @Put(':id/reorder')
  @Permissions('routing:update')
  @ApiOperation({ summary: '工序重排（传全量工序 id 按新顺序）' })
  reorder(@Param('id', ParseIntPipe) id: number, @Body() body: { orderedIds: number[] }, @Req() req: Request & { user: { username: string } }) {
    return this.routings.reorder(id, body.orderedIds, req.user.username);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Permissions('routing:activate')
  @ApiOperation({ summary: '激活；无工序拒绝；同物料旧 ACTIVE 自动 OBSOLETE' })
  activate(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { username: string } }) {
    return this.routings.activate(id, req.user.username);
  }

  @Post(':id/copy')
  @HttpCode(HttpStatus.OK)
  @Permissions('routing:create')
  @ApiOperation({ summary: '复制为新版本（复制全部工序，新版本 DRAFT）' })
  copy(@Param('id', ParseIntPipe) id: number, @Body() body: { version: string }, @Req() req: Request & { user: { username: string } }) {
    return this.routings.copyAsNewVersion(id, body.version, req.user.username);
  }

  @Delete(':id')
  @Permissions('routing:delete')
  @ApiOperation({ summary: '删除路线（级联工序）；ACTIVE 拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.routings.remove(id);
  }
}
