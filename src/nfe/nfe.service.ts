import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cliente, Filial, NFeStatus, NotaFiscal, Prisma } from '@prisma/client';
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

    // Emitente = filial do pedido; se não houver, a matriz da empresa.
    let filial = pedido?.filialId
      ? await this.prisma.filial.findUnique({ where: { id: pedido.filialId } })
      : null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado. Cadastre a matriz em Filiais (Config. Fiscal).');

    // Token: o da filial tem prioridade; senão, o global do ambiente.
    const token = filial.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');

    // Validação fiscal mínima só quando vai emitir DE VERDADE (com provedor).
    if (token) {
      const faltas = this.validarFiscal(filial, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException(
          'Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.',
        );
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const infoAdic = pedido?.ordemCompraCliente ? `Pedido de compra do cliente: ${pedido.ordemCompraCliente}` : undefined;
    const payload = await this.montarPayload(filial, cliente, exp, itens, serie, numeroSeq, valor, infoAdic);

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFE-${filial.id}-${serie}-${numeroSeq}`, payload)
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
          filialId: filial.id,
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
          ordemCompraCliente: pedido?.ordemCompraCliente,
          emitidaPor: usuario,
        },
      });
      // pendente/simulada: consome o número da sequência DA FILIAL e vincula à expedição.
      await tx.filial.update({
        where: { id: filial.id },
        data: { nfeProximoNumero: numeroSeq + 1 },
      });
      await tx.expedicao.update({ where: { id: expedicaoId }, data: { nf: criada.numero } });
      return criada;
    });

    // No modo simulado, devolve o payload para conferência da contabilidade.
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * NF-e AVULSA — emite sem expedição/pedido: escolhe o cliente e os itens
   * direto. Mesma numeração e validação fiscal da emissão normal.
   */
  async emitirAvulsa(
    dto: { clienteId: number; filialId?: number; itens: Array<{ produtoId?: number; descricao?: string; quantidade: number; valorUnit: number }>; naturezaOperacao?: string; ordemCompraCliente?: string },
    empresaId: number,
    usuario: string,
  ) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${dto.clienteId} não encontrado.`);
    }

    // Emitente = filial informada (validada) ou a matriz.
    let filial = dto.filialId
      ? await this.prisma.filial.findUnique({ where: { id: dto.filialId } })
      : null;
    if (filial && filial.empresaId !== empresaId) filial = null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado. Cadastre a matriz em Filiais (Config. Fiscal).');

    // Resolve itens (valida produto, herda descrição/dados fiscais) e soma o total.
    const itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }> = [];
    let valor = new Prisma.Decimal(0);
    let totalQtd = 0;
    for (const it of dto.itens) {
      let descricao = it.descricao;
      if (it.produtoId) {
        const produto = await this.prisma.produto.findUnique({ where: { id: it.produtoId } });
        if (!produto || produto.empresaId !== empresaId) throw new NotFoundException(`Produto ${it.produtoId} não encontrado.`);
        descricao = descricao ?? produto.descricao;
      }
      if (!descricao) throw new BadRequestException('Cada item precisa de descrição ou de um produtoId válido.');
      const valorUnit = new Prisma.Decimal(it.valorUnit);
      valor = valor.plus(valorUnit.mul(it.quantidade));
      totalQtd += Number(it.quantidade);
      itens.push({ produtoId: it.produtoId ?? null, descricao, quantidade: it.quantidade, valorUnit });
    }

    const token = filial.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (token) {
      const faltas = this.validarFiscal(filial, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException('Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.');
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const infoAdic = dto.ordemCompraCliente ? `Pedido de compra do cliente: ${dto.ordemCompraCliente}` : undefined;
    const payload = await this.montarPayload(filial, cliente, { pecas: Math.max(1, Math.round(totalQtd)) }, itens, serie, numeroSeq, valor, infoAdic);
    if (dto.naturezaOperacao) (payload as Record<string, unknown>).natureza_operacao = dto.naturezaOperacao;

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEAV-${filial.id}-${serie}-${numeroSeq}`, payload)
      : this.emitirSimulada();

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
          filialId: filial.id,
          numero: numeroNota,
          serie,
          chave: emissao.chave,
          status: emissao.status,
          protocolo: emissao.protocolo,
          motivo: emissao.motivo,
          valor,
          provedor: emissao.provedor,
          ordemCompraCliente: dto.ordemCompraCliente,
          emitidaPor: usuario,
        },
      });
      await tx.filial.update({ where: { id: filial.id }, data: { nfeProximoNumero: numeroSeq + 1 } });
      return criada;
    });

    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * Consulta na Focus o resultado da SEFAZ e ATUALIZA a nota (a emissão é
   * assíncrona: `emitir` devolve "pendente"; a autorização chega depois).
   */
  async consultar(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.provedor !== 'focusnfe') {
      return { ...nota, aviso: 'Nota simulada — nada a consultar no provedor.' };
    }
    const filial = nota.filialId
      ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } })
      : null;
    const token = filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');

    const numeroSeq = Number(String(nota.numero).split('/').pop());
    const ref = `NFE-${nota.filialId ?? 0}-${nota.serie}-${numeroSeq}`;
    const r = await this.consultarFocus(token, ref);

    const mapa: Record<string, NFeStatus> = {
      autorizado: 'autorizada',
      cancelado: 'cancelada',
      erro_autorizacao: 'rejeitada',
      denegado: 'rejeitada',
      processando_autorizacao: 'pendente',
    };
    const novoStatus = mapa[r.status] ?? nota.status;

    return this.prisma.notaFiscal.update({
      where: { id },
      data: {
        status: novoStatus,
        chave: r.chave ?? nota.chave,
        protocolo: r.protocolo ?? nota.protocolo,
        motivo: r.motivo ?? nota.motivo,
      },
    });
  }

  private async consultarFocus(token: string, ref: string) {
    const url = `https://${this.focusHost()}/v2/nfe/${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64') },
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status = String(body['status'] ?? '');
      const erros = Array.isArray(body['erros'])
        ? (body['erros'] as Array<{ mensagem?: string }>).map((e) => e.mensagem).filter(Boolean).join('; ')
        : undefined;
      return {
        status,
        chave: (body['chave_nfe'] as string) ?? null,
        protocolo: (body['protocolo'] as string) ?? null,
        motivo:
          (body['mensagem_sefaz'] as string) ||
          erros ||
          `Consulta ao provedor: ${status || 'sem status'}.`,
      };
    } catch (err) {
      this.logger.error(`Falha ao consultar Focus: ${String(err)}`);
      return { status: '', chave: null, protocolo: null, motivo: `Erro ao consultar: ${String(err)}` };
    }
  }

  // ===== Validação =====
  private validarFiscal(emitente: Filial, cliente: Cliente, qtdItens: number): string[] {
    const f: string[] = [];
    if (!emitente.cnpj) f.push('CNPJ da filial emissora');
    if (!emitente.inscricaoEstadual) f.push('Inscrição Estadual da filial');
    if (!emitente.municipio || !emitente.uf || !emitente.cep) f.push('Endereço fiscal da filial');
    if (!cliente.cnpjCpf) f.push('CNPJ/CPF do cliente');
    if (!cliente.municipio || !cliente.uf || !cliente.cep) f.push('Endereço fiscal do cliente');
    if (qtdItens === 0) f.push('itens no pedido');
    return f;
  }

  // ===== Montagem do payload (formato Focus NFe) =====
  /** CFOP conforme a operação: 5xxx dentro do estado, 6xxx interestadual. */
  private ajustarCfop(cfop: string, mesmaUf: boolean): string {
    const c = (cfop || '5101').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    return (mesmaUf ? '5' : '6') + c.slice(1);
  }

  private async montarPayload(
    emitente: Filial,
    cliente: Cliente,
    exp: { pecas: number },
    itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }>,
    serie: string,
    numero: number,
    valorTotal: Prisma.Decimal,
    infoAdicional?: string,
  ) {
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: itens.map((i) => i.produtoId).filter((x): x is number => !!x) } },
    });
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    const docDest = digitos(cliente.cnpjCpf);
    const mesmaUf = (emitente.uf ?? '').toUpperCase() === (cliente.uf ?? '').toUpperCase();

    const regimeNormal = emitente.crt === 3;
    const items = itens.map((it, idx) => {
      const p = it.produtoId ? mapa.get(it.produtoId) : undefined;
      const bruto = it.valorUnit.mul(it.quantidade);
      const unidade = p?.unidadeComercial ?? 'UN';
      const valorUnit = Number(it.valorUnit.toFixed(2));
      const item: Record<string, unknown> = {
        numero_item: idx + 1,
        codigo_produto: p?.codigo ?? String(it.produtoId ?? idx + 1),
        descricao: it.descricao,
        cfop: this.ajustarCfop(p?.cfop ?? '5101', mesmaUf),
        // NCM: a Focus/SEFAZ espera o campo "codigo_ncm" (8 dígitos).
        codigo_ncm: (p?.ncm ?? '').replace(/\D/g, '') || '00000000',
        // Unidade comercial e tributável (SEFAZ exige as duas).
        unidade_comercial: unidade,
        quantidade_comercial: it.quantidade,
        valor_unitario_comercial: valorUnit,
        unidade_tributavel: unidade,
        quantidade_tributavel: it.quantidade,
        valor_unitario_tributavel: valorUnit,
        valor_bruto: Number(bruto.toFixed(2)),
        icms_origem: p?.origem ?? 0,
        icms_situacao_tributaria: p?.icmsCst ?? (regimeNormal ? '00' : '102'),
        pis_situacao_tributaria: p?.pisCst ?? '01',
        cofins_situacao_tributaria: p?.cofinsCst ?? '01',
        // ⚠️ Alíquotas PIS/COFINS — padrão Lucro Presumido (cumulativo).
        // CONFIRME COM A CONTABILIDADE e ajuste por produto quando necessário.
        pis_aliquota_porcentual: 0.65,
        cofins_aliquota_porcentual: 3,
      };
      if (regimeNormal) {
        // Grupo ICMS (Regime Normal, CST 00): a SEFAZ exige modBC antes de vBC.
        item.icms_modalidade_base_calculo = 3; // 3 = valor da operação
        item.icms_aliquota = p?.icmsAliquota ? Number(p.icmsAliquota) : 18; // % — CONFIRME COM A CONTABILIDADE
      }
      return item;
    });

    return {
      natureza_operacao: 'Venda de mercadoria',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1, // 1 = saída
      finalidade_emissao: 1, // 1 = normal
      presenca_comprador: 9,
      modalidade_frete: 9, // 9 = sem ocorrência de transporte (SEFAZ exige o campo)
      serie,
      numero,
      // Emitente (dados também configurados no painel do provedor)
      cnpj_emitente: digitos(emitente.cnpj),
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
      ...(infoAdicional ? { informacoes_adicionais_contribuinte: infoAdicional.slice(0, 5000) } : {}),
      items,
    };
  }

  /** Host da API Focus por ambiente (produção usa api.; homologação usa homologacao.). */
  private focusHost(): string {
    return this.config.get<string>('NFE_AMBIENTE') === 'producao'
      ? 'api.focusnfe.com.br'
      : 'homologacao.focusnfe.com.br';
  }

  // ===== Provedores =====
  private async emitirFocusNfe(token: string, ref: string, payload: unknown) {
    const url = `https://${this.focusHost()}/v2/nfe?ref=${encodeURIComponent(ref)}`;
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
