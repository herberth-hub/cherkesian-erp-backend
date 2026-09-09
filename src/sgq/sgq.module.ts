import { Module } from '@nestjs/common';
import { SgqController } from './sgq.controller';
import { SgqService } from './sgq.service';

@Module({ controllers: [SgqController], providers: [SgqService], exports: [SgqService] })
export class SgqModule {}
