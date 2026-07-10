import { Module } from '@nestjs/common';
import { ExpedicoesController } from './expedicoes.controller';
import { ExpedicoesService } from './expedicoes.service';

@Module({
  controllers: [ExpedicoesController],
  providers: [ExpedicoesService],
  exports: [ExpedicoesService],
})
export class ExpedicoesModule {}
