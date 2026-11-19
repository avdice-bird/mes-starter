import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateEquipmentDto {
  @ApiProperty({ description: '设备编码', example: 'EQ-SMT-01' })
  @IsString() @Length(2, 32)
  code: string;

  @ApiProperty({ description: '设备名称', example: '贴片机 1 号' })
  @IsString() @Length(1, 32)
  name: string;

  @ApiProperty({ description: '所属工作中心 id', example: 1 })
  @IsInt() @Min(1)
  workCenterId: number;

  @ApiPropertyOptional({ description: '型号', example: 'YSM20' })
  @IsOptional() @IsString() @Length(0, 64)
  model?: string;
}

export class UpdateEquipmentDto {
  @ApiPropertyOptional({ description: '设备名称' })
  @IsOptional() @IsString() @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '所属工作中心 id（转移）' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;

  @ApiPropertyOptional({ description: '型号' })
  @IsOptional() @IsString() @Length(0, 64)
  model?: string;

  @ApiPropertyOptional({ description: '状态', enum: ['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE'] })
  @IsOptional() @IsIn(['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE'])
  status?: string;
}

export class QueryWorkCenterDto {
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @IsOptional() @IsString() @Length(0, 64)
  keyword?: string;
}
