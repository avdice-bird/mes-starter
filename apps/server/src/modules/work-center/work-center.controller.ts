import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkCenterService } from './work-center.service';
import { CreateWorkCenterDto, UpdateWorkCenterDto } from './dto/work-center.dto';

@ApiTags('work-center')
@ApiBearerAuth()
@Controller('work-centers')
export class WorkCenterController {
  constructor(private wcs: WorkCenterService) {}

  @Get()
  @Permissions('work-center:view')
  @ApiOperation({ summary: '工作中心分页列表' })
  list(@Query() query: { page?: number; pageSize?: number; keyword?: string }) {
    return this.wcs.list(query);
  }

  @Post()
  @Permissions('work-center:create')
  @ApiOperation({ summary: '创建工作中心' })
  create(@Body() dto: CreateWorkCenterDto, @Req() req: Request & { user: { username: string } }) {
    return this.wcs.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('work-center:update')
  @ApiOperation({ summary: '编辑工作中心' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkCenterDto, @Req() req: Request & { user: { username: string } }) {
    return this.wcs.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('work-center:delete')
  @ApiOperation({ summary: '删除工作中心；有设备或被工序引用时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.wcs.remove(id);
  }
}
