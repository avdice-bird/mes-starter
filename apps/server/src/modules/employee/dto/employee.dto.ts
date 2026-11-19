import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ description: '工号（唯一）', example: 'EMP001' })
  @IsString() @Length(2, 32)
  code: string;

  @ApiProperty({ description: '姓名', example: '张三' })
  @IsString() @Length(1, 32)
  name: string;

  @ApiProperty({ description: '班组 id' })
  @IsInt() @Min(1)
  teamId: number;

  @ApiPropertyOptional({ description: '关联系统用户 id（可选；一个用户只能关联一个员工）' })
  @IsOptional() @IsInt() @Min(1)
  userId?: number;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @Length(1, 32)
  name?: string;

  @IsOptional() @IsInt() @Min(1)
  teamId?: number;

  @IsOptional() @IsInt() @Min(1)
  userId?: number;

  @IsOptional() @IsIn(['ACTIVE', 'LEFT'])
  status?: string;

  @IsOptional() @IsISO8601()
  leftAt?: string;
}

export class TransferEmployeeDto {
  @ApiProperty({ description: '目标班组 id' })
  @IsInt() @Min(1)
  toTeamId: number;
}

export class SkillDto {
  @ApiProperty({ description: '工序编码（与工作中心二选一）', example: 'OP10' })
  @IsOptional() @IsString() @Length(1, 32)
  opCode?: string;

  @ApiPropertyOptional({ description: '工作中心 id（与工序编码二选一）' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;

  @ApiProperty({ description: '技能等级 1-5' })
  @IsInt() @Min(1) @Max(5)
  level: number;
}
