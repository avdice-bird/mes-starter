import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateUnitDto {
  @ApiProperty({ description: '单位编码，2-16 位大写字母数字下划线，唯一，创建后不可改', example: 'PCS' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{1,15}$/, { message: '编码须为 2-16 位字母开头的字母数字下划线' })
  code: string;

  @ApiProperty({ description: '单位名称', example: '个' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name: string;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}

export class UpdateUnitDto {
  @ApiPropertyOptional({ description: '单位名称（code 不可修改，被物料引用）', example: '个' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}
