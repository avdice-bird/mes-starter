import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from './page-query.dto';

/**
 * 各模块列表查询 DTO：继承 PageQueryDto（page/pageSize/keyword 校验齐），
 * 补充本模块的筛选字段。替换控制器里的内联类型——内联类型不参与
 * class-validator 校验，字符串分页参数会直达 Prisma take 造成 500。
 */

export class TeamListQueryDto extends PageQueryDto {}

export class ShiftListQueryDto extends PageQueryDto {}

export class EmployeeListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '在职状态', enum: ['ACTIVE', 'LEFT'] })
  @IsOptional() @IsIn(['ACTIVE', 'LEFT'])
  status?: 'ACTIVE' | 'LEFT';

  @ApiPropertyOptional({ description: '班组 id' })
  @IsOptional() @IsInt() @Min(1)
  teamId?: number;
}

export class EquipmentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;
}

export class ProductionOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '订单状态', enum: ['DRAFT', 'PLANNED', 'RELEASED', 'COMPLETED', 'CANCELLED'] })
  @IsOptional() @IsIn(['DRAFT', 'PLANNED', 'RELEASED', 'COMPLETED', 'CANCELLED'])
  status?: string;
}

export class WorkOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '工单状态' })
  @IsOptional() @IsString() @Length(1, 20)
  status?: string;

  @ApiPropertyOptional({ description: '工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;

  @ApiPropertyOptional({ description: '仅看延误：1 = 是（前端开关传 1）', enum: ['1', '0'] })
  @IsOptional() @IsIn(['1', '0'])
  delayed?: '1' | '0';
}

export class InspectionListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '检验类型', enum: ['IQC', 'IPQC', 'FQC'] })
  @IsOptional() @IsIn(['IQC', 'IPQC', 'FQC'])
  type?: string;

  @ApiPropertyOptional({ description: '检验结果', enum: ['PENDING', 'PASS', 'FAIL', 'CONCESSION'] })
  @IsOptional() @IsIn(['PENDING', 'PASS', 'FAIL', 'CONCESSION'])
  result?: string;
}

export class DefectCodeListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '状态：1 启用 / 0 停用' })
  @IsOptional() @IsInt() @IsIn([0, 1])
  status?: number;
}

export class InventoryBalanceQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '仓库 id' })
  @IsOptional() @IsInt() @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({ description: '物料 id' })
  @IsOptional() @IsInt() @Min(1)
  materialId?: number;
}

export class InventoryTransactionQueryDto extends InventoryBalanceQueryDto {
  @ApiPropertyOptional({ description: '工单 id' })
  @IsOptional() @IsInt() @Min(1)
  workOrderId?: number;

  @ApiPropertyOptional({ description: '流水类型' })
  @IsOptional() @IsString() @Length(1, 20)
  type?: string;
}

export class LotListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '物料 id' })
  @IsOptional() @IsInt() @Min(1)
  materialId?: number;
}

export class MaterialIssueListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '工单 id' })
  @IsOptional() @IsInt() @Min(1)
  workOrderId?: number;
}

export class DowntimeQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '设备 id' })
  @IsOptional() @IsInt() @Min(1)
  equipmentId?: number;
}

export class DailyReportQueryDto extends DowntimeQueryDto {
  @ApiPropertyOptional({ description: '日期 yyyy-MM-dd' })
  @IsOptional() @IsString() @Length(10, 10)
  date?: string;
}

export class ScheduleViewQueryDto {
  @ApiPropertyOptional({ description: '起始日期 yyyy-MM-dd' })
  @IsOptional() @IsString() @Length(10, 10)
  from?: string;

  @ApiPropertyOptional({ description: '结束日期 yyyy-MM-dd' })
  @IsOptional() @IsString() @Length(10, 10)
  to?: string;
}

// ================= 写操作 body DTO（替换控制器内联类型，让 class-validator 生效） =================
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsPositive, MaxLength } from 'class-validator';

export class ChangeStatusDto {
  @ApiProperty({ description: '目标状态', enum: ['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE'] })
  @IsIn(['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE'])
  status!: string;

  @ApiPropertyOptional({ description: '原因' })
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class CreateDowntimeDto {
  @ApiProperty({ description: '设备 id' })
  @IsInt() @Min(1)
  equipmentId!: number;

  @ApiProperty({ description: '停机原因代码（字典 downtime_reason）' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  reasonCode!: string;

  @ApiProperty({ description: '开始时间 ISO' })
  @IsDateString()
  startedAt!: string;

  @ApiPropertyOptional({ description: '结束时间 ISO；不传 = 未结束' })
  @IsOptional() @IsDateString()
  endedAt?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @MaxLength(200)
  remark?: string;
}

export class GenerateDailyReportDto {
  @ApiProperty({ description: '日期 yyyy-MM-dd' })
  @IsString() @IsNotEmpty() @MaxLength(10)
  date!: string;
}

export class DefectCodeCreateDto {
  @ApiProperty({ description: '编码', example: 'DF-WELD' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  code!: string;

  @ApiProperty({ description: '名称' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  name!: string;

  @ApiProperty({ description: '分类' })
  @IsString() @IsNotEmpty() @MaxLength(30)
  category!: string;

  @ApiProperty({ description: '严重度', enum: ['CRITICAL', 'MAJOR', 'MINOR'] })
  @IsIn(['CRITICAL', 'MAJOR', 'MINOR'])
  severity!: string;
}

export class DefectCodeUpdateDto {
  @ApiPropertyOptional({ description: '名称' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: '分类' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(30)
  category?: string;

  @ApiPropertyOptional({ description: '严重度', enum: ['CRITICAL', 'MAJOR', 'MINOR'] })
  @IsOptional() @IsIn(['CRITICAL', 'MAJOR', 'MINOR'])
  severity?: string;

  @ApiPropertyOptional({ description: '状态：1 启用 / 0 停用' })
  @IsOptional() @IsInt() @IsIn([0, 1])
  status?: number;
}

export class InventoryAdjustDto {
  @ApiProperty({ description: '仓库 id' })
  @IsInt() @Min(1)
  warehouseId!: number;

  @ApiProperty({ description: '物料 id' })
  @IsInt() @Min(1)
  materialId!: number;

  @ApiProperty({ description: '批次 id' })
  @IsInt() @Min(1)
  lotId!: number;

  @ApiProperty({ description: '调整数量（正增负减，非 0）' })
  @IsInt()
  @Min(-1_000_000) @Max(1_000_000)
  qty!: number;

  @ApiProperty({ description: '调整原因' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  reason!: string;
}

export class ReceiptDto {
  @ApiProperty({ description: '入库数量（>0）' })
  @IsInt() @IsPositive() @Max(1_000_000)
  qty!: number;

  @ApiProperty({ description: '仓库 id' })
  @IsInt() @Min(1)
  warehouseId!: number;
}

export class ReturnMaterialDto {
  @ApiProperty({ description: '领料明细 id' })
  @IsInt() @Min(1)
  issueItemId!: number;

  @ApiProperty({ description: '退回批次 id' })
  @IsInt() @Min(1)
  lotId!: number;

  @ApiProperty({ description: '退料数量（>0）' })
  @IsInt() @IsPositive() @Max(1_000_000)
  qty!: number;

  @ApiProperty({ description: '仓库 id' })
  @IsInt() @Min(1)
  warehouseId!: number;
}
