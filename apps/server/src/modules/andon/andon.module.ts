import { Module } from '@nestjs/common';
import { AndonController, NotificationController } from './andon.controller';
import { AndonService } from './andon.service';
import { NotificationService } from './notification.service';
import { AndonEscalationTask } from './andon-escalation.task';
import { BoardModule } from '../board/board.module';

/**
 * 安灯模块（第 50-52 节）：import BoardModule 复用其导出的 BOARD_EVENT_BUS
 * （eventemitter2 CJS 直用，同第 48 节），业务不依赖 WebSocket。
 */
@Module({
  imports: [BoardModule],
  controllers: [AndonController, NotificationController],
  providers: [AndonService, NotificationService, AndonEscalationTask],
  exports: [AndonService],
})
export class AndonModule {}
