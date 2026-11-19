import { Module } from '@nestjs/common';
import { InventoryController, LotsController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { TraceService } from './trace.service';
import { BomModule } from '../bom/bom.module';

@Module({
  imports: [BomModule],
  controllers: [InventoryController, LotsController],
  providers: [InventoryService, TraceService],
  exports: [InventoryService],
})
export class InventoryModule {}
