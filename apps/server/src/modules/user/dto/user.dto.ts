import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class CreateUserDto {
  @ApiProperty({ description: '用户名，字母数字下划线，登录用', example: 'zhangsan' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{2,32}$/, { message: '用户名须为 2-32 位字母数字下划线' })
  username: string;

  @ApiProperty({ description: '初始密码，8-32 位', example: 'User@123' })
  @IsString()
  @Length(8, 32, { message: '密码长度须为 8-32 位' })
  password: string;

  @ApiProperty({ description: '姓名（显示用）', example: '张三' })
  @IsString()
  @Length(1, 32)
  name: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '姓名（显示用）', example: '张三' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  name?: string;

  @ApiPropertyOptional({ description: '重置密码，8-32 位；不传则不修改', example: 'NewPass@123' })
  @IsOptional()
  @IsString()
  @Length(8, 32, { message: '密码长度须为 8-32 位' })
  password?: string;

  @ApiPropertyOptional({ description: '状态：1=启用 0=停用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number;
}

export class QueryUserDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '关键字：匹配用户名或姓名' })
  @IsOptional() @IsString() @Length(0, 50)
  declare keyword?: string;
}

export class AssignRolesDto {
  @ApiProperty({ description: '分配的角色 id 列表（空数组表示清空角色）', example: [2, 3] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds: number[];
}
