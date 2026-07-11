import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotaFiscal, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { proximoSequencial } from '../common/utils/codigo.util';

/**
 * Integração de NF-e (SPEC §1: módulo isolado plugado na API).
 *
 * Provedores:
 *  - `focusnfe`: com FOCUS_NFE_TOKEN no ambiente, emite via API Focus NFe
 *    (https://focusnfe.com.br) no ambiente definido por NFE_AMBIENTE
 *    (homologacao|producao). Requer cadastro da empresa + certificado A1
 *    no painel do provedor.
 *  - `simulado`: sem token, gera a nota localmente (status `simulada`) com
 *    chave de acesso no formato oficial — o fluxo do ERP funciona ponta a
 *    ponta e passa a ser real apenas preenchendo as variáveis de ambiente.
 */
@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  listar(empresaId: number): Promise<NotaFiscal[]> {
    return this.prisma.notaFiscal.findMany({
      where: { empresaId },
      orderBy: { id: 'desc' },
    });
  }

  /** Emite NF-e para uma expedição (preenche Expedicao.nf ao autorizar). */
  async emitir(expedicaoId: number, empresaId: number, usuario: string): Promise<NotaFiscal> {
    const exp = await this.prisma.expedicao.findUnique({ where: { id: expedicaoId } });
    if (!exp) throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    }
    const jaEmitida = await this.prisma.notaFiscal.findFirst({
      where: { expedicaoId, status: { in: ['pendente', 'autorizada', 'simulada'] } },
    });
    if (jaEmitida) {
      throw new ConflictException(`Expedição já possui a nota ${jaEmitida.numero}.`);
    }

    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId } })
      : null;
    const valor = pedido?.valorTotal ?? new Prisma.Decimal(0);

    const existentes = await this.prisma.notaFiscal.findMany({ select: { numero: true } });
    const numero = proximoSequencial('NF', existentes.map((n) => n.numero), {
      pad: 6,
      separador: '-',
    });

    const token = this.config.get<string>('FOCUS_NFE_TOKEN');
    const emissao = token
      ? await this.emitirFocusNfe(token, numero, exp, cliente.nome, valor)
      : this.emitirSimulada(numero);

    const nota = await this.prisma.notaFiscal.create({
      data: {
        empresaId,
        expedicaoId,
        pedidoId: exp.pedidoId,
        numero,
        chave: emissao.chave,
        status: emissao.status,
        protocolo: emissao.protocolo,
        motivo: emissao.motivo,
        valor,
        provedor: emissao.provedor,
        emitidaPor: usuario,
      },
    });

    // NF autorizada/simulada vincula-se à expedição (rastreabilidade do envio).
    if (nota.status === 'autorizada' || nota.status === 'simulada') {
      await this.prisma.expedicao.update({
        where: { id: expedicaoId },
        data: { nf: nota.numero },
      });
    }
    return nota;
  }

  /** Chamada real à API Focus NFe (ativada pela presença do token). */
  private async emitirFocusNfe(
    token: string,
    ref: string,
    exp: { pecas: number },
    clienteNome: string,
    valor: Prisma.Decimal,
  ): Promise<{ chave: string | null; status: 'pendente' | 'autorizada' | 'rejeitada'; protocolo: string | null; motivo: string | null; provedor: string }> {
    const ambiente = this.config.get<string>('NFE_AMBIENTE') === 'producao' ? '' : 'homologacao.';
    const url = `https://${ambiente}focusnfe.com.br/v2/nfe?ref=${encodeURIComponent(ref)}`;
    try {
      // Payload mínimo — os dados fiscais completos (CFOP, NCM, endereços,
      // impostos por item) são configurados junto à contabilidade ao ativar.
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          natureza_operacao: 'Venda de mercadoria',
          presenca_comprador: 9,
          nome_destinatario: clienteNome,
          valor_total: valor.toFixed(2),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 202 || res.ok) {
        return {
          chave: (body['chave_nfe'] as string) ?? null,
          status: 'pendente', // autorização é assíncrona; consulta posterior atualiza
          protocolo: (body['protocolo'] as string) ?? null,
          motivo: 'Enviada ao provedor; aguardando autorização da SEFAZ.',
          provedor: 'focusnfe',
        };
      }
      return {
        chave: null,
        status: 'rejeitada',
        protocolo: null,
        motivo: `Focus NFe HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
        provedor: 'focusnfe',
      };
    } catch (err) {
      this.logger.error(`Falha na Focus NFe: ${String(err)}`);
      return {
        chave: null,
        status: 'rejeitada',
        protocolo: null,
        motivo: `Erro de comunicação com o provedor: ${String(err)}`,
        provedor: 'focusnfe',
      };
    }
  }

  /** Emissão simulada — chave/protocolo no formato oficial, status `simulada`. */
  private emitirSimulada(numero: string): { chave: string; status: 'simulada'; protocolo: string; motivo: string; provedor: string } {
    return {
      chave: this.gerarChaveSimulada(),
      status: 'simulada',
      protocolo: `SIM${Date.now()}`,
      motivo:
        'NF-e SIMULADA (sem valor fiscal). Defina FOCUS_NFE_TOKEN e NFE_AMBIENTE para emitir de verdade.',
      provedor: 'simulado',
    };
  }

  /** Chave de acesso com 44 dígitos (UF SP + AAMM + CNPJ zerado + modelo 55...). */
  private gerarChaveSimulada(): string {
    const agora = new Date();
    const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
    const aleatorio = () => Math.floor(Math.random() * 10);
    let chave = '35' + aamm + '00000000000000' + '55' + '001';
    while (chave.length < 44) chave += String(aleatorio());
    return chave.slice(0, 44);
  }
}
