import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';

export class CreateProductionOrderDto {
  /** 留空/不传时由服务端按 PO-YYYY-NNN 自动生成；保留手动指定以兼容导入/脚本 */
  @ApiPropertyOptional({ description: '订单编码；留空则自动生成 PO-YYYY-NNN', example: 'PO-2026-001' })
  @Transform(({ value }) => (typeof value === 'string' ? (value.trim() || undefined) : value))
  @IsOptional() @IsString() @Length(1, 32)
  code?: string;

  @ApiProperty({ description: '成品物料 id', example: 1 })
  @IsInt() @Min(1)
  materialId: number;

  @ApiProperty({ description: '计划数量（最小单位，>0）', example: 1000 })
  @IsInt() @Min(1) @Max(10_000_000)
  qty: number;

  @ApiProperty({ description: '交期', example: '2026-12-31' })
  @IsISO8601()
  dueDate: string;

  @ApiPropertyOptional({ description: '优先级 1（最高）-5（最低）', example: 3, default: 3 })
  @IsOptional() @IsInt() @Min(1) @Max(5)
  priority?: number;

  @ApiPropertyOptional({ description: '来源', enum: ['MANUAL', 'SALES', 'PLAN'], default: 'MANUAL' })
  @IsOptional() @IsIn(['MANUAL', 'SALES', 'PLAN'])
  source?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class UpdateProductionOrderDto {
  @ApiPropertyOptional({ description: '计划数量；已有工单时拒绝修改' })
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000)
  qty?: number;

  @ApiPropertyOptional({ description: '交期' })
  @IsOptional() @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ description: '优先级 1-5' })
  @IsOptional() @IsInt() @Min(1) @Max(5)
  priority?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SplitItemDto {
  @ApiProperty({ description: '本张工单数量（>0）', example: 400 })
  @IsInt() @Min(1) @Max(10_000_000)
  qty: number;

  @ApiPropertyOptional({ description: '指定工作中心；空 = 排产时按最空闲分配' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;
}

export class SplitProductionOrderDto {
  @ApiProperty({ description: '拆分明细（数量之和必须等于订单数量）', type: [SplitItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitItemDto)
  splits: SplitItemDto[];
}

export class ScheduleRunDto {
  @ApiProperty({ description: '排产起始日', example: '2026-10-12' })
  @IsISO8601()
  from: string;

  @ApiPropertyOptional({ description: '排产窗口截止日（缺省 from + 90 天）', example: '2026-12-31' })
  @IsOptional() @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: '只在这些产线上排（缺省全部启用产线）', type: [Number] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsInt({ each: true }) @Min(1, { each: true })
  workCenterIds?: number[];
}

export class AdjustPlanDto {
  @ApiProperty({ description: '新计划开始日', example: '2026-10-14' })
  @IsISO8601()
  plannedStart: string;

  @ApiProperty({ description: '新计划结束日（≥ 开始日）', example: '2026-10-16' })
  @IsISO8601()
  plannedEnd: string;

  @ApiProperty({ description: '新工作中心 id（跨行拖动时改变）', example: 1 })
  @IsInt() @Min(1)
  workCenterId: number;
}

export class TransitionDto {
  @ApiPropertyOptional({ description: '原因：cancel 必填；complete 部分完工时必填' })
  @IsOptional() @IsString() @Length(1, 200)
  reason?: string;
}
