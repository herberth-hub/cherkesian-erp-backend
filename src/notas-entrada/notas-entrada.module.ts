import { Module } from '@nestjs/common';
import { NotasEntradaService } from './notas-entrada.service';
import { NotasEntradaController } from './notas-entrada.controller';

@Module({
  controllers: [NotasEntradaController],
  providers: [NotasEntradaService],
})
export class NotasEntradaModule {}
