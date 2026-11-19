import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Request } from 'express';
import { ApiProperty } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AiService } from './ai.service';

class AiQueryDto {
  @ApiProperty({ description: '自然语言问题', example: '本周良率最低的工序是哪个' })
  @IsString() @Length(1, 2000)
  question: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private ai: AiService) {}

  @Post('query')
  @Permissions('ai:query')
  @ApiOperation({ summary: '自然语言查询生产数据（只读工具，10 次/分钟）' })
  query(@Body() dto: AiQueryDto, @Req() req: Request & { user: { id: number; username: string } }) {
    this.ai.assertRateLimit(req.user.id); // 10 次/分钟（第 56 节限额；先于 LLM 调用省钱）
    return this.ai.query(req.user.id, dto.question);
  }
}
