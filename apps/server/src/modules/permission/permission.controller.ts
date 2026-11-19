import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionRow } from '@mes/shared';

/**
 * 权限码字典只读：权限码由种子维护（rbac-data.ts + 扫描测试兜底），
 * 不开放创建/编辑——代码里写死的 @Permissions 码必须先入表，接口创建会造成码表与代码脱节。
 */
@ApiTags('permission')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Permissions('permission:view')
  @ApiOperation({ summary: '权限码全量列表（按模块+编码排序，用于角色权限树）' })
  async list(): Promise<PermissionRow[]> {
    const list = await this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
    return list.map((p) => ({ id: p.id, code: p.code, name: p.name, module: p.module }));
  }
}
