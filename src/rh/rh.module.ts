import { Module } from '@nestjs/common';
import { RhController } from './rh.controller';
import { RhService } from './rh.service';

@Module({
  controllers: [RhController],
  providers: [RhService],
  exports: [RhService],
})
export class RhModule {}
