import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DictService } from './dict.service';
import { CreateDictDto, UpdateDictDto } from './dto/dict.dto';
import { CreateDictItemDto, UpdateDictItemDto } from './dto/dict-item.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';

@ApiTags('dict')
@ApiBearerAuth()
@Controller('dicts')
export class DictController {
  constructor(private dicts: DictService) {}

  @Get()
  @Permissions('dict:view')
  @ApiOperation({ summary: '字典分页列表（关键字匹配编码/名称）' })
  list(@Query() query: PageQueryDto) {
    return this.dicts.list(query);
  }

  @Get('code/:code/options')
  @ApiOperation({ summary: '按字典编码取启用字典项（下拉用；登录即可，不要求 dict:view）' })
  optionsByCode(@Param('code') code: string) {
    return this.dicts.optionsByCode(code);
  }

  @Get(':id')
  @Permissions('dict:view')
  @ApiOperation({ summary: '字典详情（含全部字典项，按 sort 排序）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.dicts.findOne(id);
  }

  @Post()
  @Permissions('dict:create')
  @ApiOperation({ summary: '创建字典' })
  create(@Body() dto: CreateDictDto, @Req() req: Request & { user: { username: string } }) {
    return this.dicts.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('dict:update')
  @ApiOperation({ summary: '编辑字典（code 不可修改，被业务代码引用）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictDto, @Req() req: Request & { user: { username: string } }) {
    return this.dicts.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('dict:delete')
  @ApiOperation({ summary: '删除字典；有字典项时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dicts.remove(id);
  }

  @Get(':id/items')
  @Permissions('dict:view')
  @ApiOperation({ summary: '字典项列表（按 sort 排序）' })
  listItems(@Param('id', ParseIntPipe) id: number) {
    return this.dicts.listItems(id);
  }

  @Post(':id/items')
  @Permissions('dict:update')
  @ApiOperation({ summary: '新增字典项；value 同一字典内唯一' })
  createItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDictItemDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.dicts.createItem(id, dto, req.user.username);
  }

  @Put('items/:itemId')
  @Permissions('dict:update')
  @ApiOperation({ summary: '编辑字典项（value 同一字典内唯一）' })
  updateItem(@Param('itemId', ParseIntPipe) itemId: number, @Body() dto: UpdateDictItemDto, @Req() req: Request & { user: { username: string } }) {
    return this.dicts.updateItem(itemId, dto, req.user.username);
  }

  @Delete('items/:itemId')
  @Permissions('dict:update')
  @ApiOperation({ summary: '删除字典项' })
  async removeItem(@Param('itemId', ParseIntPipe) itemId: number) {
    await this.dicts.removeItem(itemId);
  }
}
