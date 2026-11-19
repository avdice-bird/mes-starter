import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto, SkillDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeeListQueryDto } from '../../common/dto/module-query.dto';

@ApiTags('employee')
@ApiBearerAuth()
@Controller('employees')
export class EmployeeController {
  constructor(private employees: EmployeeService) {}

  @Get()
  @Permissions('employee:view')
  @ApiOperation({ summary: '员工分页列表（可按状态/班组筛选；离职员工用 status=LEFT 查历史）' })
  list(@Query() query: EmployeeListQueryDto) {
    return this.employees.list(query);
  }

  @Get(':id')
  @Permissions('employee:view')
  @ApiOperation({ summary: '员工详情（离职员工也可查，历史可见）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.employees.findOne(id);
  }

  @Post()
  @Permissions('employee:create')
  @ApiOperation({ summary: '创建员工；工号或用户关联重复 → 409' })
  create(@Body() dto: CreateEmployeeDto, @Req() req: Request & { user: { username: string } }) {
    return this.employees.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('employee:update')
  @ApiOperation({ summary: '编辑员工（姓名/关联用户/状态）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto, @Req() req: Request & { user: { username: string } }) {
    return this.employees.update(id, dto, req.user.username);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @Permissions('employee:update')
  @ApiOperation({ summary: '调组（写 EmployeeTransfer 变更记录）' })
  transfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { toTeamId: number },
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.employees.transfer(id, body.toTeamId, req.user.username);
  }

  @Get(':id/transfers')
  @Permissions('employee:view')
  @ApiOperation({ summary: '调组历史' })
  transfers(@Param('id', ParseIntPipe) id: number) {
    return this.employees.transfers(id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @Permissions('employee:update')
  @ApiOperation({ summary: '离职（status=LEFT；组长标记摘除）' })
  leave(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { username: string } }) {
    return this.employees.leave(id, req.user.username);
  }

  @Post(':id/rehire')
  @HttpCode(HttpStatus.OK)
  @Permissions('employee:update')
  @ApiOperation({ summary: '再入职（恢复 ACTIVE，工号不变）' })
  rehire(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { user: { username: string } }) {
    return this.employees.rehire(id, req.user.username);
  }

  @Put(':id/skills')
  @Permissions('employee:update')
  @ApiOperation({ summary: '技能维护（整体覆盖：工序编码或工作中心 + 等级）' })
  setSkills(@Param('id', ParseIntPipe) id: number, @Body() body: { skills: SkillDto[] }, @Req() req: Request & { user: { username: string } }) {
    return this.employees.setSkills(id, body.skills ?? [], req.user.username);
  }

  @Delete(':id')
  @Permissions('employee:delete')
  @ApiOperation({ summary: '删除员工；有调组历史或已离职的转为离职（历史不变）' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.employees.remove(id);
  }
}
