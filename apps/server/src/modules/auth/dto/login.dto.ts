import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: '用户名（自动去除首尾空格，区分大小写）', example: 'admin' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  username: string;

  @ApiProperty({ description: '密码（最长 72 字符，与 bcrypt 输入上限一致）', example: 'Admin@123' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;

  @ApiPropertyOptional({ description: '滑块验证挑战 id（连续 3 次密码错误后必填）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  captchaId?: string;

  @ApiPropertyOptional({ description: '滑块拖动的水平偏移（像素，连续 3 次密码错误后必填）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  captchaOffset?: number;
}
