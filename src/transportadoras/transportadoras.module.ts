import { Module } from '@nestjs/common';
import { TransportadorasController } from './transportadoras.controller';
import { TransportadorasService } from './transportadoras.service';

@Module({
  controllers: [TransportadorasController],
  providers: [TransportadorasService],
  exports: [TransportadorasService],
})
export class TransportadorasModule {}
