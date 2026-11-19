import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateCategoryDto {
  @ApiPropertyOptional({ description: '父分类 id，根节点传空', example: null })
  @IsOptional()
  @IsInt()
  parentId?: number;

  @ApiProperty({ description: '分类编码，2-32 位大写字母数字下划线，全局唯一，创建后不可改', example: 'CAP' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{1,31}$/, { message: '编码须为 2-32 位字母开头的字母数字下划线' })
  code: string;

  @ApiProperty({ description: '分类名称', example: '电容' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: '父分类 id；传 null 挂到根（不能选自己或自己的后代）' })
  @IsOptional()
  @IsInt()
  parentId?: number | null;

  @ApiPropertyOptional({ description: '分类名称（code 不可修改，被导入模板引用）', example: '电容' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name?: string;
}
