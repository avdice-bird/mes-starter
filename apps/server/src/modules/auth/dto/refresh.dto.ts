import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: '刷新令牌（64 位十六进制随机串）' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  refreshToken: string;
}
