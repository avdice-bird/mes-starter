import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TeamService } from './team.service';
import { TeamListQueryDto } from '../../common/dto/module-query.dto';
import { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';

@ApiTags('team')
@ApiBearerAuth()
@Controller('teams')
export class TeamController {
  constructor(private teams: TeamService) {}

  @Get()
  @Permissions('team:view')
  @ApiOperation({ summary: '班组分页列表' })
  list(@Query() query: TeamListQueryDto) {
    return this.teams.list(query);
  }

  @Get(':id')
  @Permissions('team:view')
  @ApiOperation({ summary: '班组详情' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.teams.findOne(id);
  }

  @Post()
  @Permissions('team:create')
  @ApiOperation({ summary: '创建班组；组长必须属于本班组' })
  create(@Body() dto: CreateTeamDto, @Req() req: Request & { user: { username: string } }) {
    return this.teams.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('team:update')
  @ApiOperation({ summary: '编辑班组（含指定组长）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTeamDto, @Req() req: Request & { user: { username: string } }) {
    return this.teams.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('team:delete')
  @ApiOperation({ summary: '删除班组；有员工时拒绝' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.teams.remove(id);
  }
}
