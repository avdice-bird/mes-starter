import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateDictDto {
  @ApiProperty({ description: '字典编码，2-32 位小写字母数字下划线，被业务代码引用，创建后不可改', example: 'work_order_status' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,31}$/, { message: '编码须为 2-32 位小写字母开头的字母数字下划线' })
  code: string;

  @ApiProperty({ description: '字典名称', example: '工单状态' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name: string;

  @ApiPropertyOptional({ description: '备注', example: '生产工单的状态集合' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  remark?: string;
}

export class UpdateDictDto {
  @ApiPropertyOptional({ description: '字典名称（code 不可修改，被业务代码引用）', example: '工单状态' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  remark?: string;
}
