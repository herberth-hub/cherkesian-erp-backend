import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { NfeModule } from '../nfe/nfe.module';

@Module({
  imports: [NfeModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
