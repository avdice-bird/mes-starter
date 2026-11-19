import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const YIELD_GROUP_BY = ['material', 'operation', 'shift', 'team', 'date'] as const;

export class WorkOrderProgressQueryDto {
  @ApiPropertyOptional({ description: '起始日期（工厂时区 yyyy-MM-dd，按工单 createdAt）' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含当天）' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: '工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;

  @ApiPropertyOptional({ description: '工单状态' })
  @IsOptional() @IsString()
  status?: string;
}

export class YieldQueryDto {
  @ApiPropertyOptional({ description: '起始日期' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含当天）' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: '分组维度', enum: YIELD_GROUP_BY })
  @IsOptional() @IsIn(YIELD_GROUP_BY as unknown as string[])
  groupBy?: string;

  @ApiPropertyOptional({ description: '工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;
}

export class OeeQueryDto {
  @ApiPropertyOptional({ description: '起始日期' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含当天）' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: '设备 id' })
  @IsOptional() @IsInt() @Min(1)
  equipmentId?: number;

  @ApiPropertyOptional({ description: '工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;
}

export class DefectTopQueryDto {
  @ApiPropertyOptional({ description: '起始日期' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: '结束日期（含当天）' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: '条数' })
  @IsOptional() @IsInt() @Min(1) @Max(20)
  top?: number;
}
