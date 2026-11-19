import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const PATH_RE = /^\/[a-zA-Z0-9\-/]{0,98}$/;

export class CreateMenuDto {
  @ApiPropertyOptional({ description: '父菜单 id；空表示顶级目录', example: null })
  @IsOptional() @IsInt() @Min(1)
  parentId?: number | null;

  @ApiProperty({ description: '前端路由路径，以 / 开头且全局唯一', example: '/system/users' })
  @IsString()
  @Matches(PATH_RE, { message: '路径须以 / 开头，只含字母数字-/' })
  path: string;

  @ApiProperty({ description: '菜单名称', example: '用户管理' })
  @IsString() @Length(1, 32)
  name: string;

  @ApiPropertyOptional({ description: '图标名（Element Plus 图标组件名）', example: 'User' })
  @IsOptional() @IsString() @Length(1, 32)
  icon?: string | null;

  @ApiPropertyOptional({ description: '前端组件路径（相对 src/views，不含扩展名），目录节点留空', example: 'user/UserList' })
  @IsOptional() @IsString() @Length(1, 98)
  component?: string | null;

  @ApiPropertyOptional({ description: '绑定的权限码；目录节点留空（登录即可见）', example: 'user:view' })
  @IsOptional() @IsString() @Length(1, 64)
  permissionCode?: string | null;

  @ApiPropertyOptional({ description: '同级排序，小的在前', example: 1 })
  @IsOptional() @IsInt() @Min(0) @Max(9999)
  sort?: number;
}

export class UpdateMenuDto extends PartialType(CreateMenuDto) {}
