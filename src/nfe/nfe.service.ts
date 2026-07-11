import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cliente, Empresa, NotaFiscal, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Só dígitos (CNPJ/CPF/CEP/telefone). */
const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Integração de NF-e (SPEC §1 · módulo isolado plugado na API).
 *
 * Numeração: usa Empresa.nfeSerie + Empresa.nfeProximoNumero (para continuar
 * de onde o sistema anterior parou); incrementa a cada emissão bem-sucedida.
 *
 * Provedor: com FOCUS_NFE_TOKEN emite via Focus NFe (o emitente e o
 * certificado A1 ficam configurados no painel do provedor); sem token, gera
 * uma nota `simulada` e devolve o payload que SERIA enviado (para a
 * contabilidade revisar CST/CFOP/alíquotas antes de ir a produção).
 */
@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  listar(empresaId: number): Promise<NotaFiscal[]> {
    return this.prisma.notaFiscal.findMany({ where: { empresaId }, orderBy: { id: 'desc' } });
  }

  async emitir(expedicaoId: number, empresaId: number, usuario: string) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');

    const exp = await this.prisma.expedicao.findUnique({ where: { id: expedicaoId } });
    if (!exp) throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    }
    const jaEmitida = await this.prisma.notaFiscal.findFirst({
      where: { expedicaoId, status: { in: ['pendente', 'autorizada', 'simulada'] } },
    });
    if (jaEmitida) throw new ConflictException(`Expedição já possui a nota ${jaEmitida.numero}.`);

    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true } })
      : null;
    const itens = pedido?.itens ?? [];
    const valor = pedido?.valorTotal ?? new Prisma.Decimal(0);

    const token = this.config.get<string>('FOCUS_NFE_TOKEN');

    // Validação fiscal mínima só quando vai emitir DE VERDADE (com provedor).
    if (token) {
      const faltas = this.validarFiscal(empresa, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException(
          'Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.',
        );
      }
    }

    const serie = empresa.nfeSerie;
    const numeroSeq = empresa.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const payload = await this.montarPayload(empresa, cliente, exp, itens, serie, numeroSeq, valor);

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFE-${empresaId}-${serie}-${numeroSeq}`, payload)
      : this.emitirSimulada();

    // Rejeitada: não persiste nem consome número (a SEFAZ/provedor não aceitou).
    // Devolve a rejeição para o usuário corrigir (auditada pelo interceptor).
    if (emissao.status === 'rejeitada') {
      return {
        status: 'rejeitada' as const,
        numero: numeroNota,
        motivo: emissao.motivo,
        provedor: emissao.provedor,
        payloadPreview: token ? undefined : payload,
      };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          empresaId,
          expedicaoId,
          pedidoId: exp.pedidoId,
          numero: numeroNota,
          serie,
          chave: emissao.chave,
          status: emissao.status,
          protocolo: emissao.protocolo,
          motivo: emissao.motivo,
          valor,
          provedor: emissao.provedor,
          emitidaPor: usuario,
        },
      });
      // pendente/simulada: consome o número da sequência e vincula à expedição.
      await tx.empresa.update({
        where: { id: empresaId },
        data: { nfeProximoNumero: numeroSeq + 1 },
      });
      await tx.expedicao.update({ where: { id: expedicaoId }, data: { nf: criada.numero } });
      return criada;
    });

    // No modo simulado, devolve o payload para conferência da contabilidade.
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  // ===== Validação =====
  private validarFiscal(empresa: Empresa, cliente: Cliente, qtdItens: number): string[] {
    const f: string[] = [];
    if (!empresa.cnpj) f.push('CNPJ da empresa');
    if (!empresa.inscricaoEstadual) f.push('Inscrição Estadual da empresa');
    if (!empresa.municipio || !empresa.uf || !empresa.cep) f.push('Endereço fiscal da empresa');
    if (!cliente.cnpjCpf) f.push('CNPJ/CPF do cliente');
    if (!cliente.municipio || !cliente.uf || !cliente.cep) f.push('Endereço fiscal do cliente');
    if (qtdItens === 0) f.push('itens no pedido');
    return f;
  }

  // ===== Montagem do payload (formato Focus NFe) =====
  private async montarPayload(
    empresa: Empresa,
    cliente: Cliente,
    exp: { pecas: number },
    itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }>,
    serie: string,
    numero: number,
    valorTotal: Prisma.Decimal,
  ) {
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: itens.map((i) => i.produtoId).filter((x): x is number => !!x) } },
    });
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    const docDest = digitos(cliente.cnpjCpf);

    const items = itens.map((it, idx) => {
      const p = it.produtoId ? mapa.get(it.produtoId) : undefined;
      const bruto = it.valorUnit.mul(it.quantidade);
      return {
        numero_item: idx + 1,
        codigo_produto: p?.codigo ?? String(it.produtoId ?? idx + 1),
        descricao: it.descricao,
        cfop: p?.cfop ?? '5101',
        unidade_comercial: p?.unidadeComercial ?? 'UN',
        quantidade_comercial: it.quantidade,
        valor_unitario_comercial: Number(it.valorUnit.toFixed(2)),
        valor_bruto: Number(bruto.toFixed(2)),
        ncm: p?.ncm ?? '00000000',
        icms_origem: p?.origem ?? 0,
        icms_situacao_tributaria: p?.icmsCst ?? (empresa.crt === 3 ? '00' : '102'),
        icms_aliquota: p?.icmsAliquota ? Number(p.icmsAliquota) : undefined,
        pis_situacao_tributaria: p?.pisCst ?? '01',
        cofins_situacao_tributaria: p?.cofinsCst ?? '01',
      };
    });

    return {
      natureza_operacao: 'Venda de mercadoria',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1, // 1 = saída
      finalidade_emissao: 1, // 1 = normal
      presenca_comprador: 9,
      serie,
      numero,
      // Emitente (dados também configurados no painel do provedor)
      cnpj_emitente: digitos(empresa.cnpj),
      // Destinatário
      nome_destinatario: cliente.nome,
      [docDest.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: docDest,
      inscricao_estadual_destinatario: cliente.inscricaoEstadual || null,
      indicador_inscricao_estadual_destinatario: cliente.indicadorIE ?? 9,
      logradouro_destinatario: cliente.logradouro,
      numero_destinatario: cliente.numeroEndereco,
      bairro_destinatario: cliente.bairro,
      municipio_destinatario: cliente.municipio,
      uf_destinatario: cliente.uf,
      cep_destinatario: digitos(cliente.cep),
      valor_total: Number(valorTotal.toFixed(2)),
      volumes_quantidade: exp.pecas,
      items,
    };
  }

  // ===== Provedores =====
  private async emitirFocusNfe(token: string, ref: string, payload: unknown) {
    const ambiente = this.config.get<string>('NFE_AMBIENTE') === 'producao' ? '' : 'homologacao.';
    const url = `https://${ambiente}focusnfe.com.br/v2/nfe?ref=${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 202 || res.ok) {
        return {
          chave: (body['chave_nfe'] as string) ?? null,
          status: 'pendente' as const,
          protocolo: (body['protocolo'] as string) ?? null,
          motivo: 'Enviada ao provedor; aguardando autorização da SEFAZ.',
          provedor: 'focusnfe',
        };
      }
      return {
        chave: null,
        status: 'rejeitada' as const,
        protocolo: null,
        motivo: `Focus NFe HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`,
        provedor: 'focusnfe',
      };
    } catch (err) {
      this.logger.error(`Falha na Focus NFe: ${String(err)}`);
      return {
        chave: null,
        status: 'rejeitada' as const,
        protocolo: null,
        motivo: `Erro de comunicação com o provedor: ${String(err)}`,
        provedor: 'focusnfe',
      };
    }
  }

  private emitirSimulada() {
    return {
      chave: this.gerarChaveSimulada(),
      status: 'simulada' as const,
      protocolo: `SIM${Date.now()}`,
      motivo: 'NF-e SIMULADA (sem valor fiscal). Configure FOCUS_NFE_TOKEN + certificado A1 para emitir de verdade.',
      provedor: 'simulado',
    };
  }

  private gerarChaveSimulada(): string {
    const agora = new Date();
    const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
    let chave = '35' + aamm + '00000000000000' + '55' + '001';
    while (chave.length < 44) chave += String(Math.floor(Math.random() * 10));
    return chave.slice(0, 44);
  }
}
