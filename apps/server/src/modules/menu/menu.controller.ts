import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { MenuService } from './menu.service';
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto';

@ApiTags('menu')
@ApiBearerAuth()
@Controller('menus')
export class MenuController {
  constructor(private menus: MenuService) {}

  @Get()
  @Permissions('menu:view')
  @ApiOperation({ summary: '全量菜单树（管理用）' })
  tree() {
    return this.menus.tree();
  }

  @Post()
  @Permissions('menu:create')
  @ApiOperation({ summary: '创建菜单节点' })
  create(@Body() dto: CreateMenuDto) {
    return this.menus.create(dto);
  }

  @Patch(':id')
  @Permissions('menu:update')
  @ApiOperation({ summary: '编辑菜单节点；父节点指向自己或子孙时拒绝（防循环）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuDto) {
    return this.menus.update(id, dto);
  }

  @Delete(':id')
  @Permissions('menu:delete')
  @ApiOperation({ summary: '删除菜单节点；有子菜单时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.menus.remove(id);
  }
}
