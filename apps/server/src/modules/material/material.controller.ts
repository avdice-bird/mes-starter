import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { MaterialService } from './material.service';
import { CreateMaterialDto, QueryMaterialDto, UpdateMaterialDto } from './dto/material.dto';

@ApiTags('material')
@ApiBearerAuth()
@Controller('materials')
export class MaterialController {
  constructor(private materials: MaterialService) {}

  @Get()
  @Permissions('material:view')
  @ApiOperation({ summary: '物料分页列表（关键字/分类/类型/状态筛选）' })
  list(@Query() query: QueryMaterialDto) {
    return this.materials.list(query);
  }

  @Get('import-template')
  @Permissions('material:import')
  @ApiOperation({ summary: '下载导入模板（xlsx）' })
  async template(@Res() res: Response) {
    const buffer = await this.materials.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('物料导入模板.xlsx'));
    res.send(buffer);
  }

  @Get('export')
  @Permissions('material:export')
  @ApiOperation({ summary: '按当前筛选条件导出物料（xlsx）' })
  async export(@Query() query: QueryMaterialDto, @Res() res: Response) {
    const buffer = await this.materials.export(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('物料导出.xlsx'));
    res.send(buffer);
  }

  @Post('import')
  @Permissions('material:import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入物料（整批校验，有错误全批拒绝并返回错误报告）' })
  async importFile(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request & { user: { username: string } }) {
    const result = await this.materials.import(file, req.user.username);
    // 无错误：返回成功数；有错误：错误明细直接放响应（前端渲染表格 + 生成下载）
    return result;
  }

  @Get(':id')
  @Permissions('material:view')
  @ApiOperation({ summary: '物料详情' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.materials.findOne(id);
  }

  @Get(':id/active-bom')
  @Permissions('material:view')
  @ApiOperation({ summary: '当前生效 BOM（explode=1 展开多级叶子汇总）' })
  activeBom(
    @Param('id', ParseIntPipe) id: number,
    @Query('explode') explode?: string,
    @Query('qty') qty?: string,
  ) {
    return this.materials.activeBomSummary(id, explode === '1', Number(qty) > 0 ? Number(qty) : 1);
  }

  @Get(':id/active-routing')
  @Permissions('material:view')
  @ApiOperation({ summary: '当前生效工艺路线（工序按 seq 排序）' })
  activeRouting(@Param('id', ParseIntPipe) id: number) {
    return this.materials.activeRouting(id);
  }

  @Post()
  @Permissions('material:create')
  @ApiOperation({ summary: '创建物料' })
  create(@Body() dto: CreateMaterialDto, @Req() req: Request & { user: { username: string } }) {
    return this.materials.create(dto, req.user.username);
  }

  @Patch(':id')
  @Permissions('material:update')
  @ApiOperation({ summary: '编辑物料（code 创建后不可修改，传了也不生效）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMaterialDto, @Req() req: Request & { user: { username: string } }) {
    return this.materials.update(id, dto, req.user.username);
  }

  @Delete(':id')
  @Permissions('material:delete')
  @ApiOperation({ summary: '删除物料；被 BOM/工单/库存引用时拒绝（BOM 建完后补齐判断）' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.materials.remove(id);
  }
}
