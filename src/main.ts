import { setDefaultResultOrder } from 'dns';
import { NestFactory } from '@nestjs/core';

// Prefere IPv4 na resolução DNS: containers PaaS (Render) sem rota IPv6 de
// saída falham com ENETUNREACH ao conectar em hosts dual-stack (ex.: Gmail SMTP).
setDefaultResultOrder('ipv4first');
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded, Request, Response, NextFunction } from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  // bodyParser desligado para injetarmos parsers com LIMITE de tamanho (anti-DoS).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  const config = app.get(ConfigService);

  // Corpo limitado a 16 MB: acomoda as fotos (base64) + o arquivo de modelagem
  // (Audaces .adsx/.zip) da ficha técnica; ainda barra payloads abusivos (anti-DoS).
  app.use(json({ limit: '16mb' }));
  app.use(urlencoded({ extended: true, limit: '16mb' }));

  // ===== Compressão (gzip) =====
  // O frontend é um HTML único grande e algumas listas são pesadas (o estoque
  // devolve TODAS as etiquetas p/ a busca cobrir 100% do acervo: ~1,8 MB que
  // viram ~40 KB comprimidos). Precisa vir ANTES do ServeStatic (registrado no
  // app.init/listen) para também comprimir o index.html.
  app.use(compression());

  // ===== Portal do Cliente por subdomínio =====
  // Quando o site é acessado por um host de portal (ex.: portal.hcqualitycorp.com.br),
  // a RAIZ abre o Portal do Cliente (public/portal.html) em vez do ERP admin
  // (index.html). Configure PORTAL_HOSTS no Render (lista separada por vírgula);
  // o default já aponta para o subdomínio. Só reescreve a raiz — /api/v1 e os demais
  // arquivos estáticos passam intactos. Roda antes do ServeStatic (registrado no
  // app.init/listen), então a reescrita acontece a tempo.
  const portalHosts = (config.get<string>('PORTAL_HOSTS') || 'portal.hcqualitycorp.com.br')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (portalHosts.includes(host) && (req.url === '/' || req.url === '' || req.url === '/index.html')) {
      req.url = '/portal.html';
    }
    next();
  });

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
          // PDFs (pedido/proposta/relatórios) abrem em janela interna via blob: — libera frame/object.
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'self'", 'blob:'],
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
