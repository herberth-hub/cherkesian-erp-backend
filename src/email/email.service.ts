import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EnvioEmail {
  para: string;
  assunto: string;
  texto: string;
  anexos?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  /** Nome exibido no "De:" — reflete a empresa/filial que emite o documento
   *  (ex.: "HC QUALITY CORPORATE", "YEREVAN CONFECÇÕES"). O endereço de envio
   *  continua o da conta SMTP (deliverability/SPF); só o rótulo muda. */
  remetenteNome?: string;
  /** Responder-para (opcional): e-mail da empresa/vendedor p/ a resposta do cliente. */
  replyTo?: string;
}

export interface ResultadoEnvio {
  enviado: boolean;
  simulado: boolean;
  detalhe: string;
}

/**
 * Integração de e-mail (SPEC §1: módulo isolado plugado na API).
 * Com SMTP_HOST/USER/PASS no ambiente envia de verdade (nodemailer);
 * sem credenciais opera em MODO SIMULADO: registra no log e responde ok,
 * permitindo validar o fluxo ponta a ponta antes de plugar o provedor.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('SMTP_PORT')) || 587,
        secure: Number(this.config.get<string>('SMTP_PORT')) === 465,
        auth: { user, pass },
        // Falha rápida e clara em problemas de rede (em vez de pendurar a request).
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
      this.logger.log(`SMTP configurado (${host}).`);
    } else {
      this.logger.warn('SMTP não configurado — e-mails em MODO SIMULADO.');
    }
  }

  get configurado(): boolean {
    return this.transporter !== null;
  }

  async enviar(envio: EnvioEmail): Promise<ResultadoEnvio> {
    if (!this.transporter) {
      this.logger.log(
        `[SIMULADO] E-mail para ${envio.para} · assunto "${envio.assunto}" · ` +
          `${envio.anexos?.length ?? 0} anexo(s).`,
      );
      return {
        enviado: true,
        simulado: true,
        detalhe:
          'SMTP não configurado — envio simulado. Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM para enviar de verdade.',
      };
    }
    // Se SMTP_FROM já vem no formato "Nome <email>", usa como está;
    // se for só o e-mail, adiciona o nome da marca.
    // Endereço de envio: sempre o da conta SMTP autenticada (SPF/DKIM). O NOME
    // exibido no "De:" reflete a empresa do documento (remetenteNome) quando
    // informado; senão cai no que estiver em SMTP_FROM ou "GRUPO CHERKESIAN".
    const fromEnv =
      this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER') || '';
    const enderecoEnvio = /<([^>]+)>/.exec(fromEnv)?.[1] || fromEnv;
    const nome = (envio.remetenteNome || '').replace(/"/g, '').trim();
    const from = nome
      ? `"${nome}" <${enderecoEnvio}>`
      : fromEnv.includes('<')
        ? fromEnv
        : `"GRUPO CHERKESIAN" <${fromEnv}>`;
    const info = await this.transporter.sendMail({
      from,
      to: envio.para,
      replyTo: envio.replyTo || undefined,
      subject: envio.assunto,
      text: envio.texto,
      attachments: envio.anexos,
    });
    return { enviado: true, simulado: false, detalhe: `messageId: ${info.messageId}` };
  }
}
