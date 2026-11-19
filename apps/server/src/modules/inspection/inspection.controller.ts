import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { InspectionService } from './inspection.service';
import { CreateInspectionDto, DispositionDto, SubmitInspectionDto } from './dto/inspection.dto';
import { InspectionListQueryDto, DefectCodeListQueryDto } from '../../common/dto/module-query.dto';
import { DefectCodeCreateDto, DefectCodeUpdateDto } from '../../common/dto/module-query.dto';

@ApiTags('inspection')
@ApiBearerAuth()
@Controller('inspections')
export class InspectionController {
  constructor(private inspections: InspectionService) {}

  @Get()
  @Permissions('inspection:view')
  @ApiOperation({ summary: '检验单列表（待检/已检筛选）' })
  list(@Query() query: InspectionListQueryDto) {
    return this.inspections.list(query);
  }

  @Get(':id')
  @Permissions('inspection:view')
  @ApiOperation({ summary: '检验单详情（含缺陷明细）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.inspections.findOne(id);
  }

  @Post()
  @Permissions('inspection:create')
  @ApiOperation({ summary: '创建检验单（对批次/工序任务/工单）' })
  create(@Body() dto: CreateInspectionDto, @Req() req: Request & { user: { id: number; username: string } }) {
    return this.inspections.create(dto, req.user.username);
  }

  @Post(':id/submit')
  @Permissions('inspection:submit')
  @ApiOperation({ summary: '提交检验结果与缺陷；重复提交 409；PASS 时 failQty 必须为 0' })
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitInspectionDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    return this.inspections.submit(id, dto, req.user.id);
  }

  @Post(':id/disposition')
  @Permissions('inspection:disposition')
  @ApiOperation({ summary: '不合格处理：REWORK/SCRAP/CONCESSION（让步需专用权限）+ reason' })
  disposition(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DispositionDto,
    @Req() req: Request & { user: { id: number; username: string } },
  ) {
    // 让步接收需要专用权限 inspection:concession（第 45 节用例 7）——在 service 内查库校验
    return this.inspections.disposition(id, dto, req.user.username, req.user.id);
  }
}

@ApiTags('defect-code')
@ApiBearerAuth()
@Controller('defect-codes')
export class DefectCodeController {
  constructor(private inspections: InspectionService) {}

  @Get()
  @Permissions('inspection:view')
  @ApiOperation({ summary: '缺陷代码列表（status=1 过滤启用）' })
  list(@Query() query: DefectCodeListQueryDto) {
    return this.inspections.listDefectCodes(query);
  }

  @Post()
  @Permissions('defect-code:create')
  @ApiOperation({ summary: '新建缺陷代码' })
  create(
    @Body() dto: DefectCodeCreateDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    return this.inspections.createDefectCode(dto, req.user.username);
  }

  @Put(':id')
  @Permissions('defect-code:create')
  @ApiOperation({ summary: '编辑缺陷代码（含停用 status=0；历史记录仍显示）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: DefectCodeUpdateDto) {
    return this.inspections.updateDefectCode(id, dto);
  }

  @Delete(':id')
  @Permissions('defect-code:create')
  @ApiOperation({ summary: '删除缺陷代码；被检验记录引用 409' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.inspections.deleteDefectCode(id);
  }
}
