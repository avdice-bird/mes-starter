import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RoleService } from './role.service';
import { AssignPermissionsDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@ApiTags('role')
@ApiBearerAuth()
@Controller('roles')
export class RoleController {
  constructor(private roles: RoleService) {}

  @Get()
  @Permissions('role:view')
  @ApiOperation({ summary: '角色列表（全量，含用户数与权限数）' })
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @Permissions('role:view')
  @ApiOperation({ summary: '角色详情' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.roles.findOne(id);
  }

  @Post()
  @Permissions('role:create')
  @ApiOperation({ summary: '创建角色' })
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @Permissions('role:update')
  @ApiOperation({ summary: '编辑角色（名称/备注）；内置角色拒绝' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @Permissions('role:delete')
  @ApiOperation({ summary: '删除角色；内置角色或仍有关联用户时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.roles.remove(id);
  }

  @Put(':id/permissions')
  @Permissions('role:assign-permission')
  @ApiOperation({ summary: '给角色分配权限；内置角色拒绝' })
  assignPermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPermissionsDto) {
    return this.roles.assignPermissions(id, dto);
  }
}
