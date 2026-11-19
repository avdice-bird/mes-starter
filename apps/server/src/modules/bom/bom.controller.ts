import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BomService } from './bom.service';
import { CreateBomDto, QueryBomDto, SaveBomItemsDto, UpdateBomDto } from './dto/bom.dto';

@ApiTags('bom')
@ApiBearerAuth()
@Controller('boms')
export class BomController {
  constructor(private boms: BomService) {}

  @Get()
  @Permissions('bom:view')
  @ApiOperation({ summary: 'BOM 分页列表（关键字匹配物料编码/名称/版本）' })
  list(@Query() query: QueryBomDto) {
    return this.boms.list(query);
  }

  @Get(':id/tree')
  @Permissions('bom:view')
  @ApiOperation({ summary: 'BOM 树形展开（多级，含叶子需求汇总）' })
  tree(@Param('id', ParseIntPipe) id: number) {
    return this.boms.tree(id);
  }

  @Get(':id')
  @Permissions('bom:view')
  @ApiOperation({ summary: 'BOM 详情（含明细）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.boms.findOne(id);
  }

  @Post()
  @Permissions('bom:create')
  @ApiOperation({ summary: '创建 BOM 版本（同物料同版本重复 → 409）' })
  create(@Body() dto: CreateBomDto, @Req() req: Request & { user: { username: string } }) {
    return this.boms.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('bom:update')
  @ApiOperation({ summary: '编辑 BOM 骨架（生效期/备注）；明细另走批量保存' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBomDto, @Req() req: Request & { user: { username: string } }) {
    return this.boms.update(id, dto, req.user.username);
  }

  @Put(':id/items')
  @Permissions('bom:update')
  @ApiOperation({ summary: '明细批量保存（整体覆盖；ACTIVE 拒绝；自引用/成环拒绝 2003）' })
  saveItems(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveBomItemsDto, @Req() req: Request & { user: { username: string } }) {
    return this.boms.saveItems(id, dto, req.user.username);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Permissions('bom:activate')
  @ApiOperation({ summary: '激活版本；同父物料其他 ACTIVE 自动置 OBSOLETE' })
  activate(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { username: string } }) {
    return this.boms.activate(id, req.user.username);
  }

  @Delete(':id')
  @Permissions('bom:delete')
  @ApiOperation({ summary: '删除 BOM（级联明细）；ACTIVE 版本拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.boms.remove(id);
  }
}
