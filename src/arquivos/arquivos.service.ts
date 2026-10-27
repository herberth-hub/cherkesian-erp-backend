import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Anexos fora do banco.
 *
 * Tudo no sistema (foto de produto, mockup, mapa de aplicação, boleto, canhoto,
 * OC) é gravado como data URI base64 na própria coluna. São 94 MB dos 131 MB do
 * banco — 72% — e foi o que estourou a cota do Neon.
 *
 * Aqui o anexo vai para um bucket S3-compatível (Cloudflare R2, Backblaze B2,
 * AWS S3) e a coluna guarda só uma REFERÊNCIA curta, `arq:<chave>`.
 *
 * Sem as variáveis de ambiente configuradas o serviço fica DESLIGADO e tudo
 * continua em base64, exatamente como hoje — a migração é por coluna, no ritmo
 * de quem opera.
 */
@Injectable()
export class ArquivosService {
  private readonly log = new Logger(ArquivosService.name);
  private readonly cliente: S3Client | null;
  private readonly bucket: string;
  /** Assina as URLs de leitura. Sem segredo próprio, cai no JWT. */
  private readonly segredo: string;

  constructor() {
    const endpoint = process.env.ARQUIVOS_ENDPOINT?.trim();
    const chave = process.env.ARQUIVOS_CHAVE?.trim();
    const secreta = process.env.ARQUIVOS_SEGREDO?.trim();
    this.bucket = process.env.ARQUIVOS_BUCKET?.trim() ?? '';
    this.segredo = process.env.ARQUIVOS_URL_SEGREDO?.trim() || process.env.JWT_SECRET?.trim() || '';

    if (endpoint && chave && secreta && this.bucket) {
      this.cliente = new S3Client({
        region: process.env.ARQUIVOS_REGIAO?.trim() || 'auto',
        endpoint,
        credentials: { accessKeyId: chave, secretAccessKey: secreta },
        forcePathStyle: true,
      });
      this.log.log(`Anexos no bucket "${this.bucket}".`);
    } else {
      this.cliente = null;
      this.log.log('Anexos continuam no banco (storage externo não configurado).');
    }
  }

  /** Há bucket configurado? Enquanto for false, nada muda no sistema. */
  get ligado(): boolean {
    return this.cliente !== null;
  }

  /** Referência de anexo no bucket (o que fica gravado na coluna).
   *  Devolve boolean em vez de type guard: como quase todo valor aqui já é
   *  `string`, um guard `v is string` estreitava o ramo negativo para `never`. */
  static ehReferencia(v: unknown): boolean {
    return typeof v === 'string' && v.startsWith('arq:');
  }

  static chaveDaReferencia(ref: string): string {
    return ref.slice(4);
  }

  /** Quebra um data URI em tipo + bytes. */
  static partesDoDataUri(dataUri: string): { tipo: string; bytes: Buffer } | null {
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(String(dataUri ?? ''));
    if (!m) return null;
    return { tipo: m[1], bytes: Buffer.from(m[2], 'base64') };
  }

  private static extensao(tipo: string): string {
    const mapa: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
      'application/zip': 'zip', 'application/xml': 'xml', 'text/xml': 'xml',
    };
    return mapa[tipo] ?? 'bin';
  }

  /**
   * Guarda um data URI no bucket e devolve `arq:<chave>`.
   * Com o storage desligado devolve o próprio data URI — quem chama grava o que
   * voltar, então o mesmo código serve nos dois modos.
   */
  async guardar(dataUri: string, pasta: string): Promise<string> {
    if (!this.cliente) return dataUri;
    const partes = ArquivosService.partesDoDataUri(dataUri);
    if (!partes) return dataUri; // não é anexo: devolve intacto
    const chave = `${pasta}/${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${ArquivosService.extensao(partes.tipo)}`;
    await this.cliente.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: chave,
      Body: partes.bytes,
      ContentType: partes.tipo,
    }));
    return `arq:${chave}`;
  }

  /** Bytes de um anexo, seja ele data URI ou referência de bucket. */
  async bytes(valor: string | null | undefined): Promise<{ tipo: string; bytes: Buffer } | null> {
    const v = String(valor ?? '').trim();
    if (!v) return null;
    if (!ArquivosService.ehReferencia(v)) return ArquivosService.partesDoDataUri(v);
    if (!this.cliente) throw new BadRequestException('Anexo está no bucket, mas o storage não está configurado.');
    const chave = ArquivosService.chaveDaReferencia(v);
    // Referência apontando para objeto que não existe é 404, não erro de
    // servidor: acontece quando a coluna sobreviveu ao arquivo. Quem chama
    // trata como "sem anexo" e a tela mostra "Sem foto" em vez de quebrar.
    const r = await this.cliente
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: chave }))
      .catch((e: { name?: string; $metadata?: { httpStatusCode?: number } }) => {
        if (e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
          throw new NotFoundException(`Anexo ${chave} não está mais no arquivo.`);
        }
        throw e;
      });
    const corpo = r.Body as unknown as AsyncIterable<Uint8Array> | undefined;
    if (!corpo) throw new NotFoundException(`Anexo ${chave} não encontrado.`);
    const pedacos: Buffer[] = [];
    for await (const p of corpo) pedacos.push(Buffer.from(p));
    return { tipo: r.ContentType ?? 'application/octet-stream', bytes: Buffer.concat(pedacos) };
  }

  /** Data URI de um anexo — para quem ainda espera base64 (telas e PDFs). */
  async dataUri(valor: string | null | undefined): Promise<string | null> {
    const v = String(valor ?? '').trim();
    if (!v) return null;
    if (!ArquivosService.ehReferencia(v)) return v;
    const a = await this.bytes(v);
    return a ? `data:${a.tipo};base64,${a.bytes.toString('base64')}` : null;
  }

  async remover(valor: string | null | undefined): Promise<void> {
    const v = String(valor ?? '').trim();
    if (!this.cliente || !ArquivosService.ehReferencia(v)) return;
    try {
      await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: ArquivosService.chaveDaReferencia(v) }));
    } catch (e) {
      // Anexo órfão no bucket é barato; falhar o salvamento por causa disso, não.
      this.log.warn(`Não consegui apagar ${v}: ${(e as Error).message}`);
    }
  }

  // ---------- URL assinada (para <img src>, que não manda cabeçalho) ----------

  private assinatura(chave: string, expira: number): string {
    return createHmac('sha256', this.segredo).update(`${chave}.${expira}`).digest('base64url');
  }

  /**
   * Link temporário de leitura. O `<img>` do navegador não manda Authorization,
   * então a autorização vai na própria URL: assinada, com validade, e sem
   * revelar nada sobre o conteúdo.
   */
  url(valor: string | null | undefined, minutos = 180): string | null {
    const v = String(valor ?? '').trim();
    if (!ArquivosService.ehReferencia(v)) return null;
    const chave = ArquivosService.chaveDaReferencia(v);
    const expira = Math.floor(Date.now() / 1000) + minutos * 60;
    return `/api/v1/arquivos/${encodeURI(chave)}?e=${expira}&a=${this.assinatura(chave, expira)}`;
  }

  conferirAssinatura(chave: string, expira: string, assinatura: string): boolean {
    const exp = Number(expira);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
    const esperado = Buffer.from(this.assinatura(chave, exp));
    const veio = Buffer.from(String(assinatura ?? ''));
    return esperado.length === veio.length && timingSafeEqual(esperado, veio);
  }
}
