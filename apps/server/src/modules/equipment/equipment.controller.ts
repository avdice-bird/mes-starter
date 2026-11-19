import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { EquipmentService } from './equipment.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';
import { EquipmentListQueryDto } from '../../common/dto/module-query.dto';

@ApiTags('equipment')
@ApiBearerAuth()
@Controller('equipments')
export class EquipmentController {
  constructor(private equipments: EquipmentService) {}

  @Get()
  @Permissions('equipment:view')
  @ApiOperation({ summary: '设备分页列表（可按工作中心筛选）' })
  list(@Query() query: EquipmentListQueryDto) {
    return this.equipments.list(query);
  }

  @Post()
  @Permissions('equipment:create')
  @ApiOperation({ summary: '创建设备（归属工作中心）' })
  create(@Body() dto: CreateEquipmentDto, @Req() req: Request & { user: { username: string } }) {
    return this.equipments.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('equipment:update')
  @ApiOperation({ summary: '编辑设备（含转移工作中心，转移由审计日志记录）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEquipmentDto, @Req() req: Request & { user: { username: string } }) {
    return this.equipments.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('equipment:delete')
  @ApiOperation({ summary: '删除设备' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.equipments.remove(id);
  }
}
