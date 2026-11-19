import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolExecutor } from './ai-tool-executor.service';
import { ReportsModule } from '../reports/reports.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AndonModule } from '../andon/andon.module';
import { ShiftModule } from '../shift/shift.module';

/** AI 查询（第 56 节）：复用报表/库存/安灯/班次 Service 作为只读工具——LLM 不碰数据库。 */
@Module({
  imports: [ReportsModule, InventoryModule, AndonModule, ShiftModule],
  controllers: [AiController],
  providers: [AiService, AiToolExecutor],
})
export class AiModule {}
