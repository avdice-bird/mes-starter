import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '健康检查：服务与数据库是否可用' })
  async check() {
    await this.prisma.$queryRawUnsafe('SELECT 1');
    return { status: 'ok', db: 'ok', time: new Date().toISOString() };
  }
}
