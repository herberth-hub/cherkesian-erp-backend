import { Module } from '@nestjs/common';
import { AnomaliasController } from './anomalias.controller';
import { AnomaliasService } from './anomalias.service';

@Module({
  // NotificacoesService é @Global — o aviso às áreas sai daqui sem import extra.
  controllers: [AnomaliasController],
  providers: [AnomaliasService],
  exports: [AnomaliasService],
})
export class AnomaliasModule {}
