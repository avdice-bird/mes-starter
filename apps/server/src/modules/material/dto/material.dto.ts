import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class CreateMaterialDto {
  @ApiProperty({ description: '物料编码，2-32 位字母开头的字母数字、下划线或连字符，唯一，创建后不可改', example: 'CAP-0402-104' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_-]{1,31}$/, { message: '编码须为 2-32 位字母开头的字母数字、下划线或连字符' })
  code: string;

  @ApiProperty({ description: '物料名称', example: '贴片电容 100nF' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 64)
  name: string;

  @ApiPropertyOptional({ description: '规格型号', example: '0402 X7R 100nF ±10% 50V' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 128)
  spec?: string;

  @ApiProperty({ description: '分类 id', example: 1 })
  @IsInt()
  categoryId: number;

  @ApiProperty({ description: '单位 id', example: 1 })
  @IsInt()
  unitId: number;

  @ApiProperty({ description: '类型：RAW=原料 SEMI=半成品 FINISHED=成品', example: 'RAW', enum: ['RAW', 'SEMI', 'FINISHED'] })
  @IsString()
  @IsIn(['RAW', 'SEMI', 'FINISHED'], { message: '类型须为 RAW/SEMI/FINISHED' })
  type: string;

  @ApiPropertyOptional({ description: '安全库存（最小单位）', example: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99_999_999)
  safetyStock?: number;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}

export class UpdateMaterialDto {
  @ApiPropertyOptional({ description: '物料名称（code 创建后不可修改，传了也不生效）', example: '贴片电容 100nF' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 64)
  name?: string;

  @ApiPropertyOptional({ description: '规格型号' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 128)
  spec?: string;

  @ApiPropertyOptional({ description: '分类 id' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: '单位 id' })
  @IsOptional()
  @IsInt()
  unitId?: number;

  @ApiPropertyOptional({ description: '类型：RAW/SEMI/FINISHED', enum: ['RAW', 'SEMI', 'FINISHED'] })
  @IsOptional()
  @IsString()
  @IsIn(['RAW', 'SEMI', 'FINISHED'], { message: '类型须为 RAW/SEMI/FINISHED' })
  type?: string;

  @ApiPropertyOptional({ description: '安全库存（最小单位）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99_999_999)
  safetyStock?: number;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}

export class QueryMaterialDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '分类 id', example: 1 })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: '类型：RAW/SEMI/FINISHED', enum: ['RAW', 'SEMI', 'FINISHED'] })
  @IsOptional()
  @IsString()
  @IsIn(['RAW', 'SEMI', 'FINISHED'])
  type?: string;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}
