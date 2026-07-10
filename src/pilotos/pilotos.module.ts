import { Module } from '@nestjs/common';
import { PilotosController } from './pilotos.controller';
import { PilotosService } from './pilotos.service';

@Module({
  controllers: [PilotosController],
  providers: [PilotosService],
  exports: [PilotosService],
})
export class PilotosModule {}
