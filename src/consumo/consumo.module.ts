import { Module } from '@nestjs/common';
import { ConsumoController } from './consumo.controller';
import { ConsumoService } from './consumo.service';

@Module({
  controllers: [ConsumoController],
  providers: [ConsumoService],
  exports: [ConsumoService],
})
export class ConsumoModule {}
