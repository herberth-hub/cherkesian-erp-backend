import { Module } from '@nestjs/common';
import { EmbalagensController } from './embalagens.controller';
import { EmbalagensService } from './embalagens.service';

@Module({ controllers: [EmbalagensController], providers: [EmbalagensService], exports: [EmbalagensService] })
export class EmbalagensModule {}
