import { Module } from '@nestjs/common';
import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';
import { BomModule } from '../bom/bom.module';
import { RoutingModule } from '../routing/routing.module';
import { BomExplodeService } from '../bom/bom-explode.service';
import { RoutingService } from '../routing/routing.service';

@Module({
  imports: [BomModule, RoutingModule],
  controllers: [MaterialController],
  providers: [MaterialService, BomExplodeService, RoutingService],
})
export class MaterialModule {}
