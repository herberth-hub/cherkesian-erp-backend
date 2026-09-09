import { Injectable, NotFoundException } from '@nestjs/common';
import { Empresa, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';

/** Registro de teste do PCT (Plano de Controle de Teste). */
type PctTeste = { id: string; ts: string; funcionalidade: string; status: string; obs?: string; usuario?: string };

@Injectable()
export class EmpresaService {
  constructor(private readonly prisma: PrismaService) {}

  async get(empresaId: number): Promise<Empresa> {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return empresa;
  }

  update(empresaId: number, dto: UpdateEmpresaDto): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id: empresaId }, data: dto });
  }

  /**
   * Diagnóstico de prontidão fiscal: aponta o que falta para emitir NF-e real.
   * (Não substitui a validação da contabilidade sobre CST/CFOP/alíquotas.)
   */
  async prontidaoFiscal(empresaId: number) {
    const empresa = await this.get(empresaId);
    const pendencias: string[] = [];
    const obrig: Array<[keyof Empresa, string]> = [
      ['cnpj', 'CNPJ'],
      ['inscricaoEstadual', 'Inscrição Estadual'],
      ['logradouro', 'Logradouro'],
      ['numeroEndereco', 'Número'],
      ['bairro', 'Bairro'],
      ['municipio', 'Município'],
      ['codMunicipio', 'Código IBGE do município'],
      ['uf', 'UF'],
      ['cep', 'CEP'],
    ];
    for (const [campo, rotulo] of obrig) {
      if (!empresa[campo]) pendencias.push(`Empresa: ${rotulo}`);
    }
    const produtosSemNcm = await this.prisma.produto.count({
      where: { empresaId, OR: [{ ncm: null }, { cfop: null }] },
    });
    if (produtosSemNcm > 0) pendencias.push(`${produtosSemNcm} produto(s) sem NCM/CFOP`);

    return {
      pronto: pendencias.length === 0,
      pendencias,
      integracao: process.env.FOCUS_NFE_TOKEN
        ? `Provedor Focus NFe configurado (ambiente: ${process.env.NFE_AMBIENTE || 'homologacao'}).`
        : 'FOCUS_NFE_TOKEN não configurado — emissão em modo simulado.',
    };
  }

  // ===================== PCT — Plano de Controle de Teste =====================
  /** Estado do modo PCT (ligado?) + registros de teste. */
  async pctGet(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { pctAtivo: true, pctTestes: true } });
    return { ativo: !!e?.pctAtivo, testes: (e?.pctTestes as PctTeste[] | null) ?? [] };
  }

  /** Liga/desliga o modo PCT (banner no sistema). */
  async pctSetAtivo(empresaId: number, ativo: boolean) {
    await this.prisma.empresa.update({ where: { id: empresaId }, data: { pctAtivo: !!ativo } });
    return this.pctGet(empresaId);
  }

  /** Registra um teste no PCT (funcionalidade · status OK/gap/melhoria · observação). */
  async pctAddTeste(empresaId: number, dto: { funcionalidade: string; status: string; obs?: string }, usuario: string) {
    const atual = await this.pctGet(empresaId);
    const novo = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      funcionalidade: String(dto.funcionalidade ?? '').slice(0, 160),
      status: ['ok', 'gap', 'melhoria'].includes(dto.status) ? dto.status : 'gap',
      obs: String(dto.obs ?? '').slice(0, 1000),
      usuario,
    };
    const lista = [novo, ...atual.testes].slice(0, 500);
    await this.prisma.empresa.update({ where: { id: empresaId }, data: { pctTestes: lista as unknown as Prisma.InputJsonValue } });
    return { ativo: atual.ativo, testes: lista };
  }

  /** Remove um registro de teste do PCT. */
  async pctDelTeste(empresaId: number, id: string) {
    const atual = await this.pctGet(empresaId);
    const lista = atual.testes.filter((t) => t.id !== id);
    await this.prisma.empresa.update({ where: { id: empresaId }, data: { pctTestes: lista as unknown as Prisma.InputJsonValue } });
    return { ativo: atual.ativo, testes: lista };
  }

  /**
   * DIAGNÓSTICO automático (mapa de gaps) — bateria de checagens SÓ-LEITURA que
   * varre o estado atual e aponta inconsistências/gaps de processo que podem
   * passar despercebidos na análise manual. Não altera nada.
   */
  async diagnosticoGaps(empresaId: number) {
    const hoje = new Date();
    const diasAtras = (n: number) => new Date(hoje.getTime() - n * 864e5);
    type Achado = { chave: string; severidade: 'alta' | 'media' | 'baixa'; area: string; rota: string; titulo: string; qtd: number; exemplos: string[] };
    const achados: Achado[] = [];
    const add = (a: Achado) => { if (a.qtd > 0) achados.push(a); };

    // 1) Pedidos em expedição/parcial SEM nenhuma NF ativa (venda não faturada).
    const nfPorPedido = await this.prisma.notaFiscal.findMany({ where: { empresaId, pedidoId: { not: null }, status: { in: ['pendente', 'autorizada', 'simulada'] } }, select: { pedidoId: true } });
    const comNf = new Set(nfPorPedido.map((n) => n.pedidoId as number));
    const pedExp = await this.prisma.pedido.findMany({ where: { empresaId, etapa: { in: ['expedicao', 'parcial'] } }, select: { id: true, numero: true } });
    const semNf = pedExp.filter((p) => !comNf.has(p.id));
    add({ chave: 'pedido_sem_nf', severidade: 'alta', area: 'Faturamento', rota: 'vendas', titulo: 'Pedidos em expedição/parcial SEM NF emitida', qtd: semNf.length, exemplos: semNf.slice(0, 6).map((p) => p.numero) });

    // 2) NF-e PENDENTE há mais de 1 dia (aguardando consulta na SEFAZ).
    const nfPend = await this.prisma.notaFiscal.findMany({ where: { empresaId, status: 'pendente', emitidaEm: { lt: diasAtras(1) } }, select: { numero: true } });
    add({ chave: 'nf_pendente', severidade: 'alta', area: 'Fiscal', rota: 'nfe', titulo: 'NF-e pendente há +1 dia — consultar SEFAZ', qtd: nfPend.length, exemplos: nfPend.slice(0, 6).map((n) => n.numero) });

    // 3) NF-e REJEITADA (precisa corrigir e reemitir).
    const nfRej = await this.prisma.notaFiscal.findMany({ where: { empresaId, status: 'rejeitada' }, select: { numero: true }, take: 20 });
    add({ chave: 'nf_rejeitada', severidade: 'media', area: 'Fiscal', rota: 'nfe', titulo: 'NF-e rejeitada — corrigir e reemitir', qtd: nfRej.length, exemplos: nfRej.slice(0, 6).map((n) => n.numero) });

    // 4) OPs em produção SEM nenhuma OS gerada (kit/controle) — corte sem roteiro de facção.
    const opsProd = await this.prisma.oP.findMany({ where: { OR: [{ empresaId }, { pedido: { empresaId } }], status: { in: ['em_corte', 'em_producao', 'em_faccao'] } }, select: { id: true, numero: true } });
    const kitsOpIds = opsProd.length ? await this.prisma.kit.findMany({ where: { empresaId, opId: { in: opsProd.map((o) => o.id) } }, select: { opId: true } }) : [];
    const opComKit = new Set(kitsOpIds.map((k) => k.opId));
    const opSemOs = opsProd.filter((o) => !opComKit.has(o.id));
    add({ chave: 'op_sem_os', severidade: 'media', area: 'Produção', rota: 'ops', titulo: 'OPs em produção sem OS/kit gerado', qtd: opSemOs.length, exemplos: opSemOs.slice(0, 6).map((o) => o.numero) });

    // 5) Kits parados em facção há +15 dias (risco de atraso/perda).
    const kitParado = await this.prisma.kit.findMany({ where: { empresaId, status: 'em_faccao', expedidoEm: { lt: diasAtras(15) } }, select: { codigo: true, faccaoNome: true } });
    add({ chave: 'kit_parado', severidade: 'media', area: 'Produção', rota: 'kits', titulo: 'Kits em facção há +15 dias', qtd: kitParado.length, exemplos: kitParado.slice(0, 6).map((k) => `${k.codigo}${k.faccaoNome ? ' · ' + k.faccaoNome : ''}`) });

    // 6) Contas a RECEBER vencidas e não quitadas (inadimplência a cobrar).
    const recVenc = await this.prisma.contaReceber.findMany({ where: { empresaId, vencimento: { lt: hoje }, status: { not: 'pago' } }, select: { id: true, vencimento: true } });
    add({ chave: 'receber_vencido', severidade: 'alta', area: 'Financeiro', rota: 'receber', titulo: 'Contas a receber vencidas em aberto', qtd: recVenc.length, exemplos: recVenc.slice(0, 6).map((r) => 'venc ' + r.vencimento.toISOString().slice(0, 10)) });

    // 7) Contas a PAGAR vencidas e não quitadas.
    const pagVenc = await this.prisma.contaPagar.findMany({ where: { empresaId, vencimento: { lt: hoje }, status: { not: 'pago' } }, select: { id: true, vencimento: true } });
    add({ chave: 'pagar_vencido', severidade: 'media', area: 'Financeiro', rota: 'pagar', titulo: 'Contas a pagar vencidas em aberto', qtd: pagVenc.length, exemplos: pagVenc.slice(0, 6).map((p) => 'venc ' + p.vencimento.toISOString().slice(0, 10)) });

    // 8) Estoque aguardando endereço há +2 dias (recebido e não endereçado).
    const semEndereco = await this.prisma.unidadeEstoque.count({ where: { empresaId, status: 'aguardando_endereco', criadoEm: { lt: diasAtras(2) } } });
    add({ chave: 'estoque_sem_endereco', severidade: 'baixa', area: 'Estoque', rota: 'estoque', titulo: 'Peças aguardando endereço há +2 dias', qtd: semEndereco, exemplos: [] });

    // 9) Pedidos em produção SEM prazo de entrega (radar de atraso cego).
    const semPrazo = await this.prisma.pedido.findMany({ where: { empresaId, prazoEntrega: null, etapa: { in: ['aprovado', 'material', 'compra', 'producao', 'estoque', 'expedicao', 'parcial'] } }, select: { numero: true } });
    add({ chave: 'pedido_sem_prazo', severidade: 'baixa', area: 'Comercial', rota: 'vendas', titulo: 'Pedidos em produção sem prazo de entrega definido', qtd: semPrazo.length, exemplos: semPrazo.slice(0, 6).map((p) => p.numero) });

    // 10) Pedidos com prazo ESTOURADO ainda não concluídos.
    const atrasados = await this.prisma.pedido.findMany({ where: { empresaId, prazoEntrega: { lt: hoje }, etapa: { notIn: ['concluido', 'cancelado', 'orcamento'] } }, select: { numero: true, prazoEntrega: true } });
    add({ chave: 'pedido_atrasado', severidade: 'alta', area: 'Comercial', rota: 'vendas', titulo: 'Pedidos com prazo de entrega estourado', qtd: atrasados.length, exemplos: atrasados.slice(0, 6).map((p) => `${p.numero}${p.prazoEntrega ? ' · ' + p.prazoEntrega.toISOString().slice(0, 10) : ''}`) });

    const ordem = { alta: 0, media: 1, baixa: 2 } as const;
    achados.sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || b.qtd - a.qtd);
    return {
      geradoEm: hoje.toISOString(),
      totalGaps: achados.reduce((s, a) => s + a.qtd, 0),
      resumo: { alta: achados.filter((a) => a.severidade === 'alta').length, media: achados.filter((a) => a.severidade === 'media').length, baixa: achados.filter((a) => a.severidade === 'baixa').length },
      achados,
    };
  }
}
