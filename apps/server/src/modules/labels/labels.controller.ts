import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { LabelsService } from './labels.service';

@ApiTags('labels')
@ApiBearerAuth()
@Controller('labels')
export class LabelsController {
  constructor(private labels: LabelsService) {}

  @Get('material/:id')
  @Permissions('label:print')
  @ApiOperation({ summary: '物料标签（qr=MAT:<code>）' })
  material(@Param('id') id: string) {
    return this.labels.material(Number(id));
  }

  @Get('work-order/:id')
  @Permissions('label:print')
  @ApiOperation({ summary: '工单标签（qr=WO:<code>，扫码进报工页）' })
  workOrder(@Param('id') id: string) {
    return this.labels.workOrder(Number(id));
  }

  @Get('lot/:lotNo')
  @Permissions('label:print')
  @ApiOperation({ summary: '批次标签（qr=LOT:<lotNo>）' })
  lot(@Param('lotNo') lotNo: string) {
    return this.labels.lot(lotNo);
  }

  @Get('batch')
  @Permissions('label:print')
  @ApiOperation({ summary: '批量取标签：?kind=material|work-order|lot&ids=1,2,3' })
  batch(@Query('kind') kind: 'material' | 'work-order' | 'lot', @Query('ids') ids: string) {
    return this.labels.batch(kind ?? 'lot', (ids ?? '').split(',').filter(Boolean));
  }
}
