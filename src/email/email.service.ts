import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EnvioEmail {
  para: string;
  assunto: string;
  texto: string;
  anexos?: Array<{ filename: string; content: Buffer; contentType?: string }>;
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
    const from =
      this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER');
    const info = await this.transporter.sendMail({
      from: `"GRUPO CHERKESIAN" <${from}>`,
      to: envio.para,
      subject: envio.assunto,
      text: envio.texto,
      attachments: envio.anexos,
    });
    return { enviado: true, simulado: false, detalhe: `messageId: ${info.messageId}` };
  }
}
