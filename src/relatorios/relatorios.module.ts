import { Module } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
// O pacote de XMLs da competência reusa o download da Focus que já existe na NF-e.
import { NfeModule } from '../nfe/nfe.module';

@Module({
  imports: [NfeModule],
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
})
export class RelatoriosModule {}
