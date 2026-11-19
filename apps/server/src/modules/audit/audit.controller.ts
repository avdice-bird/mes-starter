import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';

/** 审计日志：只读（无增删改接口——审计记录不可篡改） */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  @Permissions('audit:view')
  @ApiOperation({ summary: '审计日志分页列表（按用户/模块/时间/结果筛选）' })
  list(@Query() query: QueryAuditLogDto) {
    return this.audit.list(query);
  }

  @Get(':id')
  @Permissions('audit:view')
  @ApiOperation({ summary: '审计日志详情' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.audit.findOne(id);
  }
}
