import { Module } from '@nestjs/common';
import { WorkReportController, WorkOrderQrcodeController } from './work-report.controller';
import { WorkReportService } from './work-report.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { BoardModule } from '../board/board.module';

@Module({
  imports: [DispatchModule, BoardModule],
  controllers: [WorkReportController, WorkOrderQrcodeController],
  providers: [WorkReportService],
})
export class WorkReportModule {}
