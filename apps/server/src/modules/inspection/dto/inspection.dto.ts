import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsIn, Length, Max, Min, ValidateNested,
} from 'class-validator';

export class CreateInspectionDto {
  @ApiProperty({ description: '检验类型：IQC 来料 / IPQC 过程 / FQC 成品', enum: ['IQC', 'IPQC', 'FQC'] })
  @IsIn(['IQC', 'IPQC', 'FQC'])
  type: 'IQC' | 'IPQC' | 'FQC';

  @ApiProperty({ description: '关联对象类型：LOT 批次 / OPERATION 工序任务 / WORK_ORDER 工单', enum: ['LOT', 'OPERATION', 'WORK_ORDER'] })
  @IsIn(['LOT', 'OPERATION', 'WORK_ORDER'])
  refType: 'LOT' | 'OPERATION' | 'WORK_ORDER';

  @ApiProperty({ description: '关联对象 id', example: 1 })
  @IsInt() @Min(1)
  refId: number;

  @ApiProperty({ description: '抽样数量（≥0，待检）', example: 10 })
  @IsInt() @Min(0) @Max(10_000_000)
  sampleQty: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SubmitDefectDto {
  @ApiProperty({ description: '缺陷代码 id' })
  @IsInt() @Min(1)
  defectCodeId: number;

  @ApiProperty({ description: '该缺陷数量（>0）' })
  @IsInt() @Min(1) @Max(10_000_000)
  qty: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class SubmitInspectionDto {
  @ApiProperty({ description: '合格数量' })
  @IsInt() @Min(0) @Max(10_000_000)
  passQty: number;

  @ApiProperty({ description: '不合格数量' })
  @IsInt() @Min(0) @Max(10_000_000)
  failQty: number;

  @ApiProperty({ description: '缺陷明细（failQty > 0 时必填，Σqty = failQty）', type: [SubmitDefectDto] })
  @IsOptional() @IsArray() @ArrayMinSize(0) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SubmitDefectDto)
  defects: SubmitDefectDto[];

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class DispositionDto {
  @ApiProperty({ description: '处理方式：REWORK 返工 / SCRAP 报废 / CONCESSION 让步接收', enum: ['REWORK', 'SCRAP', 'CONCESSION'] })
  @IsIn(['REWORK', 'SCRAP', 'CONCESSION'])
  disposition: 'REWORK' | 'SCRAP' | 'CONCESSION';

  @ApiProperty({ description: '处理原因（必填）' })
  @IsString() @Length(1, 200)
  reason: string;
}
