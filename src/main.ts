import { setDefaultResultOrder } from 'dns';
import { NestFactory } from '@nestjs/core';

// Prefere IPv4 na resolução DNS: containers PaaS (Render) sem rota IPv6 de
// saída falham com ENETUNREACH ao conectar em hosts dual-stack (ex.: Gmail SMTP).
setDefaultResultOrder('ipv4first');
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  // bodyParser desligado para injetarmos parsers com LIMITE de tamanho (anti-DoS).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  const config = app.get(ConfigService);

  // Corpo limitado a 8 MB: acomoda as fotos (base64) da ficha técnica do produto,
  // comprimidas no cliente; ainda barra payloads abusivos (anti-DoS).
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  // ===== Cabeçalhos de segurança (Helmet) =====
  // CSP sob medida: o frontend é um único HTML com scripts/estilos inline e
  // handlers onclick, então script/style precisam de 'unsafe-inline'. Tudo o
  // mais é travado em 'self' (sem recursos externos; API é same-origin).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'"],
          // handlers inline (onclick=...) são usados no frontend single-file.
          'script-src-attr': ["'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'self'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Prefixo global /api/v1 (SPEC §2)
  app.setGlobalPrefix('api/v1');

  // Confia no proxy (Render/Railway) para capturar o IP real (auditoria + rate limit).
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
