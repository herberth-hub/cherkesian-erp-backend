import { Module } from '@nestjs/common';
import { RetalhosController } from './retalhos.controller';
import { RetalhosService } from './retalhos.service';

@Module({
  controllers: [RetalhosController],
  providers: [RetalhosService],
  exports: [RetalhosService],
})
export class RetalhosModule {}
