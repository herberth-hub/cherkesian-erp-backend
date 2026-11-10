import { Module } from '@nestjs/common';
import { PilotosController } from './pilotos.controller';
import { PilotosService } from './pilotos.service';
import { ArquivosModule } from '../arquivos/arquivos.module';

@Module({
  imports: [ArquivosModule],
  controllers: [PilotosController],
  providers: [PilotosService],
  exports: [PilotosService],
})
export class PilotosModule {}
