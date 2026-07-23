import { Module } from '@nestjs/common';
import { BiController } from './bi.controller';
import { BiService } from './bi.service';

@Module({
  controllers: [BiController],
  providers: [BiService],
})
export class BiModule {}
