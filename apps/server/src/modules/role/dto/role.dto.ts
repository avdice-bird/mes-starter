import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ description: '角色编码，小写字母数字下划线，唯一', example: 'planner' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,31}$/, { message: '角色编码须为 2-32 位小写字母开头的字母数字下划线' })
  code: string;

  @ApiProperty({ description: '角色名称', example: '计划员' })
  @IsString()
  @Length(1, 32)
  name: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @Length(0, 200)
  remark?: string;
}

export class UpdateRoleDto extends PartialType(PickType(CreateRoleDto, ['name', 'remark'] as const)) {}

export class AssignPermissionsDto {
  @ApiProperty({ description: '分配的权限 id 列表（空数组表示清空权限）', example: [1, 2] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  permissionIds: number[];
}
