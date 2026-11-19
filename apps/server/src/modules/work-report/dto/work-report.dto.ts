import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateWorkReportDto {
  @ApiProperty({ description: '工序任务 id', example: 1 })
  @IsInt() @Min(1)
  workOrderOperationId: number;

  @ApiProperty({ description: '报工员工 id（操作工本人，从 token 不可取——车间可代报）', example: 1 })
  @IsInt() @Min(1)
  employeeId: number;

  @ApiProperty({ description: '良品数（≥0，两者之和 >0）', example: 30 })
  @IsInt() @Min(0) @Max(10_000_000)
  goodQty: number;

  @ApiProperty({ description: '不良品数（≥0，两者之和 >0）', example: 2 })
  @IsInt() @Min(0) @Max(10_000_000)
  defectQty: number;

  @ApiPropertyOptional({ description: '工时（分钟，≥0）', example: 30 })
  @IsOptional() @IsInt() @Min(0) @Max(1440)
  workMinutes?: number;

  @ApiPropertyOptional({ description: '报工时刻（ISO，缺省服务器当前；未来/早于下达 → 400）' })
  @IsOptional() @IsISO8601()
  reportedAt?: string;

  @ApiProperty({ description: '幂等键：客户端生成（表单打开时），重复提交返回同一条', example: 'web-2026-10-09-abc123' })
  @IsString() @Length(8, 64)
  idempotencyKey: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class ReverseWorkReportDto {
  @ApiProperty({ description: '撤销原因（必填）', example: '录错数量' })
  @IsString() @Length(1, 200)
  reason: string;
}
