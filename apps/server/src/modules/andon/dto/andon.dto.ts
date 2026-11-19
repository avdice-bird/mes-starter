import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const ANDON_TYPES = ['MATERIAL', 'EQUIPMENT', 'QUALITY', 'OTHER'] as const;

export class CreateAndonCallDto {
  @ApiProperty({ description: '呼叫类型', enum: ANDON_TYPES, example: 'EQUIPMENT' })
  @IsIn(ANDON_TYPES as unknown as string[])
  type: string;

  @ApiProperty({ description: '工作中心 id', example: 1 })
  @IsInt() @Min(1)
  workCenterId: number;

  @ApiPropertyOptional({ description: '设备 id（EQUIPMENT 类呼叫校验归属该工作中心）' })
  @IsOptional() @IsInt() @Min(1)
  equipmentId?: number;

  @ApiPropertyOptional({ description: '工单 id' })
  @IsOptional() @IsInt() @Min(1)
  workOrderId?: number;

  @ApiPropertyOptional({ description: '工序任务 id' })
  @IsOptional() @IsInt() @Min(1)
  workOrderOperationId?: number;

  @ApiProperty({ description: '问题描述', example: '贴片机报错 E-204' })
  @IsString() @Length(2, 200)
  description: string;
}

export class RespondAndonDto {
  @ApiPropertyOptional({ description: '响应备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class CloseAndonDto {
  @ApiProperty({ description: '处理结果（必填，关闭必须留痕）', example: '更换传感器后恢复' })
  @IsString() @Length(2, 500)
  resolution: string;
}

export class CancelAndonDto {
  @ApiProperty({ description: '取消原因' })
  @IsString() @Length(2, 200)
  reason: string;
}

export class ListNotificationDto {
  @ApiPropertyOptional({ description: '页码' })
  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ description: '按已读筛选', enum: ['read', 'unread'] })
  @IsOptional() @IsIn(['read', 'unread'])
  read?: 'read' | 'unread';
}
