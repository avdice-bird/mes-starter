import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { UserService } from './user.service';
import { AssignRolesDto, CreateUserDto, QueryUserDto, UpdateUserDto } from './dto/user.dto';

@ApiTags('user')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private users: UserService) {}

  @Get()
  @Permissions('user:view')
  @ApiOperation({ summary: '用户分页列表（关键字匹配用户名/姓名）' })
  list(@Query() query: QueryUserDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @Permissions('user:view')
  @ApiOperation({ summary: '用户详情（含角色）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  @Post()
  @Permissions('user:create')
  @ApiOperation({ summary: '创建用户' })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Permissions('user:update')
  @ApiOperation({ summary: '编辑用户（姓名/重置密码/启停）；不能停用自己' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: Request & { user: { id: number } }) {
    return this.users.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Permissions('user:delete')
  @ApiOperation({ summary: '删除用户；不能删除自己' })
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { id: number } }) {
    await this.users.remove(id, req.user.id);
  }

  @Put(':id/roles')
  @Permissions('user:assign-role')
  @ApiOperation({ summary: '给用户分配角色；不能修改自己的角色' })
  assignRoles(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignRolesDto, @Req() req: Request & { user: { id: number } }) {
    return this.users.assignRoles(id, dto, req.user.id);
  }
}
