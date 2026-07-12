import { Module } from '@nestjs/common';
import { FiliaisController } from './filiais.controller';
import { FiliaisService } from './filiais.service';

@Module({
  controllers: [FiliaisController],
  providers: [FiliaisService],
  exports: [FiliaisService],
})
export class FiliaisModule {}
