import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateDictItemDto {
  @ApiProperty({ description: '显示文本', example: '进行中' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  label: string;

  @ApiProperty({ description: '存储值（同一字典内唯一）', example: 'IN_PROGRESS' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 64)
  value: string;

  @ApiPropertyOptional({ description: '排序号，越小越靠前', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}

export class UpdateDictItemDto {
  @ApiPropertyOptional({ description: '显示文本', example: '进行中' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  label?: string;

  @ApiPropertyOptional({ description: '存储值（同一字典内唯一）', example: 'IN_PROGRESS' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 64)
  value?: string;

  @ApiPropertyOptional({ description: '排序号，越小越靠前', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}
