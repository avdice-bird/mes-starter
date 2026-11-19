import { Module } from '@nestjs/common';
import { InspectionController, DefectCodeController } from './inspection.controller';
import { InspectionService } from './inspection.service';

@Module({
  controllers: [InspectionController, DefectCodeController],
  providers: [InspectionService],
  exports: [InspectionService],
})
export class InspectionModule {}
