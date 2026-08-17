import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cliente, Filial, Fornecedor, NFeStatus, NotaFiscal, Prisma, Transportadora } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

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
    private readonly email: EmailService,
  ) {}

  async listar(empresaId: number) {
    const notas = await this.prisma.notaFiscal.findMany({ where: { empresaId }, orderBy: { id: 'desc' } });
    // Resolve o DESTINATÁRIO de cada nota p/ facilitar a identificação na lista:
    //  • venda: pedido → cliente (nome + e-mail); sem pedido, expedição → cliente.
    //  • remessa p/ industrialização: fornecedor (facção).
    const pedidoIds = [...new Set(notas.map((n) => n.pedidoId).filter((x): x is number => x != null))];
    const expIds = [...new Set(notas.filter((n) => n.pedidoId == null).map((n) => n.expedicaoId).filter((x): x is number => x != null))];
    const fornIds = [...new Set(notas.map((n) => n.fornecedorId).filter((x): x is number => x != null))];
    const [peds, exps, forns] = await Promise.all([
      pedidoIds.length ? this.prisma.pedido.findMany({ where: { id: { in: pedidoIds } }, select: { id: true, cliente: { select: { nome: true, email: true } } } }) : [],
      expIds.length ? this.prisma.expedicao.findMany({ where: { id: { in: expIds } }, select: { id: true, clienteId: true } }) : [],
      fornIds.length ? this.prisma.fornecedor.findMany({ where: { id: { in: fornIds } }, select: { id: true, nome: true } }) : [],
    ]);
    const cliIds = [...new Set(exps.map((e) => e.clienteId))];
    const clis = cliIds.length ? await this.prisma.cliente.findMany({ where: { id: { in: cliIds } }, select: { id: true, nome: true, email: true } }) : [];
    const porCli = new Map(clis.map((c) => [c.id, { nome: c.nome, email: c.email }]));
    const porPedido = new Map(peds.map((p) => [p.id, p.cliente]));
    const porExp = new Map(exps.map((e) => [e.id, porCli.get(e.clienteId) ?? null]));
    const porForn = new Map(forns.map((f) => [f.id, f.nome]));
    return notas.map((n) => {
      const cli = n.pedidoId != null ? porPedido.get(n.pedidoId) : n.expedicaoId != null ? porExp.get(n.expedicaoId) : null;
      const nome = n.tipo === 'remessa' && n.fornecedorId != null ? porForn.get(n.fornecedorId) ?? null : cli?.nome ?? null;
      return { ...n, clienteNome: nome, clienteEmail: cli?.email ?? null };
    });
  }

  async emitir(
    expedicaoId: number,
    empresaId: number,
    usuario: string,
    transporte?: { volumes?: number; especie?: string; pesoLiquido?: number; pesoBruto?: number; dimensoes?: string; transportadoraId?: number; placaVeiculo?: string; modalidadeFrete?: number },
  ) {
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

    // Destinatário: por padrão é o cliente. Se o pedido aponta uma UNIDADE do cliente
    // COM CNPJ próprio, a NF é emitida para essa unidade (nome + dados fiscais dela).
    let destinatario = cliente;
    if (pedido?.clienteUnidadeId) {
      const uni = await this.prisma.clienteUnidade.findUnique({ where: { id: pedido.clienteUnidadeId } });
      if (uni && uni.clienteId === cliente.id && uni.cnpjCpf) {
        destinatario = {
          ...cliente,
          nome: uni.nome || cliente.nome,
          cnpjCpf: uni.cnpjCpf,
          inscricaoEstadual: uni.inscricaoEstadual ?? cliente.inscricaoEstadual,
          indicadorIE: uni.indicadorIE ?? cliente.indicadorIE,
          logradouro: uni.logradouro ?? cliente.logradouro,
          numeroEndereco: uni.numeroEndereco ?? cliente.numeroEndereco,
          bairro: uni.bairro ?? cliente.bairro,
          municipio: uni.municipio ?? cliente.municipio,
          codMunicipio: uni.codMunicipio ?? cliente.codMunicipio,
          uf: uni.uf ?? cliente.uf,
          cep: uni.cep ?? cliente.cep,
          email: uni.email ?? cliente.email,
        };
      }
    }
    // Expedição PARCIAL: a NF reflete só o que foi expedido (snapshot em exp.itens).
    const snap = exp.itens as Array<{ produtoId: number | null; descricao: string; cor?: string | null; quantidade: number; valorUnit: number; grade?: Record<string, number> | null }> | null;
    let itens: Array<{ produtoId: number | null; descricao: string; cor?: string | null; quantidade: number; valorUnit: Prisma.Decimal; grade?: Record<string, number> | null }>;
    let valor: Prisma.Decimal;
    if (snap && snap.length) {
      itens = snap.map((s) => ({ produtoId: s.produtoId ?? null, descricao: s.descricao, cor: s.cor ?? null, quantidade: s.quantidade, valorUnit: new Prisma.Decimal(s.valorUnit), grade: s.grade ?? null }));
      valor = itens.reduce((acc, it) => acc.plus(it.valorUnit.mul(it.quantidade)), new Prisma.Decimal(0));
    } else {
      itens = (pedido?.itens ?? []) as typeof itens;
      valor = pedido?.valorTotal ?? new Prisma.Decimal(0);
    }

    // Emitente = filial do pedido; se não houver, a matriz da empresa.
    let filial = pedido?.filialId
      ? await this.prisma.filial.findUnique({ where: { id: pedido.filialId } })
      : null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado. Cadastre a matriz em Filiais (Config. Fiscal).');

    // Token: o da filial tem prioridade; senão, o global do ambiente.
    const token = this.tokenDaFilial(filial);

    // Validação fiscal mínima só quando vai emitir DE VERDADE (com provedor).
    if (token) {
      const faltas = this.validarFiscal(filial, destinatario, itens.length);
      if (faltas.length) {
        throw new BadRequestException(
          'Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.',
        );
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    // BONIFICAÇÃO: pedido de brinde/doação — NF sai como REMESSA DE BONIFICAÇÃO
    // (CFOP 5910/6910, sem cobrança) e NÃO gera conta a receber.
    const bonificacao = !!pedido?.bonificacao;
    // Cobrança/vencimento a partir da forma de pagamento do pedido (aparece no DANFE).
    const cobranca = bonificacao
      ? { duplicatas: undefined, primeiroVenc: new Date(), venctoTxt: undefined as string | undefined }
      : this.duplicatasDePedido(pedido?.formaPagamento, Number(valor));
    const infoAdic = [
      pedido?.obs ? pedido.obs.trim() : null,
      pedido?.ordemCompraCliente ? `Pedido de compra do cliente: ${pedido.ordemCompraCliente}` : null,
      pedido?.formaPagamento ? `Forma de pagamento: ${pedido.formaPagamento}` : null,
      transporte?.dimensoes ? `Dimensoes (C x L x A): ${transporte.dimensoes.trim()}` : null,
      cobranca.venctoTxt,
      // Bonificação/doação não gera cobrança — não faz sentido pedir pagamento.
      bonificacao ? null : this.dadosPagamentoTxt(filial),
    ].filter(Boolean).join(' | ') || undefined;
    // Grade de tamanhos → vai na DESCRIÇÃO de cada item (aparece na tabela de
    // produtos do DANFE, p/ conferência no recebimento).
    const itensNf = this.explodirPorTamanho(itens.map((it) => ({ descricao: this.descComCor(it.descricao, (it as { cor?: string | null }).cor), quantidade: it.quantidade, valorUnit: it.valorUnit, produtoId: it.produtoId, grade: (it as { grade?: Record<string, number> | null }).grade })));
    // Transportadora cadastrada (dados do quadro TRANSPORTADOR do DANFE).
    let transportadora: Transportadora | null = null;
    if (transporte?.transportadoraId) {
      transportadora = await this.prisma.transportadora.findUnique({ where: { id: transporte.transportadoraId } });
      if (transportadora && transportadora.empresaId !== empresaId) transportadora = null;
    }
    // Modalidade do frete: usa a informada; senão o campo do pedido (CIF=0/FOB=1); senão sem frete.
    const freteTxt = (pedido?.frete || '').toLowerCase();
    const modFrete = transporte?.modalidadeFrete != null
      ? transporte.modalidadeFrete
      : (/cif/.test(freteTxt) ? 0 : /fob/.test(freteTxt) ? 1 : ((transportadora || exp.transportadora) ? 0 : 9));
    const payload = await this.montarPayload(filial, destinatario, exp, itensNf, serie, numeroSeq, valor, infoAdic, {
      duplicatas: cobranca.duplicatas,
      frete: modFrete,
      volumes: transporte?.volumes,
      especie: transporte?.especie,
      pesoLiquido: transporte?.pesoLiquido,
      pesoBruto: transporte?.pesoBruto,
      placa: transporte?.placaVeiculo,
      transportadora: transportadora ? {
        nome: transportadora.nome, cnpjCpf: transportadora.cnpjCpf, inscricaoEstadual: transportadora.inscricaoEstadual,
        logradouro: transportadora.logradouro, municipio: transportadora.municipio, uf: transportadora.uf,
        placaVeiculo: transportadora.placaVeiculo, ufVeiculo: transportadora.ufVeiculo, rntc: transportadora.rntc,
      } : undefined,
      bonificacao,
    });

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFE-${filial.id}-${serie}-${numeroSeq}`, payload, filial.nfeAmbiente)
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
          ...this.resumoFiscalPayload(payload),
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
      // Financeiro: lança a conta a receber da venda (saída), ligada à NF.
      // BONIFICAÇÃO não gera cobrança — não lança a receber.
      if (!bonificacao) {
        await tx.contaReceber.create({
          data: { empresaId, clienteId: cliente.id, pedidoId: exp.pedidoId, notaFiscalId: criada.id, valor, vencimento: cobranca.primeiroVenc, status: 'a_vencer' },
        });
      }
      return criada;
    });

    // No modo simulado, devolve o payload para conferência da contabilidade.
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * NF de SIMPLES FATURAMENTO (venda para entrega futura) — a "NF cheia" que gera
   * a COBRANÇA do pedido (justifica o sinal e lança o residual a receber).
   * NÃO movimenta mercadoria: CFOP 5922/6922, finalidade normal. As entregas saem
   * depois com NF(s) de Remessa (CFOP 5116/6116) referenciando esta nota.
   */
  async emitirFaturamento(pedidoId: number, empresaId: number, usuario: string, opts?: { sinalRecebido?: number; volumes?: number }) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { itens: true, cliente: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    if (!pedido.itens.length) throw new BadRequestException('Pedido sem itens para faturar.');
    const ja = await this.prisma.notaFiscal.findFirst({ where: { empresaId, tipo: 'faturamento', pedidoId, status: { in: ['pendente', 'autorizada', 'simulada'] } } });
    if (ja) throw new ConflictException(`Este pedido já tem a NF de faturamento ${ja.numero}.`);

    const filial = pedido.filialId
      ? await this.prisma.filial.findUnique({ where: { id: pedido.filialId } })
      : await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado (matriz).');
    const token = this.tokenDaFilial(filial);
    const cliente = pedido.cliente;

    const valor = new Prisma.Decimal(pedido.valorTotal);
    const itensNf = pedido.itens.map((it) => ({ descricao: this.descComCor(it.descricao, it.cor), quantidade: it.quantidade, valorUnit: it.valorUnit, produtoId: it.produtoId }));
    const totalPecas = pedido.itens.reduce((s, it) => s + it.quantidade, 0);

    // Título = RESIDUAL (valor total − sinal já recebido fora da NF).
    const sinal = Math.max(0, Math.min(Number(valor), Number(opts?.sinalRecebido || 0)));
    const residual = Number((Number(valor) - sinal).toFixed(2));
    const cobranca = this.duplicatasDePedido(pedido.formaPagamento, residual > 0 ? residual : Number(valor));

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const infoAdic = [
      `Simples faturamento - venda para entrega futura. Pedido ${pedido.numero}.`,
      sinal > 0 ? `Sinal ja recebido: R$ ${sinal.toFixed(2)}. Residual a cobrar: R$ ${residual.toFixed(2)}.` : '',
      'Mercadoria sera entregue com NF(s) de remessa (CFOP 5116/6116) referenciando esta nota.',
    ].filter(Boolean).join(' ');

    const payload = await this.montarPayload(filial, cliente, { pecas: totalPecas, volumes: opts?.volumes }, itensNf, serie, numeroSeq, valor, infoAdic, {
      cfopOverride: '5922',
      duplicatas: cobranca.duplicatas,
      volumes: opts?.volumes,
    });
    (payload as Record<string, unknown>).natureza_operacao = 'Venda para entrega futura (simples faturamento)';
    (payload as Record<string, unknown>).finalidade_emissao = 1;

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEFAT-${filial.id}-${serie}-${numeroSeq}`, payload, filial.nfeAmbiente)
      : this.emitirSimulada();
    if (emissao.status === 'rejeitada') {
      return { status: 'rejeitada' as const, numero: numeroNota, motivo: emissao.motivo, provedor: emissao.provedor, payloadPreview: token ? undefined : payload };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          ...this.resumoFiscalPayload(payload),
          empresaId, filialId: filial.id, pedidoId, tipo: 'faturamento',
          numero: numeroNota, serie, chave: emissao.chave, status: emissao.status, protocolo: emissao.protocolo,
          motivo: emissao.motivo, valor, provedor: emissao.provedor, emitidaPor: usuario, ordemCompraCliente: pedido.ordemCompraCliente,
        },
      });
      await tx.filial.update({ where: { id: filial.id }, data: { nfeProximoNumero: numeroSeq + 1 } });
      // Conta a receber do RESIDUAL (o sinal já entrou fora desta NF).
      if (residual > 0) {
        await tx.contaReceber.create({ data: { empresaId, clienteId: cliente.id, pedidoId, notaFiscalId: criada.id, valor: new Prisma.Decimal(residual.toFixed(2)), vencimento: cobranca.primeiroVenc, status: 'a_vencer' } });
      }
      return criada;
    });
    return token ? { ...nota, sinal, residual } : { ...nota, sinal, residual, payloadPreview: payload };
  }

  /**
   * NF de REMESSA (entrega futura) — acompanha uma entrega PARCIAL, referenciando
   * a NF de faturamento do pedido. CFOP 5116/6116, SEM cobrança (o financeiro já
   * está no faturamento). Uma por expedição parcial.
   */
  async emitirRemessaFutura(expedicaoId: number, empresaId: number, usuario: string, transporte?: { volumes?: number; especie?: string; pesoLiquido?: number; pesoBruto?: number }) {
    const exp = await this.prisma.expedicao.findUnique({ where: { id: expedicaoId } });
    if (!exp) throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) throw new NotFoundException(`Expedição ${expedicaoId} não encontrada.`);
    if (!exp.pedidoId) throw new BadRequestException('Expedição sem pedido — a remessa de entrega futura precisa do pedido faturado.');

    const jaEmitida = await this.prisma.notaFiscal.findFirst({ where: { expedicaoId, status: { in: ['pendente', 'autorizada', 'simulada'] } } });
    if (jaEmitida) throw new ConflictException(`Expedição já possui a nota ${jaEmitida.numero}.`);

    // Exige a NF de faturamento do pedido (a remessa referencia ela).
    const faturamento = await this.prisma.notaFiscal.findFirst({ where: { empresaId, tipo: 'faturamento', pedidoId: exp.pedidoId, status: { in: ['autorizada', 'simulada'] } }, orderBy: { id: 'desc' } });
    if (!faturamento) throw new BadRequestException('Emita a NF de FATURAMENTO do pedido antes da remessa de entrega futura.');

    const pedido = await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId }, include: { itens: true } });
    let destinatario = cliente;
    if (pedido?.clienteUnidadeId) {
      const uni = await this.prisma.clienteUnidade.findUnique({ where: { id: pedido.clienteUnidadeId } });
      if (uni && uni.clienteId === cliente.id && uni.cnpjCpf) {
        destinatario = { ...cliente, nome: uni.nome || cliente.nome, cnpjCpf: uni.cnpjCpf, inscricaoEstadual: uni.inscricaoEstadual ?? cliente.inscricaoEstadual, indicadorIE: uni.indicadorIE ?? cliente.indicadorIE, logradouro: uni.logradouro ?? cliente.logradouro, numeroEndereco: uni.numeroEndereco ?? cliente.numeroEndereco, bairro: uni.bairro ?? cliente.bairro, municipio: uni.municipio ?? cliente.municipio, codMunicipio: uni.codMunicipio ?? cliente.codMunicipio, uf: uni.uf ?? cliente.uf, cep: uni.cep ?? cliente.cep, email: uni.email ?? cliente.email };
      }
    }

    // Só o que foi expedido nesta parcial (snapshot em exp.itens).
    const snap = exp.itens as Array<{ produtoId: number | null; descricao: string; cor?: string | null; quantidade: number; valorUnit: number; grade?: Record<string, number> | null }> | null;
    const itens = (snap && snap.length ? snap : (pedido?.itens ?? []).map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, cor: i.cor, quantidade: i.quantidade, valorUnit: Number(i.valorUnit), grade: (i.grade as Record<string, number> | null) ?? null })))
      .map((s) => ({ produtoId: s.produtoId ?? null, descricao: this.descComCor(s.descricao, s.cor ?? null), quantidade: s.quantidade, valorUnit: new Prisma.Decimal(s.valorUnit), grade: s.grade ?? null }));
    if (!itens.length) throw new BadRequestException('Nada expedido nesta parcial para emitir a remessa.');
    const valor = itens.reduce((acc, it) => acc.plus(it.valorUnit.mul(it.quantidade)), new Prisma.Decimal(0));

    let filial = pedido?.filialId ? await this.prisma.filial.findUnique({ where: { id: pedido.filialId } }) : null;
    if (!filial) filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado.');
    const token = this.tokenDaFilial(filial);
    if (token) {
      const faltas = this.validarFiscal(filial, destinatario, itens.length);
      if (faltas.length) throw new BadRequestException('Dados fiscais incompletos: ' + faltas.join('; ') + '.');
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const infoAdic = `Remessa - venda para entrega futura. Ref. NF de faturamento ${faturamento.numero}${faturamento.chave ? ' (chave ' + faturamento.chave + ')' : ''}. Pedido ${pedido?.numero ?? ''}. Sem cobranca (financeiro na NF de faturamento).`;

    const payload = await this.montarPayload(filial, destinatario, { pecas: itens.reduce((s, i) => s + i.quantidade, 0), volumes: transporte?.volumes }, itens, serie, numeroSeq, valor, infoAdic, {
      cfopOverride: '5116', semImpostos: true,
      volumes: transporte?.volumes, especie: transporte?.especie, pesoLiquido: transporte?.pesoLiquido, pesoBruto: transporte?.pesoBruto,
    });
    (payload as Record<string, unknown>).natureza_operacao = 'Remessa - venda para entrega futura';
    if (faturamento.chave) (payload as Record<string, unknown>).notas_referenciadas = [{ chave_nfe: faturamento.chave }];

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEREMF-${filial.id}-${serie}-${numeroSeq}`, payload, filial.nfeAmbiente)
      : this.emitirSimulada();
    if (emissao.status === 'rejeitada') {
      return { status: 'rejeitada' as const, numero: numeroNota, motivo: emissao.motivo, provedor: emissao.provedor, payloadPreview: token ? undefined : payload };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          ...this.resumoFiscalPayload(payload),
          empresaId, filialId: filial.id, expedicaoId, pedidoId: exp.pedidoId, tipo: 'remessa_futura', notaRefId: faturamento.id,
          numero: numeroNota, serie, chave: emissao.chave, status: emissao.status, protocolo: emissao.protocolo,
          motivo: emissao.motivo, valor, provedor: emissao.provedor, emitidaPor: usuario,
        },
      });
      await tx.filial.update({ where: { id: filial.id }, data: { nfeProximoNumero: numeroSeq + 1 } });
      await tx.expedicao.update({ where: { id: expedicaoId }, data: { nf: criada.numero } });
      return criada; // SEM conta a receber — a cobrança está no faturamento.
    });
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /**
   * NF-e AVULSA — emite sem expedição/pedido: escolhe o cliente e os itens
   * direto. Mesma numeração e validação fiscal da emissão normal.
   */
  async emitirAvulsa(
    dto: { clienteId: number; filialId?: number; pedidoId?: number; itens: Array<{ produtoId?: number; descricao?: string; quantidade: number; valorUnit: number }>; naturezaOperacao?: string; ordemCompraCliente?: string; volumes?: number; diasVencimento?: number; observacoes?: string },
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

    const token = this.tokenDaFilial(filial);
    if (token) {
      const faltas = this.validarFiscal(filial, cliente, itens.length);
      if (faltas.length) {
        throw new BadRequestException('Dados fiscais incompletos para emissão real: ' + faltas.join('; ') + '.');
      }
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;

    // Pedido vinculado (opcional): valida, avança a etapa e traz a grade por produto.
    let pedidoVinc: { id: number; etapa: string } | null = null;
    const gradePorProduto = new Map<number, Record<string, number>>();
    if (dto.pedidoId) {
      const ped = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId }, include: { itens: true } });
      if (!ped || ped.empresaId !== empresaId) throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
      pedidoVinc = { id: ped.id, etapa: ped.etapa };
      for (const it of ped.itens) {
        const g = it.grade as Record<string, number> | null;
        if (it.produtoId && g && Object.keys(g).length) gradePorProduto.set(it.produtoId, g);
      }
    }

    // Cobrança: vencimento em N dias a partir do faturamento (fatura + 1 duplicata).
    const diasV = dto.diasVencimento && dto.diasVencimento > 0 ? dto.diasVencimento : 0;
    const vencimentoData = new Date();
    vencimentoData.setHours(0, 0, 0, 0);
    vencimentoData.setDate(vencimentoData.getDate() + diasV);
    let duplicatas: Array<{ numero: string; data_vencimento: string; valor: number }> | undefined;
    let venctoTxt: string | undefined;
    if (diasV > 0) {
      const iso = vencimentoData.toISOString().slice(0, 10);
      duplicatas = [{ numero: '001', data_vencimento: iso, valor: Number(valor.toFixed(2)) }];
      venctoTxt = `Vencimento: ${iso.split('-').reverse().join('/')} (${diasV} dias)`;
    }
    const infoAdic = [
      (dto.observacoes || '').trim() || null,
      dto.ordemCompraCliente ? `Pedido de compra do cliente: ${dto.ordemCompraCliente}` : null,
      venctoTxt,
      this.dadosPagamentoTxt(filial),
    ].filter(Boolean).join(' | ') || undefined;

    // Grade na descrição do item (por produto do pedido vinculado).
    const itensNf = this.explodirPorTamanho(itens.map((it) => ({ ...it, grade: it.produtoId ? gradePorProduto.get(it.produtoId) : undefined })));
    const volumes = dto.volumes && dto.volumes > 0 ? Math.round(dto.volumes) : Math.max(1, Math.round(totalQtd));
    const payload = await this.montarPayload(filial, cliente, { pecas: Math.max(1, Math.round(totalQtd)) }, itensNf, serie, numeroSeq, valor, infoAdic, { volumes, duplicatas });
    if (dto.naturezaOperacao) (payload as Record<string, unknown>).natureza_operacao = dto.naturezaOperacao;

    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEAV-${filial.id}-${serie}-${numeroSeq}`, payload, filial.nfeAmbiente)
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
          ...this.resumoFiscalPayload(payload),
          empresaId,
          filialId: filial.id,
          pedidoId: pedidoVinc?.id,
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
      // Financeiro: lança a conta a receber da venda (saída), ligada à NF.
      await tx.contaReceber.create({
        data: { empresaId, clienteId: dto.clienteId, pedidoId: pedidoVinc?.id, notaFiscalId: criada.id, valor, vencimento: vencimentoData, status: 'a_vencer' },
      });
      // Setores: se veio de um pedido em orçamento, avança para aprovado (faturado).
      if (pedidoVinc && pedidoVinc.etapa === 'orcamento') {
        await tx.pedido.update({ where: { id: pedidoVinc.id }, data: { etapa: 'aprovado', status: 'Faturado' } });
      }
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
    const token = this.tokenDaFilial(filial);
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');

    const ref = this.refDaNota(nota);
    const r = await this.consultarFocus(token, ref, filial?.nfeAmbiente);

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

  /** Nota + token do provedor (valida empresa). Uso interno de cancelar/CC-e. */
  private async notaComToken(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
    const token = this.tokenDaFilial(filial);
    return { nota, token };
  }

  /**
   * CANCELAMENTO na SEFAZ (só notas AUTORIZADAS). Exige justificativa (15+
   * caracteres) e respeita o prazo legal da SEFAZ (24h sem multa em SP).
   */
  async cancelar(id: number, empresaId: number, justificativa: string, usuario: string) {
    const { nota, token } = await this.notaComToken(id, empresaId);
    if (nota.status === 'cancelada') throw new ConflictException('Nota já está cancelada.');
    if (nota.provedor === 'simulado') {
      const upd = await this.prisma.notaFiscal.update({ where: { id }, data: { status: 'cancelada', motivo: `Cancelada (simulada) por ${usuario}: ${justificativa}` } });
      const casc = await this.cascataCancelamento(nota);
      return { ...upd, cascata: casc };
    }
    if (nota.status !== 'autorizada') {
      throw new ConflictException('Só é possível cancelar na SEFAZ uma nota AUTORIZADA. Para nota rejeitada/pendente, use Excluir.');
    }
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const ambCanc = nota.filialId ? (await this.prisma.filial.findUnique({ where: { id: nota.filialId }, select: { nfeAmbiente: true } }))?.nfeAmbiente : null;
    const r = await this.cancelarFocus(token, this.refDaNota(nota), justificativa, ambCanc);
    if (!r.ok) throw new BadRequestException(`Falha ao cancelar na SEFAZ: ${r.motivo}`);
    const upd = await this.prisma.notaFiscal.update({
      where: { id },
      data: { status: 'cancelada', motivo: `Cancelada por ${usuario}: ${justificativa}` },
    });
    const casc = await this.cascataCancelamento(nota);
    return { ...upd, cascata: casc };
  }

  /**
   * Cascata do cancelamento da NF: cancela o lançamento financeiro (conta a
   * receber não paga) e reverte o pedido de venda vinculado (se ainda não
   * entrou em produção). Mantém os setores interligados.
   */
  private async cascataCancelamento(nota: NotaFiscal) {
    return this.prisma.$transaction(async (tx) => {
      // 1) Remove contas a receber NÃO pagas originadas nesta NF.
      const rec = await tx.contaReceber.deleteMany({ where: { notaFiscalId: nota.id, pago: 0 } });
      // 2) Reverte o pedido de venda ligado (só se não gerou OP).
      let pedidoRevertido: string | null = null;
      if (nota.pedidoId) {
        const ped = await tx.pedido.findUnique({ where: { id: nota.pedidoId }, include: { ops: true } });
        if (ped && ped.ops.length === 0 && ['aprovado', 'piloto'].includes(ped.etapa)) {
          await tx.pedido.update({ where: { id: ped.id }, data: { etapa: 'orcamento', status: 'Orçamento (NF cancelada)' } });
          pedidoRevertido = ped.numero;
        }
      }
      return { titulosReceberCancelados: rec.count, pedidoRevertido };
    });
  }

  /**
   * CARTA DE CORREÇÃO (CC-e) — corrige dados que NÃO alteram valores/impostos,
   * destinatário ou datas. Só para notas autorizadas. Justificativa 15+ chars.
   */
  async cartaCorrecao(id: number, empresaId: number, correcao: string, usuario: string) {
    const { nota, token } = await this.notaComToken(id, empresaId);
    if (nota.status !== 'autorizada') throw new ConflictException('A carta de correção só vale para nota AUTORIZADA.');
    // Higieniza o texto p/ o schema da SEFAZ (xCorrecao): sem quebra de linha/tab,
    // sem travessões/aspas especiais, só U+0020..U+00FF, 15..1000 chars, sem
    // espaço no início/fim.
    correcao = this.sanitizarCorrecao(correcao);
    if (correcao.length < 15) throw new BadRequestException('A correção precisa de ao menos 15 caracteres válidos (após remover quebras de linha e símbolos não aceitos pela SEFAZ).');
    if (correcao.length > 1000) correcao = correcao.slice(0, 1000);
    if (nota.provedor === 'simulado') {
      return { ok: true, mensagem: 'CC-e registrada (simulada).', correcao };
    }
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const ambCCe = nota.filialId ? (await this.prisma.filial.findUnique({ where: { id: nota.filialId }, select: { nfeAmbiente: true } }))?.nfeAmbiente : null;
    const r = await this.cartaCorrecaoFocus(token, this.refDaNota(nota), correcao, ambCCe);
    if (!r.ok) throw new BadRequestException(`Falha na carta de correção: ${r.motivo}`);
    await this.prisma.notaFiscal.update({
      where: { id },
      data: { motivo: `${nota.motivo ?? ''} | CC-e por ${usuario}: ${correcao}`.slice(0, 900) },
    });
    return { ok: true, mensagem: 'Carta de correção enviada à SEFAZ.', correcao };
  }

  /** Baixa o PDF da Carta de Correção (CC-e) processada na Focus. */
  async cartaCorrecaoPdf(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
    const token = this.tokenDaFilial(filial);
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const host = this.focusHost(filial?.nfeAmbiente);
    const auth = 'Basic ' + Buffer.from(token + ':').toString('base64');
    const det = (await (await fetch(`https://${host}/v2/nfe/${encodeURIComponent(this.refDaNota(nota))}`, { headers: { Authorization: auth } }).catch(() => null))?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
    const caminho = (det?.['caminho_pdf_carta_correcao'] ?? det?.['caminho_carta_correcao']) as string | undefined;
    if (!caminho) throw new BadRequestException('Carta de correção ainda não disponível (a SEFAZ pode levar alguns segundos). Tente novamente.');
    const res = await fetch(`https://${host}${caminho}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new BadRequestException('Falha ao baixar a carta de correção.');
    return { content: Buffer.from(await res.arrayBuffer()), filename: `CCe-${String(nota.numero).replace('/', '-')}.pdf`, contentType: 'application/pdf' };
  }

  /**
   * EXCLUI o registro local de uma nota NÃO autorizada (rejeitada/cancelada/
   * pendente-com-erro/simulada) e, se for o último número emitido, DEVOLVE o
   * sequencial para reutilização. Nota autorizada precisa ser cancelada antes.
   */
  async excluir(id: number, empresaId: number) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.status === 'autorizada') {
      throw new ConflictException('Nota AUTORIZADA não pode ser excluída — cancele na SEFAZ primeiro.');
    }
    const numeroSeq = Number(String(nota.numero).split('/').pop());
    // Só devolve o número se a nota NUNCA consumiu numeração na SEFAZ: rejeitada
    // (recusada) ou simulada. PENDENTE pode ser autorizada de forma assíncrona pela
    // SEFAZ — reusar o número gera colisão (duas notas no mesmo nº). CANCELADA já
    // consumiu o número. Nesses casos NÃO reutiliza.
    const podeReutilizar = nota.status === 'rejeitada' || nota.status === 'simulada';
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.notaFiscal.delete({ where: { id } });
      let numeroReutilizado: number | null = null;
      if (podeReutilizar && nota.filialId) {
        const filial = await tx.filial.findUnique({ where: { id: nota.filialId } });
        // Só devolve o número se ele for o ÚLTIMO consumido (senão abriria buraco).
        if (filial && numeroSeq === filial.nfeProximoNumero - 1) {
          await tx.filial.update({ where: { id: nota.filialId }, data: { nfeProximoNumero: numeroSeq } });
          numeroReutilizado = numeroSeq;
        }
      }
      return { numeroReutilizado };
    });
    return { excluido: true, id, numero: nota.numero, numeroReutilizado: resultado.numeroReutilizado };
  }

  /**
   * Envia a NF (DANFE em PDF + XML) por e-mail ao cliente. Baixa os arquivos
   * na Focus quando a nota está autorizada. Aceita e-mail informado; senão
   * tenta o e-mail do cliente do pedido vinculado.
   */
  async enviarPorEmail(id: number, empresaId: number, emailInformado?: string) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);

    // Destino: e-mail informado ou o do cliente do pedido vinculado.
    let destino = emailInformado?.trim();
    let nomeCliente = '';
    if (nota.pedidoId) {
      const ped = await this.prisma.pedido.findUnique({ where: { id: nota.pedidoId }, include: { cliente: true } });
      nomeCliente = ped?.cliente?.nome ?? '';
      if (!destino) destino = ped?.cliente?.email ?? undefined;
    }
    if (!destino) throw new BadRequestException('Informe o e-mail de destino (a nota não tem cliente vinculado com e-mail).');

    const anexos: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    if (nota.provedor === 'focusnfe' && nota.status === 'autorizada') {
      const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
      const token = this.tokenDaFilial(filial);
      if (token) {
        const arq = await this.baixarArquivosFocus(token, this.refDaNota(nota), filial?.nfeAmbiente);
        const nome = String(nota.numero).replace('/', '-');
        if (arq.pdf) anexos.push({ filename: `NFe-${nome}.pdf`, content: arq.pdf, contentType: 'application/pdf' });
        if (arq.xml) anexos.push({ filename: `NFe-${nome}.xml`, content: arq.xml, contentType: 'application/xml' });
      }
    }

    // Linha do PIX no corpo (nas NFs de venda; remessa não tem cobrança).
    let pagamentoTxt = '';
    if (nota.tipo !== 'remessa') {
      const filPag = await this.prisma.filial.findFirst({ where: nota.filialId ? { id: nota.filialId } : { empresaId, matriz: true }, select: { dadosBancarios: true } });
      const linhaPix = String(filPag?.dadosBancarios || '').split(/[\r\n]+/).map((l) => l.trim()).find((l) => /pix/i.test(l));
      if (linhaPix) pagamentoTxt = `\n\nPara pagamento — ${linhaPix}`;
    }
    const r = await this.email.enviar({
      para: destino,
      assunto: `NF-e ${nota.numero} — GRUPO CHERKESIAN`,
      texto: `Olá${nomeCliente ? ' ' + nomeCliente : ''},\n\nSegue em anexo a nota fiscal eletrônica nº ${nota.numero}` +
        (nota.chave ? ` (chave ${nota.chave})` : '') + `.` + pagamentoTxt + `\n\nAtenciosamente,\nGRUPO CHERKESIAN`,
      anexos: anexos.length ? anexos : undefined,
    });
    return { enviado: r.enviado, simulado: r.simulado, para: destino, anexos: anexos.length, detalhe: r.detalhe };
  }

  /**
   * Baixa um arquivo da nota (DANFE em PDF ou XML) para download/impressão.
   * Retorna o conteúdo + nome + content-type; erro claro se não disponível.
   */
  async baixarArquivo(id: number, empresaId: number, tipo: 'danfe' | 'xml') {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota ${id} não encontrada.`);
    if (nota.provedor !== 'focusnfe') throw new BadRequestException('Nota simulada não possui DANFE/XML oficial.');
    if (!['autorizada', 'cancelada'].includes(nota.status)) {
      throw new BadRequestException('DANFE/XML só ficam disponíveis após a autorização da SEFAZ.');
    }
    const filial = nota.filialId ? await this.prisma.filial.findUnique({ where: { id: nota.filialId } }) : null;
    const token = this.tokenDaFilial(filial);
    if (!token) throw new BadRequestException('Provedor Focus não configurado (sem token).');
    const arq = await this.baixarArquivosFocus(token, this.refDaNota(nota), filial?.nfeAmbiente);
    const nome = String(nota.numero).replace('/', '-');
    if (tipo === 'danfe') {
      if (!arq.pdf) throw new BadRequestException('DANFE ainda não disponível na Focus. Tente novamente em instantes.');
      return { content: arq.pdf, filename: `DANFE-${nome}.pdf`, contentType: 'application/pdf' };
    }
    if (!arq.xml) throw new BadRequestException('XML ainda não disponível na Focus. Tente novamente em instantes.');
    return { content: arq.xml, filename: `NFe-${nome}.xml`, contentType: 'application/xml' };
  }

  /** Baixa DANFE (PDF) e XML da nota na Focus. */
  private async baixarArquivosFocus(token: string, ref: string, amb?: string | null) {
    const auth = 'Basic ' + Buffer.from(token + ':').toString('base64');
    const host = this.focusHost(amb);
    const det = (await (await fetch(`https://${host}/v2/nfe/${encodeURIComponent(ref)}`, { headers: { Authorization: auth } }).catch(() => null))?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
    const baixar = async (caminho?: unknown): Promise<Buffer | null> => {
      if (!caminho || typeof caminho !== 'string') return null;
      try {
        const res = await fetch(`https://${host}${caminho}`, { headers: { Authorization: auth } });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    return {
      pdf: await baixar(det?.['caminho_danfe']),
      xml: await baixar(det?.['caminho_xml_nota_fiscal']),
    };
  }

  private async cancelarFocus(token: string, ref: string, justificativa: string, amb?: string | null) {
    const url = `https://${this.focusHost(amb)}/v2/nfe/${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status = String(body['status'] ?? '');
      if (res.ok || status === 'cancelado') return { ok: true as const, motivo: 'Cancelada.' };
      return { ok: false as const, motivo: (body['mensagem_sefaz'] as string) || JSON.stringify(body).slice(0, 300) };
    } catch (err) {
      return { ok: false as const, motivo: String(err) };
    }
  }

  /** Limpa o texto da carta de correção para o schema da SEFAZ (xCorrecao). */
  private sanitizarCorrecao(texto: string): string {
    return (texto || '')
      .replace(/[‐-―−]/g, '-')            // travessões/hífens especiais → -
      .replace(/[‘’‚‛]/g, "'")        // aspas simples curvas → '
      .replace(/[“”„‟]/g, '"')        // aspas duplas curvas → "
      .replace(/…/g, '...')                          // reticências → ...
      .replace(/[ \t\r\n]+/g, ' ')                   // nbsp/tab/quebra de linha → espaço
      .replace(/[^\x20-\xFF]/g, '')                       // remove fora de U+0020..U+00FF
      .replace(/ {2,}/g, ' ')                             // colapsa espaços
      .trim();
  }

  private async cartaCorrecaoFocus(token: string, ref: string, correcao: string, amb?: string | null) {
    const url = `https://${this.focusHost(amb)}/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ correcao }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok || res.status === 202) return { ok: true as const, motivo: 'Enviada.' };
      return { ok: false as const, motivo: (body['mensagem_sefaz'] as string) || JSON.stringify(body).slice(0, 300) };
    } catch (err) {
      return { ok: false as const, motivo: String(err) };
    }
  }

  private async consultarFocus(token: string, ref: string, amb?: string | null) {
    const url = `https://${this.focusHost(amb)}/v2/nfe/${encodeURIComponent(ref)}`;
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

  /** Acrescenta a cor à descrição do item — ajuda cliente/almoxarifado a identificar na entrega. */
  private descComCor(descricao: string, cor?: string | null): string {
    const c = (cor ?? '').trim();
    if (!c) return descricao;
    // Evita duplicar quando a cor já está escrita na descrição.
    if (descricao.toUpperCase().includes(c.toUpperCase())) return descricao;
    return `${descricao} - COR: ${c}`.slice(0, 120);
  }

  /** Acrescenta a grade de tamanhos à descrição do item (limite xProd 120). */
  private descComGrade(descricao: string, grade?: Record<string, number> | null): string {
    if (!grade || !Object.keys(grade).length) return descricao;
    const g = Object.entries(grade).map(([t, q]) => `${t}=${q}`).join(' ');
    return `${descricao} | Grade: ${g}`.slice(0, 120);
  }

  /**
   * Cada TAMANHO vira uma LINHA/ITEM próprio da NF (ex.: "CAMISETA - TAM P" 12 un).
   * Só explode quando a grade fecha com a quantidade do item (senão o total da NF
   * não bateria e a SEFAZ rejeitaria); nesse caso mantém 1 linha com a grade na descrição.
   */
  private explodirPorTamanho(
    itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null; grade?: Record<string, number> | null }>,
  ): Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }> {
    const out: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }> = [];
    for (const it of itens) {
      const g = it.grade;
      const ent = g ? Object.entries(g).filter(([, q]) => Number(q) > 0) : [];
      const soma = ent.reduce((s, [, q]) => s + Number(q), 0);
      if (ent.length && soma === Number(it.quantidade)) {
        for (const [tam, qtd] of ent) {
          out.push({ descricao: `${it.descricao} | TAM ${tam}`.slice(0, 120), quantidade: Number(qtd), valorUnit: it.valorUnit, produtoId: it.produtoId });
        }
      } else {
        out.push({ descricao: this.descComGrade(it.descricao, g), quantidade: it.quantidade, valorUnit: it.valorUnit, produtoId: it.produtoId });
      }
    }
    return out;
  }

  // ===== Montagem do payload (formato Focus NFe) =====
  /** Extrai CFOP(s) distintos e a natureza de um payload Focus, p/ gravar na nota (contabilidade). */
  private resumoFiscalPayload(payload: unknown): { cfop: string | null; natureza: string | null } {
    const pl = payload as { items?: Array<{ cfop?: string }>; natureza_operacao?: string } | null;
    const cfops = [...new Set((pl?.items || []).map((i) => String(i?.cfop || '').trim()).filter(Boolean))];
    return { cfop: cfops.length ? cfops.join('/') : null, natureza: pl?.natureza_operacao || null };
  }

  /** CFOP conforme a operação: 5xxx dentro do estado, 6xxx interestadual. */
  private ajustarCfop(cfop: string, mesmaUf: boolean): string {
    const c = (cfop || '5101').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    const alvo = (mesmaUf ? '5' : '6') + c.slice(1);
    // Os CFOPs de "não contribuinte" (x107/x108) SÓ existem na versão
    // interestadual (6107/6108). No mercado interno usa-se 5101/5102.
    if (mesmaUf && alvo === '5107') return '5101';
    if (mesmaUf && alvo === '5108') return '5102';
    return alvo;
  }

  /** Referência da nota na Focus (avulsa usa prefixo NFEAV-, normal usa NFE-). */
  private refDaNota(nota: NotaFiscal): string {
    const numeroSeq = Number(String(nota.numero).split('/').pop());
    const prefixo = nota.expedicaoId ? 'NFE' : 'NFEAV';
    return `${prefixo}-${nota.filialId ?? 0}-${nota.serie}-${numeroSeq}`;
  }

  /** Monta a cobrança (duplicatas) da NF a partir da forma de pagamento do pedido.
   *  Aceita "30 dias", "30/60/90", "à vista" etc. Divide o valor em parcelas iguais
   *  e retorna o 1º vencimento (usado também na conta a receber). */
  /** Dados de pagamento (banco/agência/conta/PIX/favorecido) da filial emitente,
   *  formatados numa linha para as informações complementares da NF — o cliente
   *  identifica e paga. Retorna null se a filial não tiver os dados cadastrados. */
  private dadosPagamentoTxt(filial: { dadosBancarios?: string | null } | null | undefined): string | null {
    const raw = (filial?.dadosBancarios || '').trim();
    if (!raw) return null;
    const limpo = raw.replace(/\s*[\r\n]+\s*/g, '; ').replace(/\s{2,}/g, ' ').trim();
    return `DADOS PARA PAGAMENTO: ${limpo}`;
  }

  private duplicatasDePedido(forma: string | null | undefined, valor: number): {
    duplicatas?: Array<{ numero: string; data_vencimento: string; valor: number }>;
    venctoTxt?: string;
    primeiroVenc: Date;
  } {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const dias = [...String(forma ?? '').matchAll(/(\d{1,3})/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((d) => d > 0 && d <= 360)
      .sort((a, b) => a - b);
    if (!dias.length) return { primeiroVenc: hoje }; // à vista / sem prazo → vence hoje
    const n = dias.length;
    const parcela = Number((valor / n).toFixed(2));
    const duplicatas = dias.map((d, i) => {
      const dt = new Date(hoje); dt.setDate(dt.getDate() + d);
      const v = i === n - 1 ? Number((valor - parcela * (n - 1)).toFixed(2)) : parcela;
      return { numero: String(i + 1).padStart(3, '0'), data_vencimento: dt.toISOString().slice(0, 10), valor: v };
    });
    const primeiroVenc = new Date(hoje); primeiroVenc.setDate(primeiroVenc.getDate() + dias[0]);
    const venctoTxt = `Vencimento: ${duplicatas.map((x) => x.data_vencimento.split('-').reverse().join('/')).join(', ')}`;
    return { duplicatas, venctoTxt, primeiroVenc };
  }

  /**
   * NF de REMESSA para industrialização (facção COM CNPJ). CFOP 5901 (mesma UF) / 6901,
   * ICMS suspenso (CST 50 / CSOSN 090), sem faturamento. Facção sem CNPJ vai por OS.
   * Emite SIMULADO enquanto não houver token — p/ a contabilidade validar o DANFE.
   */
  async emitirRemessa(controleFaccao: string, empresaId: number, usuario: string) {
    const kits = await this.prisma.kit.findMany({ where: { empresaId, controleFaccao } });
    if (!kits.length) throw new NotFoundException(`Nenhum kit no controle ${controleFaccao}.`);
    const faccaoId = kits[0].faccaoId;
    if (!faccaoId) throw new BadRequestException('Controle sem facção externa — produção interna não gera NF de remessa.');
    const faccao = await this.prisma.fornecedor.findUnique({ where: { id: faccaoId } });
    if (!faccao || faccao.empresaId !== empresaId) throw new NotFoundException('Facção não encontrada.');
    const cnpj = digitos(faccao.cnpjCpf || '');
    if (cnpj.length !== 14) throw new BadRequestException(`A facção "${faccao.nome}" não tem CNPJ — este envio segue por OS, não por NF de remessa.`);

    const ja = await this.prisma.notaFiscal.findFirst({ where: { empresaId, tipo: 'remessa', controleFaccao, retornadaEm: null, status: { in: ['pendente', 'autorizada', 'simulada'] } } });
    if (ja) throw new ConflictException(`O controle ${controleFaccao} já tem a NF de remessa ${ja.numero} em aberto (aguardando retorno).`);

    const filial = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    if (!filial) throw new NotFoundException('Nenhum CNPJ emissor configurado (matriz).');
    const token = this.tokenDaFilial(filial);

    // Produto/NCM/custo via OP de cada kit.
    const opIds = [...new Set(kits.map((k) => k.opId).filter((x): x is number => !!x))];
    const ops = opIds.length ? await this.prisma.oP.findMany({ where: { id: { in: opIds } }, select: { id: true, produtoId: true } }) : [];
    const prodDeOp = new Map(ops.map((o) => [o.id, o.produtoId]));
    const prodIds = [...new Set(ops.map((o) => o.produtoId).filter((x): x is number => !!x))];
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } } }) : [];
    const prodMap = new Map(produtos.map((p) => [p.id, p]));

    const itens = kits.map((k, idx) => {
      const pid = k.opId ? prodDeOp.get(k.opId) : null;
      const p = pid ? prodMap.get(pid) : undefined;
      const desc = [k.modelo, k.cor, k.tamanho ? 'TAM ' + k.tamanho : ''].filter(Boolean).join(' · ') || `Kit ${k.codigo}`;
      const valorUnit = p?.custo != null ? Number(p.custo) : 0;
      return {
        numero_item: idx + 1,
        codigo_produto: p?.codigo ?? k.codigo,
        descricao: desc.slice(0, 120),
        ncm: (p?.ncm ?? '').replace(/\D/g, '') || '00000000',
        unidade: p?.unidadeComercial ?? 'UN',
        quantidade: k.pecasTotal,
        valorUnit,
        origem: p?.origem ?? 0,
      };
    });
    const valorTotal = itens.reduce((s, i) => s + i.valorUnit * i.quantidade, 0);

    if (token) {
      const faltas: string[] = [];
      if (!faccao.logradouro) faltas.push('logradouro');
      if (!faccao.municipio) faltas.push('município');
      if (!faccao.uf) faltas.push('UF');
      if (!faccao.cep) faltas.push('CEP');
      if (faltas.length) throw new BadRequestException(`Dados fiscais da facção incompletos para emissão real: ${faltas.join('; ')}.`);
    }

    const serie = filial.nfeSerie;
    const numeroSeq = filial.nfeProximoNumero;
    const numeroNota = `${serie}/${String(numeroSeq).padStart(6, '0')}`;
    const payload = this.montarPayloadRemessa(filial, faccao, itens, serie, numeroSeq, valorTotal, controleFaccao);
    const emissao = token
      ? await this.emitirFocusNfe(token, `NFEREM-${filial.id}-${serie}-${numeroSeq}`, payload, filial.nfeAmbiente)
      : this.emitirSimulada();

    if (emissao.status === 'rejeitada') {
      return { status: 'rejeitada' as const, numero: numeroNota, motivo: emissao.motivo, provedor: emissao.provedor, payloadPreview: token ? undefined : payload };
    }

    const nota = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.notaFiscal.create({
        data: {
          ...this.resumoFiscalPayload(payload),
          empresaId, filialId: filial.id, tipo: 'remessa', fornecedorId: faccao.id, controleFaccao,
          numero: numeroNota, serie, chave: emissao.chave, status: emissao.status, protocolo: emissao.protocolo,
          motivo: emissao.motivo, valor: new Prisma.Decimal(valorTotal.toFixed(2)), provedor: emissao.provedor, emitidaPor: usuario,
        },
      });
      await tx.filial.update({ where: { id: filial.id }, data: { nfeProximoNumero: numeroSeq + 1 } });
      await tx.kit.updateMany({ where: { empresaId, controleFaccao }, data: { remessaNfNumero: criada.numero } });
      return criada;
    });
    return token ? nota : { ...nota, payloadPreview: payload };
  }

  /** Payload da NF de remessa p/ industrialização (CFOP 5901/6901, ICMS suspenso). */
  private montarPayloadRemessa(
    emitente: Filial,
    faccao: Fornecedor,
    itens: Array<{ numero_item: number; codigo_produto: string; descricao: string; ncm: string; unidade: string; quantidade: number; valorUnit: number; origem: number }>,
    serie: string,
    numero: number,
    valorTotal: number,
    controle: string,
  ) {
    const mesmaUf = (emitente.uf ?? '').toUpperCase() === (faccao.uf ?? '').toUpperCase();
    const cfop = mesmaUf ? '5901' : '6901';
    const regime = (emitente.regimeTributario ?? (emitente.crt === 1 ? 'simples' : 'lucro_presumido')) as string;
    const simples = regime === 'simples';
    const docDest = digitos(faccao.cnpjCpf || '');
    const ieDig = digitos(faccao.inscricaoEstadual || '');
    const ieValida = ieDig.length >= 2 && ieDig.length <= 14;
    const items = itens.map((it) => {
      const bruto = Number((it.valorUnit * it.quantidade).toFixed(2));
      const item: Record<string, unknown> = {
        numero_item: it.numero_item,
        codigo_produto: it.codigo_produto,
        descricao: it.descricao,
        cfop,
        codigo_ncm: it.ncm,
        unidade_comercial: it.unidade,
        quantidade_comercial: it.quantidade,
        valor_unitario_comercial: it.valorUnit,
        unidade_tributavel: it.unidade,
        quantidade_tributavel: it.quantidade,
        valor_unitario_tributavel: it.valorUnit,
        valor_bruto: bruto,
        icms_origem: it.origem,
      };
      if (simples) {
        item.icms_situacao_tributaria = '090'; // CSOSN — remessa (Simples)
      } else {
        item.icms_situacao_tributaria = '50'; // CST 50 = suspensão
        item.icms_modalidade_base_calculo = 3;
        item.icms_aliquota = 0;
        item.icms_base_calculo = 0;
        item.icms_valor = 0;
      }
      // PIS/COFINS sem incidência (remessa não é faturamento).
      item.pis_situacao_tributaria = simples ? '49' : '08';
      item.cofins_situacao_tributaria = simples ? '49' : '08';
      return item;
    });
    return {
      natureza_operacao: 'Remessa para industrializacao por conta e ordem',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1,
      finalidade_emissao: 1,
      presenca_comprador: 9,
      modalidade_frete: 9,
      serie,
      numero,
      cnpj_emitente: digitos(emitente.cnpj),
      nome_destinatario: (faccao.nome || '').trim().slice(0, 60),
      cnpj_destinatario: docDest,
      inscricao_estadual_destinatario: ieValida ? ieDig : null,
      indicador_inscricao_estadual_destinatario: ieValida ? 1 : 9,
      logradouro_destinatario: faccao.logradouro,
      numero_destinatario: faccao.numeroEndereco,
      bairro_destinatario: faccao.bairro,
      municipio_destinatario: faccao.municipio,
      uf_destinatario: faccao.uf,
      cep_destinatario: digitos(faccao.cep),
      valor_total: Number(valorTotal.toFixed(2)),
      informacoes_adicionais_contribuinte: `Remessa para industrializacao - controle ${controle}. ICMS suspenso conforme RICMS. Retorno previsto em ate 180 dias.`.slice(0, 5000),
      items,
    };
  }

  private async montarPayload(
    emitente: Filial,
    cliente: Cliente,
    exp: { pecas: number; volumes?: number; transportadora?: string | null; caixas?: unknown },
    itens: Array<{ descricao: string; quantidade: number; valorUnit: Prisma.Decimal; produtoId: number | null }>,
    serie: string,
    numero: number,
    valorTotal: Prisma.Decimal,
    infoAdicional?: string,
    extra?: { volumes?: number; especie?: string; pesoLiquido?: number; pesoBruto?: number; frete?: number; bonificacao?: boolean; cfopOverride?: string; semImpostos?: boolean; placa?: string; transportadora?: { nome: string; cnpjCpf?: string | null; inscricaoEstadual?: string | null; logradouro?: string | null; municipio?: string | null; uf?: string | null; placaVeiculo?: string | null; ufVeiculo?: string | null; rntc?: string | null }; duplicatas?: Array<{ numero: string; data_vencimento: string; valor: number }> },
  ) {
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: itens.map((i) => i.produtoId).filter((x): x is number => !!x) } },
    });
    const mapa = new Map(produtos.map((p) => [p.id, p]));
    const docDest = digitos(cliente.cnpjCpf);
    const mesmaUf = (emitente.uf ?? '').toUpperCase() === (cliente.uf ?? '').toUpperCase();

    // ===== Regime tributário DA EMPRESA emissora (parametrizado por CNPJ) =====
    const regime = (emitente.regimeTributario ?? (emitente.crt === 1 ? 'simples' : 'lucro_presumido')) as string;
    const simples = regime === 'simples';
    const pisAliqEmp = emitente.pisAliquota != null ? Number(emitente.pisAliquota) : (regime === 'lucro_real' ? 1.65 : 0.65);
    const cofinsAliqEmp = emitente.cofinsAliquota != null ? Number(emitente.cofinsAliquota) : (regime === 'lucro_real' ? 7.6 : 3);
    const pisCofinsCstEmp = simples ? '49' : (emitente.pisCofinsCst ?? '01');
    const icmsInternoEmp = emitente.icmsInterno != null ? Number(emitente.icmsInterno) : 18;
    const csosnEmp = emitente.csosn ?? '102';
    const icmsCstEmp = emitente.icmsCstPadrao ?? '00';
    // ICMS interestadual (origem SP, Res. Senado 22/89): Sul/Sudeste exceto ES = 12%, demais = 7%.
    const ufDest = (cliente.uf ?? '').toUpperCase();
    const aliqIcmsOperacao = mesmaUf ? icmsInternoEmp : (['MG', 'RJ', 'PR', 'SC', 'RS'].includes(ufDest) ? 12 : 7);

    // ===== Reforma Tributária (IBS/CBS) — período de transição 2026 =====
    const reformaAtiva = emitente.reformaAtiva !== false;
    const cbsAliq = emitente.cbsAliquota != null ? Number(emitente.cbsAliquota) : 0.9;
    const ibsUfAliq = emitente.ibsUfAliquota != null ? Number(emitente.ibsUfAliquota) : 0.1;
    const ibsMunAliq = emitente.ibsMunAliquota != null ? Number(emitente.ibsMunAliquota) : 0;
    const ibsCbsCst = emitente.ibsCbsCst ?? '000';
    const ibsCbsClassTrib = emitente.ibsCbsClassTrib ?? '000001';

    const items = itens.map((it, idx) => {
      const p = it.produtoId ? mapa.get(it.produtoId) : undefined;
      const bruto = it.valorUnit.mul(it.quantidade);
      const unidade = p?.unidadeComercial ?? 'UN';
      const valorUnit = Number(it.valorUnit.toFixed(2));
      const baseItem = Number(bruto.toFixed(2));
      const item: Record<string, unknown> = {
        numero_item: idx + 1,
        codigo_produto: p?.codigo ?? String(it.produtoId ?? idx + 1),
        descricao: it.descricao,
        cfop: extra?.cfopOverride ? this.ajustarCfop(extra.cfopOverride, mesmaUf) : (extra?.bonificacao ? (mesmaUf ? '5910' : '6910') : this.ajustarCfop(p?.cfop ?? '5101', mesmaUf)),
        // NCM: a Focus/SEFAZ espera o campo "codigo_ncm" (8 dígitos).
        codigo_ncm: (p?.ncm ?? '').replace(/\D/g, '') || '00000000',
        unidade_comercial: unidade,
        quantidade_comercial: it.quantidade,
        valor_unitario_comercial: valorUnit,
        unidade_tributavel: unidade,
        quantidade_tributavel: it.quantidade,
        valor_unitario_tributavel: valorUnit,
        valor_bruto: baseItem,
        icms_origem: p?.origem ?? 0,
      };
      if (extra?.semImpostos) {
        // Remessa de venda para entrega futura: a mercadoria já foi tributada na NF de
        // faturamento. Aqui é só a movimentação física — SEM novo ICMS/PIS/COFINS.
        if (simples) {
          item.icms_situacao_tributaria = '400'; // não tributada pelo Simples Nacional
          item.pis_situacao_tributaria = '49';
          item.cofins_situacao_tributaria = '49';
        } else {
          item.icms_situacao_tributaria = '41'; // Não tributada
          item.pis_situacao_tributaria = '08';   // sem incidência da contribuição
          item.cofins_situacao_tributaria = '08';
        }
      } else if (simples) {
        // Simples Nacional: CSOSN no ICMS + PIS/COFINS CST 49 (recolhidos no DAS).
        item.icms_situacao_tributaria = p?.icmsCst ?? csosnEmp;
        item.pis_situacao_tributaria = pisCofinsCstEmp;
        item.cofins_situacao_tributaria = pisCofinsCstEmp;
      } else {
        // Regime Normal (Lucro Real/Presumido): ICMS destacado + PIS/COFINS por alíquota.
        const cstIcms = p?.icmsCst ?? icmsCstEmp;
        const tributado = ['00', '10', '20', '70', '90'].includes(cstIcms);
        item.icms_situacao_tributaria = cstIcms;
        item.icms_modalidade_base_calculo = 3; // valor da operação
        item.icms_aliquota = aliqIcmsOperacao;
        item.icms_base_calculo = tributado ? baseItem : 0;
        item.icms_valor = tributado ? Number((baseItem * aliqIcmsOperacao / 100).toFixed(2)) : 0;
        item.pis_situacao_tributaria = p?.pisCst ?? pisCofinsCstEmp;
        item.cofins_situacao_tributaria = p?.cofinsCst ?? pisCofinsCstEmp;
        item.pis_aliquota_porcentual = pisAliqEmp;
        item.cofins_aliquota_porcentual = cofinsAliqEmp;
        // Exclusão do ICMS da base do PIS/COFINS (STF, "tese do século", Tema 69).
        // A base passa a ser o valor da operação MENOS o ICMS destacado.
        const baseSemIcms = Number((baseItem - (Number(item.icms_valor) || 0)).toFixed(2));
        if (['01', '02'].includes(String(item.pis_situacao_tributaria))) {
          item.pis_base_calculo = baseSemIcms;
          item.pis_valor = Number((baseSemIcms * pisAliqEmp / 100).toFixed(2));
        }
        if (['01', '02'].includes(String(item.cofins_situacao_tributaria))) {
          item.cofins_base_calculo = baseSemIcms;
          item.cofins_valor = Number((baseSemIcms * cofinsAliqEmp / 100).toFixed(2));
        }
      }

      // ===== Grupo IBS/CBS (Reforma Tributária) — transição 2026: CBS 0,9% e IBS 0,1% =====
      // Na remessa de entrega futura o fato gerador (venda) já ocorreu no faturamento → sem IBS/CBS aqui.
      if (reformaAtiva && !extra?.semImpostos) {
        const bcIbsCbs = baseItem;
        const vCbs = Number((bcIbsCbs * cbsAliq / 100).toFixed(2));
        const vIbsUf = Number((bcIbsCbs * ibsUfAliq / 100).toFixed(2));
        const vIbsMun = Number((bcIbsCbs * ibsMunAliq / 100).toFixed(2));
        item.ibs_cbs_situacao_tributaria = ibsCbsCst;
        item.ibs_cbs_classificacao_tributaria = ibsCbsClassTrib;
        item.ibs_cbs_base_calculo = bcIbsCbs;
        item.cbs_aliquota = cbsAliq;
        item.cbs_valor = vCbs;
        item.ibs_uf_aliquota = ibsUfAliq;
        item.ibs_uf_valor = vIbsUf;
        item.ibs_mun_aliquota = ibsMunAliq;
        item.ibs_mun_valor = vIbsMun;
        item.ibs_valor_total = Number((vIbsUf + vIbsMun).toFixed(2));
      }
      return item;
    });

    // Peso bruto/líquido estimado: total de peças × peso médio por peça (config. por empresa).
    const pesoMedio = emitente.pesoMedioPeca != null ? Number(emitente.pesoMedioPeca) : 0.3;
    const totalPecasNf = itens.reduce((s, it) => s + Number(it.quantidade), 0);
    const pesoBrutoNf = Number((totalPecasNf * pesoMedio).toFixed(3));

    // Volumes/peso: prioridade p/ o que foi INFORMADO na hora de emitir; senão usa as
    // CAIXAS montadas (peso real pesado); senão estima pelo peso médio.
    const caixasArr = Array.isArray(exp.caixas) ? (exp.caixas as Array<{ peso?: number | null }>) : [];
    const pesoCaixas = caixasArr.reduce((s, c) => s + (Number(c?.peso) || 0), 0);
    const pesoBase = pesoCaixas > 0 ? Number(pesoCaixas.toFixed(3)) : pesoBrutoNf;
    const pesoBrutoInf = extra?.pesoBruto != null && extra.pesoBruto > 0 ? Number(extra.pesoBruto.toFixed(3)) : null;
    const pesoLiqInf = extra?.pesoLiquido != null && extra.pesoLiquido > 0 ? Number(extra.pesoLiquido.toFixed(3)) : null;
    const pesoBrutoNota = pesoBrutoInf ?? pesoLiqInf ?? pesoBase;
    const pesoLiqNota = pesoLiqInf ?? pesoBrutoInf ?? pesoBase;
    const especieNota = (extra?.especie || '').toString().trim() || 'Caixa';
    const volumesNota = extra?.volumes || caixasArr.length || exp.volumes || 1;
    const tr = extra?.transportadora;
    const transportadoraNome = (tr?.nome || exp.transportadora || '').toString().trim();
    const modalidadeFrete = extra?.frete != null ? extra.frete : (transportadoraNome ? 0 : 9);
    const trDoc = tr?.cnpjCpf ? digitos(tr.cnpjCpf) : '';
    const placaVeic = (extra?.placa || tr?.placaVeiculo || '').toString().trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const transportadorBloco: Record<string, unknown> = transportadoraNome
      ? {
          transportador_nome: transportadoraNome.slice(0, 60),
          transportador_razao_social: transportadoraNome.slice(0, 60),
          ...(trDoc ? (trDoc.length === 11 ? { transportador_cpf: trDoc } : { transportador_cnpj: trDoc }) : {}),
          ...(tr?.inscricaoEstadual ? { transportador_inscricao_estadual: tr.inscricaoEstadual } : {}),
          ...(tr?.logradouro ? { transportador_endereco: tr.logradouro } : {}),
          ...(tr?.municipio ? { transportador_nome_municipio: tr.municipio } : {}),
          ...(tr?.uf ? { transportador_uf: (tr.uf || '').toUpperCase() } : {}),
          ...(placaVeic ? { veiculo_placa: placaVeic } : {}),
          ...((tr?.ufVeiculo || tr?.uf) ? { veiculo_uf: ((tr?.ufVeiculo || tr?.uf) || '').toUpperCase() } : {}),
          ...(tr?.rntc ? { veiculo_rntc: tr.rntc } : {}),
        }
      : {};

    // Inscrição Estadual do destinatário: a SEFAZ só aceita a tag IE com 2-14 dígitos.
    // Se não houver IE válida, omite a tag e ajusta o indicador (contribuinte sem IE é inválido → 9).
    const ieDigitos = digitos(cliente.inscricaoEstadual || '');
    const ieValida = ieDigitos.length >= 2 && ieDigitos.length <= 14;
    let indicadorIeDest = cliente.indicadorIE ?? 9;
    if (!ieValida && indicadorIeDest === 1) indicadorIeDest = 9; // sem IE não pode ser "Contribuinte"

    return {
      natureza_operacao: extra?.bonificacao ? 'Remessa em bonificacao, doacao ou brinde' : 'Venda de mercadoria',
      data_emissao: new Date().toISOString(),
      tipo_documento: 1, // 1 = saída
      finalidade_emissao: 1, // 1 = normal
      presenca_comprador: 9,
      modalidade_frete: modalidadeFrete, // 0=emitente(CIF) 1=destinatário(FOB) 9=sem frete
      ...transportadorBloco,
      serie,
      numero,
      // Emitente (dados também configurados no painel do provedor)
      cnpj_emitente: digitos(emitente.cnpj),
      // Destinatário
      // SEFAZ limita xNome (destinatário) a 60 caracteres — trunca p/ não rejeitar.
      nome_destinatario: (cliente.nome || '').trim().slice(0, 60),
      [docDest.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: docDest,
      inscricao_estadual_destinatario: ieValida ? ieDigitos : null,
      indicador_inscricao_estadual_destinatario: indicadorIeDest,
      logradouro_destinatario: cliente.logradouro,
      numero_destinatario: cliente.numeroEndereco,
      bairro_destinatario: cliente.bairro,
      municipio_destinatario: cliente.municipio,
      uf_destinatario: cliente.uf,
      cep_destinatario: digitos(cliente.cep),
      valor_total: Number(valorTotal.toFixed(2)),
      // Volume e peso no DANFE (Focus espera um ARRAY "volumes"; sem isso a caixa/peso não sai).
      volumes: [
        {
          quantidade: volumesNota,
          especie: especieNota,
          peso_liquido: pesoLiqNota,
          peso_bruto: pesoBrutoNota,
        },
      ],
      ...(extra?.duplicatas && extra.duplicatas.length
        ? {
            // Grupo de cobrança (fatura + duplicatas) — leva o vencimento p/ o cliente.
            fatura_numero: String(numero),
            fatura_valor_original: Number(valorTotal.toFixed(2)),
            fatura_valor_liquido: Number(valorTotal.toFixed(2)),
            duplicatas: extra.duplicatas,
          }
        : {}),
      ...(infoAdicional ? { informacoes_adicionais_contribuinte: infoAdicional.slice(0, 5000) } : {}),
      items,
    };
  }

  /**
   * Token Focus da filial escolhido pelo AMBIENTE (cada CNPJ tem token próprio na Focus):
   * produção → focusTokenProd; homologação → focusTokenHomolog; senão o genérico/global.
   */
  private tokenDaFilial(filial: { nfeAmbiente?: string | null; focusToken?: string | null; focusTokenHomolog?: string | null; focusTokenProd?: string | null } | null): string | undefined {
    const amb = filial?.nfeAmbiente || this.config.get<string>('NFE_AMBIENTE');
    const perAmb = amb === 'producao' ? filial?.focusTokenProd : filial?.focusTokenHomolog;
    return perAmb || filial?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN') || undefined;
  }

  /**
   * Host da API Focus por ambiente (produção usa api.; homologação usa homologacao.).
   * `amb` (ambiente da filial) sobrepõe o NFE_AMBIENTE global quando informado.
   */
  private focusHost(amb?: string | null): string {
    const ambiente = amb || this.config.get<string>('NFE_AMBIENTE');
    return ambiente === 'producao' ? 'api.focusnfe.com.br' : 'homologacao.focusnfe.com.br';
  }

  // ===== Provedores =====
  private async emitirFocusNfe(token: string, ref: string, payload: unknown, amb?: string | null) {
    const url = `https://${this.focusHost(amb)}/v2/nfe?ref=${encodeURIComponent(ref)}`;
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
      // Referência já processada: a nota JÁ existe na Focus (talvez autorizada num
      // envio anterior que não foi gravado aqui). Consulta e RECUPERA o status real
      // em vez de rejeitar — evita "corrija e reemita" numa nota que já saiu.
      const jaProcessada = body['codigo'] === 'already_processed' || /já foi (autorizada|processada|enviada)/i.test(String(body['mensagem'] ?? ''));
      if (res.status === 422 && jaProcessada) {
        const c = await this.consultarFocus(token, ref, amb);
        const mapa: Record<string, 'pendente' | 'autorizada' | 'rejeitada'> = {
          autorizado: 'autorizada', processando_autorizacao: 'pendente',
          erro_autorizacao: 'rejeitada', denegado: 'rejeitada', cancelado: 'rejeitada',
        };
        const st = mapa[c.status] ?? 'pendente';
        return {
          chave: c.chave,
          status: st,
          protocolo: c.protocolo,
          motivo: st === 'autorizada' ? 'Nota já estava autorizada na SEFAZ — recuperada automaticamente.' : c.motivo,
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
