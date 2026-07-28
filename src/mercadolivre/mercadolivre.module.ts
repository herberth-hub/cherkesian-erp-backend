import { Module } from '@nestjs/common';
import { MercadoLivreService } from './mercadolivre.service';
import { MercadoLivreController } from './mercadolivre.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MercadoLivreController],
  providers: [MercadoLivreService],
  exports: [MercadoLivreService],
})
export class MercadoLivreModule {}
