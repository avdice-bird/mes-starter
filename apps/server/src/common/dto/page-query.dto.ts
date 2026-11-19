import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * 分页查询基类：字段与 packages/shared 的 PageQuery 接口一致。
 * 校验：page ≥ 1；pageSize 默认 20、上限 200（service 层再兜底一次）。
 */
export class PageQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', example: 1 })
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数，默认 20，上限 200', example: 20 })
  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ description: '关键字', example: '' })
  @IsOptional() @IsString() @Length(0, 100)
  keyword?: string;

  @ApiPropertyOptional({ description: '排序字段' })
  @IsOptional() @IsString() @Length(1, 32)
  sortBy?: string;

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'] })
  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
