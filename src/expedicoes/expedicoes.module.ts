import { Module } from '@nestjs/common';
import { ExpedicoesController } from './expedicoes.controller';
import { ExpedicoesService } from './expedicoes.service';
import { BancosModule } from '../bancos/bancos.module';

@Module({
  // Cobrança de expedição despachada sem NF pode sair em boleto (remessa CNAB).
  imports: [BancosModule],
  controllers: [ExpedicoesController],
  providers: [ExpedicoesService],
  exports: [ExpedicoesService],
})
export class ExpedicoesModule {}
