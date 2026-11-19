import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BoardService } from './board.service';

@ApiTags('board')
@ApiBearerAuth()
@Controller('board')
export class BoardController {
  constructor(private board: BoardService) {}

  @Get('summary')
  @Permissions('board:view')
  @ApiOperation({ summary: '看板初始化数据：当日产量/良率/在制工单数/设备状态分布' })
  summary(@Query('workCenterId') workCenterId?: number) {
    return this.board.summary(workCenterId ? Number(workCenterId) : undefined);
  }
}
