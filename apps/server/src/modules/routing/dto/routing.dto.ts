import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

export class CreateRoutingDto {
  @ApiProperty({ description: '父物料 id', example: 1 })
  @IsInt() @Min(1)
  materialId: number;

  @ApiProperty({ description: '版本号', example: 'v1' })
  @IsString() @Length(1, 16)
  version: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SaveOperationDto {
  @ApiProperty({ description: '工序序号（1 起，同路线内唯一）', example: 10 })
  @IsInt() @Min(1) @Max(999)
  seq: number;

  @ApiProperty({ description: '工序编码', example: 'OP10' })
  @IsString() @Length(1, 32)
  code: string;

  @ApiProperty({ description: '工序名称', example: '贴片' })
  @IsString() @Length(1, 64)
  name: string;

  @ApiProperty({ description: '工作中心 id', example: 1 })
  @IsInt() @Min(1)
  workCenterId: number;

  @ApiProperty({ description: '标准工时（分钟，>0）', example: 5 })
  @IsInt() @Min(1) @Max(100_000)
  standardMinutes: number;

  @ApiPropertyOptional({ description: '是否质检点' })
  @IsOptional() @IsBoolean()
  isInspectionPoint?: boolean;

  @ApiPropertyOptional({ description: '允许跳过' })
  @IsOptional() @IsBoolean()
  allowSkip?: boolean;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SaveOperationsDto {
  @ApiProperty({ description: '全量工序（整体覆盖保存）', type: [SaveOperationDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(99)
  @ValidateNested({ each: true })
  @Type(() => SaveOperationDto)
  operations: SaveOperationDto[];
}

export class UpdateRoutingDto {
  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class QueryRoutingDto {
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @IsOptional() @IsString() @Length(0, 64)
  keyword?: string;

  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'OBSOLETE'])
  status?: string;

  @IsOptional() @IsIn(['id', 'createdAt', 'version'])
  sortBy?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
