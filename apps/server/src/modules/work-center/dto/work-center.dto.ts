import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateWorkCenterDto {
  @ApiProperty({ description: '工作中心编码', example: 'WC-SMT' })
  @IsString() @Length(2, 32)
  code: string;

  @ApiProperty({ description: '名称', example: 'SMT 车间' })
  @IsString() @Length(1, 32)
  name: string;

  @ApiPropertyOptional({ description: '类型：LINE=产线 CELL=工位', enum: ['LINE', 'CELL'], example: 'LINE' })
  @IsOptional() @IsIn(['LINE', 'CELL'])
  type?: string;

  @ApiPropertyOptional({ description: '日产能（件）', example: 5000 })
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000)
  dailyCapacity?: number;
}

export class UpdateWorkCenterDto {
  @ApiPropertyOptional({ description: '名称' })
  @IsOptional() @IsString() @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '类型', enum: ['LINE', 'CELL'] })
  @IsOptional() @IsIn(['LINE', 'CELL'])
  type?: string;

  @ApiPropertyOptional({ description: '日产能（件）' })
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000)
  dailyCapacity?: number;

  @ApiPropertyOptional({ description: '状态 1=启用 0=停用', enum: [0, 1] })
  @IsOptional() @IsInt() @IsIn([0, 1])
  status?: number;
}
