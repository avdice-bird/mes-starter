import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { BoardGateway } from './board.gateway';
import { BoardService } from './board.service';
import { BOARD_EVENT_BUS, BoardEventBus } from './board.events';

/**
 * 事件总线：@nestjs/event-emitter 是 ESM（Jest CJS 不兼容），
 * 用其底层依赖 eventemitter2（CJS）直接提供等价能力（on/emit）。
 */
@Module({
  controllers: [BoardController],
  exports: [BOARD_EVENT_BUS, BoardGateway],
  providers: [
    BoardService,
    BoardGateway,
    { provide: BOARD_EVENT_BUS, useValue: new BoardEventBus() },
  ],
})
export class BoardModule {}
