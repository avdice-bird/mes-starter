import { Module } from '@nestjs/common';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { EquipmentStatusController } from './equipment-status.controller';
import { EquipmentStatusService } from './equipment-status.service';
import { EquipmentReportTask } from './equipment-report.task';
import { BoardModule } from '../board/board.module';

/**
 * 设备状态模块（第 46 节）。定时任务（equipment-report.task）在 test 环境跳过 cron 注册，
 * 避开 @nestjs/schedule 的 ESM 转换问题；日报生成幂等（upsert），测试走手动 generate 接口。
 */
@Module({
  imports: [BoardModule],
  controllers: [EquipmentController, EquipmentStatusController],
  providers: [EquipmentService, EquipmentStatusService, EquipmentReportTask],
})
export class EquipmentModule {}
