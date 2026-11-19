import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AssignOperationDto {
  @ApiPropertyOptional({ description: '班组 id（员工必须属于该班组）' })
  @IsOptional() @IsInt() @Min(1)
  teamId?: number;

  @ApiPropertyOptional({ description: '员工 id（需有该工序/工作中心技能，第 35 节校验）' })
  @IsOptional() @IsInt() @Min(1)
  employeeId?: number;

  @ApiPropertyOptional({ description: '设备 id（必须属于该工序的工作中心）' })
  @IsOptional() @IsInt() @Min(1)
  equipmentId?: number;
}

export class CompleteQtyDto {
  @ApiProperty({ description: '本次良品数', example: 50 })
  @IsInt() @Min(1) @Max(10_000_000)
  qty: number;

  @ApiPropertyOptional({ description: '本次不良数' })
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  defectQty?: number;
}
