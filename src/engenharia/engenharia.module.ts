import { Module } from '@nestjs/common';
import { EngenhariaController } from './engenharia.controller';
import { EngenhariaService } from './engenharia.service';

@Module({ controllers: [EngenhariaController], providers: [EngenhariaService], exports: [EngenhariaService] })
export class EngenhariaModule {}
