import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ShiftService } from './shift.service';
import { ShiftListQueryDto } from '../../common/dto/module-query.dto';

@ApiTags('shift')
@ApiBearerAuth()
@Controller('shifts')
export class ShiftController {
  constructor(private shifts: ShiftService) {}

  @Get()
  @Permissions('shift:view')
  @ApiOperation({ summary: '班次列表' })
  list(@Query() query: ShiftListQueryDto) {
    return this.shifts.list(query);
  }

  /** 用例检查项：02:00 与 10:00 的结果。at 是 ISO 字符串（含时区偏移），缺省用当前时刻 */
  @Get('current')
  @Permissions('shift:view')
  @ApiOperation({ summary: '当前班次（at=ISO 时刻，按工厂时区判断；空档返回 null）' })
  async current(@Query('at') atRaw?: string) {
    // at 含 "+08:00" 这类时区偏移时，query 里 + 会被解析成空格；容错还原
    const at = atRaw?.replace(/(\d) (\d{2}:\d{2})/, '$1+$2');
    const date = at ? new Date(at) : new Date();
    if (Number.isNaN(date.getTime())) return { code: 1001, message: 'at 不是有效的 ISO 时间', data: null };
    const shift = await this.shifts.getCurrentShift(date);
    return { shift, at: date.toISOString(), checkedWithFactoryTz: true };
  }

  @Post()
  @Permissions('shift:create')
  @ApiOperation({ summary: '创建班次；与现有班次时间重叠 → 409' })
  create(
    @Body() dto: { code: string; name: string; startTime: string; endTime: string },
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.shifts.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('shift:update')
  @ApiOperation({ summary: '编辑班次；重叠 → 409' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { name?: string; startTime?: string; endTime?: string },
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.shifts.update(id, dto as { name?: string; startTime?: string; endTime: string | undefined }, req.user.username);
  }

  @Delete(':id')
  @Permissions('shift:delete')
  @ApiOperation({ summary: '删除班次' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.shifts.remove(id);
  }
}
