import { Module } from '@nestjs/common';
import { BomController } from './bom.controller';
import { BomService } from './bom.service';
import { BomExplodeService } from './bom-explode.service';

@Module({
  controllers: [BomController],
  providers: [BomService, BomExplodeService],
  exports: [BomExplodeService],
})
export class BomModule {}
