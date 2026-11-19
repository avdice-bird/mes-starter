import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { MaterialCategoryService } from './material-category.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/material-category.dto';

@ApiTags('material-category')
@ApiBearerAuth()
@Controller('material-categories')
export class MaterialCategoryController {
  constructor(private categories: MaterialCategoryService) {}

  @Get()
  @Permissions('material-category:view')
  @ApiOperation({ summary: '分类树（含每级物料数）' })
  tree() {
    return this.categories.tree();
  }

  @Post()
  @Permissions('material-category:create')
  @ApiOperation({ summary: '创建分类' })
  create(@Body() dto: CreateCategoryDto, @Req() req: Request & { user: { username: string } }) {
    return this.categories.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('material-category:update')
  @ApiOperation({ summary: '编辑分类（code 不可修改；移动父级不能选自己或后代）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto, @Req() req: Request & { user: { username: string } }) {
    return this.categories.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('material-category:delete')
  @ApiOperation({ summary: '删除分类；有子分类或物料时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.categories.remove(id);
  }
}
