import { Module } from '@nestjs/common';
import { AgenteController } from './agente.controller';
import { AgenteService } from './agente.service';

@Module({
  controllers: [AgenteController],
  providers: [AgenteService],
})
export class AgenteModule {}
