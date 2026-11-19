import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/** 审计日志查询：按用户、模块、时间范围筛选（只读模块，无增删改） */
export class QueryAuditLogDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '用户 id 精确筛选', example: 1 })
  @IsOptional() @IsInt() @Min(1)
  userId?: number;

  @ApiPropertyOptional({ description: '模块名筛选（路径第一段，如 dicts）', example: 'dicts' })
  @IsOptional() @IsString() @Length(1, 32)
  module?: string;

  @ApiPropertyOptional({ description: '起始时间（含），ISO 字符串', example: '2026-09-20T00:00:00Z' })
  @IsOptional() @IsString() @Length(10, 40)
  from?: string;

  @ApiPropertyOptional({ description: '结束时间（含），ISO 字符串', example: '2026-09-21T00:00:00Z' })
  @IsOptional() @IsString() @Length(10, 40)
  to?: string;

  @ApiPropertyOptional({ description: '结果筛选：success 或错误码', example: 'success' })
  @IsOptional() @IsString() @Length(1, 16)
  result?: string;
}
