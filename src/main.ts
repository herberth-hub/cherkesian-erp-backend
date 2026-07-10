import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  // Prefixo global /api/v1 (SPEC §2)
  app.setGlobalPrefix('api/v1');

  // Confia no proxy (Render/Railway) para capturar o IP real na auditoria.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Validação global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Envelope de erro padronizado
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS: em produção, defina CORS_ORIGIN (lista separada por vírgula); senão libera geral.
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  // 0.0.0.0 é obrigatório em PaaS (Render/Railway) para receber tráfego externo.
  const port = Number(config.get<string>('PORT')) || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Cherkesian ERP API rodando na porta ${port} (prefixo /api/v1)`, 'Bootstrap');
}

void bootstrap();
