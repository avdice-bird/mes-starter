import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { UnitService } from './unit.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';

@ApiTags('unit')
@ApiBearerAuth()
@Controller('units')
export class UnitController {
  constructor(private units: UnitService) {}

  @Get()
  @Permissions('unit:view')
  @ApiOperation({ summary: '单位分页列表（关键字匹配编码/名称，含物料引用数）' })
  list(@Query() query: PageQueryDto) {
    return this.units.list(query);
  }

  @Get('options')
  @Permissions('unit:view')
  @ApiOperation({ summary: '启用单位下拉选项' })
  options() {
    return this.units.options();
  }

  @Post()
  @Permissions('unit:create')
  @ApiOperation({ summary: '创建单位' })
  create(@Body() dto: CreateUnitDto, @Req() req: Request & { user: { username: string } }) {
    return this.units.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('unit:update')
  @ApiOperation({ summary: '编辑单位（code 不可修改，被物料引用）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUnitDto, @Req() req: Request & { user: { username: string } }) {
    return this.units.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('unit:delete')
  @ApiOperation({ summary: '删除单位；被物料引用时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.units.remove(id);
  }
}
