import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min, ValidateNested, ArrayMinSize } from 'class-validator';

export class CreateBomDto {
  @ApiProperty({ description: '父物料 id', example: 1 })
  @IsInt() @Min(1)
  materialId: number;

  @ApiProperty({ description: '版本号，同物料唯一', example: 'v1' })
  @IsString() @Length(1, 16)
  version: string;

  @ApiProperty({ description: '生效日期（ISO）', example: '2026-01-01' })
  @IsISO8601()
  effectiveFrom: string;

  @ApiPropertyOptional({ description: '失效日期（ISO），空 = 长期有效' })
  @IsOptional() @IsISO8601()
  effectiveTo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class UpdateBomDto {
  @ApiPropertyOptional({ description: '生效日期（ISO）' })
  @IsOptional() @IsISO8601()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: '失效日期（ISO），空 = 长期有效' })
  @IsOptional() @IsISO8601()
  effectiveTo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SaveBomItemDto {
  @ApiProperty({ description: '子件物料 id（不能是父物料自己）', example: 2 })
  @IsInt() @Min(1)
  childMaterialId: number;

  @ApiProperty({ description: '单位用量（最小单位数，>0）', example: 3 })
  @IsInt() @Min(1) @Max(1_000_000)
  qty: number;

  @ApiProperty({ description: '损耗率（万分比 bp）：300 = 3%，0–10000', example: 300 })
  @IsInt() @Min(0) @Max(10_000)
  scrapRate: number;

  @ApiPropertyOptional({ description: '位号，如 R1,R2' })
  @IsOptional() @IsString() @Length(0, 200)
  position?: string;

  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SaveBomItemsDto {
  @ApiProperty({ description: '全量明细（整体覆盖保存）', type: [SaveBomItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SaveBomItemDto)
  items: SaveBomItemDto[];
}

export class QueryBomDto {
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @IsOptional() @IsString() @Length(0, 64)
  keyword?: string;

  @ApiPropertyOptional({ description: '状态筛选', enum: ['DRAFT', 'ACTIVE', 'OBSOLETE'] })
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'OBSOLETE'])
  status?: 'DRAFT' | 'ACTIVE' | 'OBSOLETE';

  @IsOptional() @IsIn(['id', 'createdAt', 'version'])
  sortBy?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
