import { Module } from '@nestjs/common';
import { ProductionOrderController, ScheduleController, WorkOrderController } from './schedule.controller';
import { ProductionOrderService } from './production-order.service';
import { SchedulerService } from './scheduler.service';
import { WorkOrderService } from './work-order.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { BoardModule } from '../board/board.module';

@Module({
  imports: [DispatchModule, BoardModule],
  controllers: [ProductionOrderController, WorkOrderController, ScheduleController],
  providers: [ProductionOrderService, WorkOrderService, SchedulerService],
})
export class ScheduleModule {}
