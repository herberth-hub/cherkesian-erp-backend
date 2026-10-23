import { Global, Module } from '@nestjs/common';
import { ArquivosService } from './arquivos.service';
import { ArquivosController } from './arquivos.controller';

/** Global: quase todo módulo guarda ou lê algum anexo. */
@Global()
@Module({
  controllers: [ArquivosController],
  providers: [ArquivosService],
  exports: [ArquivosService],
})
export class ArquivosModule {}
