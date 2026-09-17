import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { AuthUser } from '../auth/auth.types';
import { Area } from '../common/rbac/acesso.config';
import { proximoSequencial } from '../common/utils/codigo.util';
import {
  AtualizarAnomaliaDto,
  ComentarDto,
  CriarAnomaliaDto,
  MoverStatusDto,
  STATUS,
  StatusAnomalia,
} from './dto/anomalia.dto';

/** Status que já encerraram a anomalia — não contam como pendência. */
const FECHADOS: string[] = ['resolvida', 'cancelada'];

/** O registro como as telas consomem — `eventos`/`_count` só vêm quando a consulta pede. */
type AnomaliaRegistro = Prisma.AnomaliaGetPayload<object> & {
  eventos?: Array<{
    id: number; tipo: string; de: string | null; para: string | null; texto: string | null;
    anexo: string | null; anexoNome: string | null; usuario: string; criadoEm: Date;
  }>;
  _count?: { eventos: number };
};

/**
 * Para onde a anomalia é avisada. Comercial entra SEMPRE: é quem responde ao cliente,
 * mesmo quando a execução é da produção ou da expedição.
 */
const AREA_DO_SETOR: Record<string, Area[]> = {
  comercial: ['vendas'],
  producao: ['producao', 'pcp'],
  expedicao: ['expedicao'],
  qualidade: ['producao'],
  financeiro: ['receber'],
};

/** Setor que costuma executar cada tipo — só uma sugestão, quem abre pode trocar. */
const SETOR_SUGERIDO: Record<string, string> = {
  defeito: 'producao',
  tamanho: 'producao',
  cor: 'producao',
  falta: 'expedicao',
  troca: 'comercial',
  atraso: 'producao',
  entrega: 'expedicao',
  nota: 'financeiro',
  outro: 'comercial',
};

const ROTULO_STATUS: Record<string, string> = {
  aberta: 'Aberta',
  analise: 'Em análise',
  acao: 'Ação definida',
  execucao: 'Em execução',
  resolvida: 'Resolvida',
  cancelada: 'Cancelada',
};

@Injectable()
export class AnomaliasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  private quem(user: AuthUser) {
    return String(user.usuario || user.nome || 'sistema').slice(0, 150);
  }

  /** Avisa as áreas envolvidas dentro do ERP (sino de notificações). */
  private async avisar(
    empresaId: number,
    setor: string | null,
    titulo: string,
    mensagem: string,
    anomaliaId: number,
  ) {
    const areas = new Set<Area>(['vendas']);
    for (const a of AREA_DO_SETOR[setor ?? ''] ?? []) areas.add(a);
    await this.notificacoes.criar(empresaId, {
      tipo: 'anomalia',
      areas: [...areas],
      titulo,
      mensagem,
      refTipo: 'anomalia',
      refId: anomaliaId,
    });
  }

  /** Contexto legível do pedido/cliente, para a lista não exigir um clique por linha. */
  private async contexto(empresaId: number, anomalias: Array<{ pedidoId: number | null; clienteId: number | null }>) {
    const pedIds = [...new Set(anomalias.map((a) => a.pedidoId).filter((x): x is number => x != null))];
    const cliIds = [...new Set(anomalias.map((a) => a.clienteId).filter((x): x is number => x != null))];
    const [peds, clis] = [
      pedIds.length
        ? await this.prisma.pedido.findMany({
            where: { id: { in: pedIds }, empresaId },
            select: { id: true, numero: true, etapa: true, clienteId: true },
          })
        : [],
      cliIds.length
        ? await this.prisma.cliente.findMany({
            where: { id: { in: cliIds }, empresaId },
            select: { id: true, nome: true, fantasia: true },
          })
        : [],
    ];
    return {
      pedidos: new Map(peds.map((p) => [p.id, p])),
      clientes: new Map(clis.map((c) => [c.id, c.fantasia || c.nome])),
    };
  }

  /** Abre a anomalia e já registra o evento de abertura + o aviso às áreas. */
  async criar(dto: CriarAnomaliaDto, user: AuthUser) {
    const empresaId = user.empresaId;

    // Pedido e cliente precisam ser da empresa; o cliente vem do pedido quando não informado.
    let clienteId = dto.clienteId ?? null;
    if (dto.pedidoId) {
      const ped = await this.prisma.pedido.findFirst({
        where: { id: dto.pedidoId, empresaId },
        select: { id: true, clienteId: true },
      });
      if (!ped) throw new BadRequestException('Pedido não encontrado nesta empresa.');
      clienteId = clienteId ?? ped.clienteId;
    }

    const existentes = await this.prisma.anomalia.findMany({
      where: { empresaId },
      select: { numero: true },
      orderBy: { id: 'desc' },
      take: 400,
    });
    const numero = proximoSequencial('AN', existentes.map((a) => a.numero), { pad: 4, separador: '-' });
    const setor = dto.setor ?? SETOR_SUGERIDO[dto.tipo] ?? 'comercial';

    const anomalia = await this.prisma.anomalia.create({
      data: {
        empresaId,
        numero,
        pedidoId: dto.pedidoId ?? null,
        clienteId,
        notaFiscalId: dto.notaFiscalId ?? null,
        produtoId: dto.produtoId ?? null,
        itemDescricao: dto.itemDescricao ?? null,
        cor: dto.cor ?? null,
        tamanho: dto.tamanho ?? null,
        quantidade: dto.quantidade ?? null,
        tipo: dto.tipo,
        gravidade: dto.gravidade ?? 'media',
        origem: dto.origem ?? 'interna',
        titulo: dto.titulo.trim(),
        descricao: dto.descricao.trim(),
        setor,
        responsavel: dto.responsavel ?? null,
        prazo: dto.prazo ? new Date(dto.prazo) : null,
        abertoPor: this.quem(user),
        eventos: {
          create: {
            tipo: 'abertura',
            para: 'aberta',
            texto: dto.descricao.trim(),
            anexo: dto.anexo ?? null,
            anexoNome: dto.anexoNome ?? null,
            usuario: this.quem(user),
          },
        },
      },
      include: { eventos: { orderBy: { id: 'asc' } } },
    });

    const ctx = await this.contexto(empresaId, [anomalia]);
    const ped = anomalia.pedidoId ? ctx.pedidos.get(anomalia.pedidoId) : null;
    const cli = anomalia.clienteId ? ctx.clientes.get(anomalia.clienteId) : null;
    await this.avisar(
      empresaId,
      setor,
      `Anomalia ${anomalia.numero} — ${anomalia.titulo}`,
      `${anomalia.gravidade === 'alta' ? 'PRIORIDADE ALTA · ' : ''}${cli ?? 'cliente não informado'}${ped ? ` · pedido ${ped.numero}` : ''} · aberta por ${anomalia.abertoPor}. Responsável: ${setor}.`,
      anomalia.id,
    );

    return this.montar(anomalia, ctx);
  }

  /** Lista com filtros. Por padrão traz só o que ainda está em aberto. */
  async listar(
    user: AuthUser,
    filtros: { status?: string; tipo?: string; setor?: string; pedidoId?: number; clienteId?: number; incluirFechadas?: boolean },
  ) {
    const where: Prisma.AnomaliaWhereInput = { empresaId: user.empresaId };
    if (filtros.status) where.status = filtros.status;
    else if (!filtros.incluirFechadas) where.status = { notIn: FECHADOS };
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.setor) where.setor = filtros.setor;
    if (filtros.pedidoId) where.pedidoId = filtros.pedidoId;
    if (filtros.clienteId) where.clienteId = filtros.clienteId;

    const linhas = await this.prisma.anomalia.findMany({
      where,
      orderBy: [{ status: 'asc' }, { id: 'desc' }],
      take: 500,
      include: { _count: { select: { eventos: true } } },
    });
    const ctx = await this.contexto(user.empresaId, linhas);
    return { total: linhas.length, anomalias: linhas.map((a) => this.montar(a, ctx)) };
  }

  /** Contagem por status e as que estouraram o prazo — alimenta o cabeçalho da tela. */
  async resumo(user: AuthUser) {
    const porStatus = await this.prisma.anomalia.groupBy({
      by: ['status'],
      where: { empresaId: user.empresaId },
      _count: { _all: true },
    });
    const contagem: Record<string, number> = {};
    for (const s of STATUS) contagem[s] = 0;
    for (const r of porStatus) contagem[r.status] = r._count._all;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const atrasadas = await this.prisma.anomalia.count({
      where: { empresaId: user.empresaId, status: { notIn: FECHADOS }, prazo: { lt: hoje } },
    });
    const altas = await this.prisma.anomalia.count({
      where: { empresaId: user.empresaId, status: { notIn: FECHADOS }, gravidade: 'alta' },
    });
    const abertas = STATUS.filter((s) => !FECHADOS.includes(s)).reduce((n, s) => n + (contagem[s] ?? 0), 0);
    return { contagem, abertas, atrasadas, altas };
  }

  async obter(id: number, user: AuthUser) {
    const a = await this.prisma.anomalia.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { eventos: { orderBy: { id: 'asc' } } },
    });
    if (!a) throw new NotFoundException(`Anomalia ${id} não encontrada.`);
    const ctx = await this.contexto(user.empresaId, [a]);
    return this.montar(a, ctx, true);
  }

  /** Muda o que estava definido — cada campo alterado vira um evento no histórico. */
  async atualizar(id: number, dto: AtualizarAnomaliaDto, user: AuthUser) {
    const atual = await this.prisma.anomalia.findFirst({ where: { id, empresaId: user.empresaId } });
    if (!atual) throw new NotFoundException(`Anomalia ${id} não encontrada.`);
    if (FECHADOS.includes(atual.status)) {
      throw new BadRequestException('Anomalia encerrada. Reabra antes de alterar.');
    }

    const data: Prisma.AnomaliaUpdateInput = {};
    const eventos: Prisma.AnomaliaEventoCreateManyInput[] = [];
    const usuario = this.quem(user);
    const anota = (tipo: string, de: string | null, para: string | null, texto?: string) =>
      eventos.push({ anomaliaId: id, tipo, de, para, texto: texto ?? null, usuario });

    if (dto.setor !== undefined && dto.setor !== atual.setor) {
      data.setor = dto.setor;
      anota('responsavel', atual.setor, dto.setor, 'Setor responsável alterado.');
    }
    if (dto.responsavel !== undefined && dto.responsavel !== atual.responsavel) {
      data.responsavel = dto.responsavel || null;
      anota('responsavel', atual.responsavel, dto.responsavel || null, 'Responsável alterado.');
    }
    if (dto.gravidade !== undefined && dto.gravidade !== atual.gravidade) {
      data.gravidade = dto.gravidade;
      anota('alteracao', atual.gravidade, dto.gravidade, 'Gravidade alterada.');
    }
    if (dto.tipo !== undefined && dto.tipo !== atual.tipo) {
      data.tipo = dto.tipo;
      anota('alteracao', atual.tipo, dto.tipo, 'Tipo alterado.');
    }
    if (dto.titulo !== undefined && dto.titulo.trim() !== atual.titulo) {
      data.titulo = dto.titulo.trim();
      anota('alteracao', atual.titulo, dto.titulo.trim(), 'Título alterado.');
    }
    if (dto.acao !== undefined && (dto.acao || null) !== atual.acao) {
      data.acao = dto.acao || null;
      anota('acao', null, null, dto.acao || '(ação removida)');
    }
    if (dto.prazo !== undefined) {
      const novo = dto.prazo ? new Date(dto.prazo) : null;
      const igual = (novo?.getTime() ?? null) === (atual.prazo?.getTime() ?? null);
      if (!igual) {
        data.prazo = novo;
        anota('alteracao', atual.prazo?.toISOString().slice(0, 10) ?? null, novo?.toISOString().slice(0, 10) ?? null, 'Prazo alterado.');
      }
    }

    if (!eventos.length) return this.obter(id, user);

    await this.prisma.anomalia.update({ where: { id }, data });
    await this.prisma.anomaliaEvento.createMany({ data: eventos });

    if (data.setor) {
      await this.avisar(
        user.empresaId,
        String(data.setor),
        `Anomalia ${atual.numero} passou para ${data.setor}`,
        `${atual.titulo} — encaminhada por ${usuario}.`,
        id,
      );
    }
    return this.obter(id, user);
  }

  /**
   * Move o status. O fluxo é livre para frente e para trás (a realidade da fábrica não é
   * linear), mas encerrar exige dizer como terminou — é isso que faz o histórico valer.
   */
  async mover(id: number, dto: MoverStatusDto, user: AuthUser) {
    const atual = await this.prisma.anomalia.findFirst({ where: { id, empresaId: user.empresaId } });
    if (!atual) throw new NotFoundException(`Anomalia ${id} não encontrada.`);
    const novo = dto.status as StatusAnomalia;
    if (novo === atual.status) return this.obter(id, user);

    const encerrando = FECHADOS.includes(novo);
    const resolucao = (dto.resolucao ?? '').trim();
    if (encerrando && resolucao.length < 4) {
      throw new BadRequestException(
        novo === 'resolvida'
          ? 'Descreva como foi resolvido antes de encerrar.'
          : 'Diga o motivo do cancelamento.',
      );
    }

    await this.prisma.anomalia.update({
      where: { id },
      data: {
        status: novo,
        resolucao: encerrando ? resolucao : atual.resolucao,
        fechadoEm: encerrando ? new Date() : null,
      },
    });
    await this.prisma.anomaliaEvento.create({
      data: {
        anomaliaId: id,
        tipo: 'status',
        de: atual.status,
        para: novo,
        texto: encerrando ? resolucao : null,
        usuario: this.quem(user),
      },
    });

    await this.avisar(
      user.empresaId,
      atual.setor,
      `Anomalia ${atual.numero}: ${ROTULO_STATUS[novo] ?? novo}`,
      `${atual.titulo} — ${ROTULO_STATUS[atual.status] ?? atual.status} → ${ROTULO_STATUS[novo] ?? novo} por ${this.quem(user)}.${encerrando ? ` ${resolucao}` : ''}`,
      id,
    );
    return this.obter(id, user);
  }

  /** Comentário e/ou anexo na linha do tempo. */
  async comentar(id: number, dto: ComentarDto, user: AuthUser) {
    const atual = await this.prisma.anomalia.findFirst({ where: { id, empresaId: user.empresaId } });
    if (!atual) throw new NotFoundException(`Anomalia ${id} não encontrada.`);
    const texto = (dto.texto ?? '').trim();
    if (!texto && !dto.anexo) throw new BadRequestException('Escreva algo ou anexe um arquivo.');

    await this.prisma.anomaliaEvento.create({
      data: {
        anomaliaId: id,
        tipo: dto.anexo ? 'anexo' : 'comentario',
        texto: texto || null,
        anexo: dto.anexo ?? null,
        anexoNome: dto.anexoNome ?? null,
        usuario: this.quem(user),
      },
    });
    await this.prisma.anomalia.update({ where: { id }, data: { atualizadoEm: new Date() } });

    await this.avisar(
      user.empresaId,
      atual.setor,
      `Anomalia ${atual.numero}: nova mensagem`,
      `${this.quem(user)}: ${(texto || dto.anexoNome || 'anexo').slice(0, 200)}`,
      id,
    );
    return this.obter(id, user);
  }

  /** Baixa o anexo de um evento (foto do defeito, comprovante). */
  async anexo(anomaliaId: number, eventoId: number, user: AuthUser) {
    const ev = await this.prisma.anomaliaEvento.findFirst({
      where: { id: eventoId, anomaliaId, anomalia: { empresaId: user.empresaId } },
      select: { anexo: true, anexoNome: true },
    });
    if (!ev?.anexo) throw new NotFoundException('Anexo não encontrado.');
    const m = /^data:([^;]+);base64,(.*)$/s.exec(ev.anexo);
    if (!m) throw new BadRequestException('Anexo em formato inesperado.');
    return {
      contentType: m[1],
      filename: ev.anexoNome || 'anexo',
      content: Buffer.from(m[2], 'base64'),
    };
  }

  /** Monta o retorno com o contexto legível; a linha do tempo só na tela de detalhe. */
  private montar(
    a: AnomaliaRegistro,
    ctx: { pedidos: Map<number, { numero: string; etapa: string }>; clientes: Map<number, string> },
    comEventos = false,
  ) {
    const ped = a.pedidoId ? ctx.pedidos.get(a.pedidoId) : null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const eventos = a.eventos;
    return {
      id: a.id,
      numero: a.numero,
      titulo: a.titulo,
      descricao: a.descricao,
      tipo: a.tipo,
      gravidade: a.gravidade,
      origem: a.origem,
      status: a.status,
      statusLabel: ROTULO_STATUS[a.status] ?? a.status,
      setor: a.setor,
      responsavel: a.responsavel,
      acao: a.acao,
      prazo: a.prazo,
      atrasada: !!a.prazo && !FECHADOS.includes(a.status) && a.prazo < hoje,
      resolucao: a.resolucao,
      pedidoId: a.pedidoId,
      pedido: ped?.numero ?? null,
      pedidoEtapa: ped?.etapa ?? null,
      clienteId: a.clienteId,
      cliente: a.clienteId ? ctx.clientes.get(a.clienteId) ?? null : null,
      notaFiscalId: a.notaFiscalId,
      produtoId: a.produtoId,
      itemDescricao: a.itemDescricao,
      cor: a.cor,
      tamanho: a.tamanho,
      quantidade: a.quantidade,
      abertoPor: a.abertoPor,
      criadoEm: a.criadoEm,
      atualizadoEm: a.atualizadoEm,
      fechadoEm: a.fechadoEm,
      interacoes: a._count?.eventos ?? eventos?.length ?? 0,
      eventos: comEventos && eventos
        ? eventos.map((e) => ({
            id: e.id,
            tipo: e.tipo,
            de: e.de,
            para: e.para,
            texto: e.texto,
            temAnexo: !!e.anexo,
            anexoNome: e.anexoNome,
            usuario: e.usuario,
            criadoEm: e.criadoEm,
          }))
        : undefined,
    };
  }
}
