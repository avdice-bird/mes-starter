import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ description: '班组编码', example: 'TEAM-A' })
  @IsString() @Length(2, 32)
  code: string;

  @ApiProperty({ description: '班组名称', example: '早班组' })
  @IsString() @Length(1, 32)
  name: string;

  @ApiProperty({ description: '所属工作中心 id' })
  @IsInt() @Min(1)
  workCenterId: number;

  @ApiPropertyOptional({ description: '组长员工 id（必须属于本班组）' })
  @IsOptional() @IsInt() @Min(1)
  leaderId?: number;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ description: '班组名称' })
  @IsOptional() @IsString() @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '所属工作中心 id' })
  @IsOptional() @IsInt() @Min(1)
  workCenterId?: number;

  @IsOptional() @IsInt() @Min(1)
  leaderId?: number;
}
