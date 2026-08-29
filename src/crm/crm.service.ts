import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { ConverterLeadDto, CreateLeadDto, ETAPAS_FUNIL, InteracaoDto, MoverEtapaDto, UpdateLeadDto } from './dto/lead.dto';

/**
 * CRM / funil de vendas. Vendedor enxerga só a própria carteira; managers
 * (total/comercial) enxergam tudo da empresa. O escopo é aplicado aqui.
 */
@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  private ehVendedor(user: AuthUser) {
    return user.acesso === 'vendedor';
  }

  /** Cláusula de escopo: vendedor só vê o que é dele. */
  private escopo(user: AuthUser): Prisma.LeadWhereInput {
    return this.ehVendedor(user)
      ? { empresaId: user.empresaId, vendedorId: user.sub }
      : { empresaId: user.empresaId };
  }

  private parseData(s?: string): Date | null {
    if (!s) return null;
    const d = new Date(s.length <= 10 ? `${s}T00:00:00.000Z` : s);
    return isNaN(d.getTime()) ? null : d;
  }

  async listar(user: AuthUser, etapa?: string) {
    const where = this.escopo(user);
    if (etapa && ETAPAS_FUNIL.includes(etapa as never)) (where as Record<string, unknown>).etapa = etapa;
    return this.prisma.lead.findMany({
      where,
      orderBy: [{ atualizadoEm: 'desc' }],
      include: { _count: { select: { interacoes: true } } },
    });
  }

  /** Resumo do funil: contagem e valor estimado por etapa (respeita escopo). */
  async resumo(user: AuthUser) {
    const leads = await this.prisma.lead.findMany({
      where: this.escopo(user),
      select: { etapa: true, valorEstimado: true },
    });
    const porEtapa: Record<string, { qtd: number; valor: number }> = {};
    for (const e of ETAPAS_FUNIL) porEtapa[e] = { qtd: 0, valor: 0 };
    for (const l of leads) {
      const e = porEtapa[l.etapa] ?? (porEtapa[l.etapa] = { qtd: 0, valor: 0 });
      e.qtd += 1;
      e.valor += Number(l.valorEstimado ?? 0);
    }
    return { porEtapa };
  }

  async obter(id: number, user: AuthUser) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: { interacoes: { orderBy: { criadoEm: 'desc' } } },
    });
    if (!lead || lead.empresaId !== user.empresaId) throw new NotFoundException(`Lead ${id} não encontrado.`);
    if (this.ehVendedor(user) && lead.vendedorId !== user.sub) throw new NotFoundException(`Lead ${id} não encontrado.`);
    return lead;
  }

  async criar(dto: CreateLeadDto, user: AuthUser) {
    // Vendedor sempre cria pra si; manager pode atribuir a outro (vendedorId/Nome).
    const vendedorId = this.ehVendedor(user) ? user.sub : dto.vendedorId ?? user.sub;
    let vendedorNome = dto.vendedorNome?.trim();
    if (!vendedorNome) {
      if (vendedorId === user.sub) vendedorNome = user.nome;
      else {
        const u = await this.prisma.usuario.findUnique({ where: { id: vendedorId }, select: { nome: true } });
        vendedorNome = u?.nome;
      }
    }
    return this.prisma.lead.create({
      data: {
        empresaId: user.empresaId,
        vendedorId,
        vendedorNome: vendedorNome || null,
        nome: dto.nome.trim(),
        empresa: dto.empresa?.trim() || null,
        cnpjCpf: dto.cnpjCpf?.trim() || null,
        contato: dto.contato?.trim() || null,
        telefone: dto.telefone?.trim() || null,
        email: dto.email?.trim() || null,
        cidadeUf: dto.cidadeUf?.trim() || null,
        origem: dto.origem?.trim() || null,
        etapa: dto.etapa && ETAPAS_FUNIL.includes(dto.etapa as never) ? dto.etapa : 'novo',
        valorEstimado: dto.valorEstimado != null ? new Prisma.Decimal(dto.valorEstimado) : null,
        proximaAcao: dto.proximaAcao?.trim() || null,
        proximaAcaoEm: this.parseData(dto.proximaAcaoEm),
        obs: dto.obs?.trim() || null,
      },
    });
  }

  async atualizar(id: number, dto: UpdateLeadDto, user: AuthUser) {
    await this.obter(id, user);
    const podeReatribuir = !this.ehVendedor(user);
    return this.prisma.lead.update({
      where: { id },
      data: {
        nome: dto.nome !== undefined ? dto.nome.trim() : undefined,
        empresa: dto.empresa !== undefined ? dto.empresa?.trim() || null : undefined,
        cnpjCpf: dto.cnpjCpf !== undefined ? dto.cnpjCpf?.trim() || null : undefined,
        contato: dto.contato !== undefined ? dto.contato?.trim() || null : undefined,
        telefone: dto.telefone !== undefined ? dto.telefone?.trim() || null : undefined,
        email: dto.email !== undefined ? dto.email?.trim() || null : undefined,
        cidadeUf: dto.cidadeUf !== undefined ? dto.cidadeUf?.trim() || null : undefined,
        origem: dto.origem !== undefined ? dto.origem?.trim() || null : undefined,
        etapa: dto.etapa && ETAPAS_FUNIL.includes(dto.etapa as never) ? dto.etapa : undefined,
        valorEstimado: dto.valorEstimado !== undefined ? (dto.valorEstimado != null ? new Prisma.Decimal(dto.valorEstimado) : null) : undefined,
        proximaAcao: dto.proximaAcao !== undefined ? dto.proximaAcao?.trim() || null : undefined,
        proximaAcaoEm: dto.proximaAcaoEm !== undefined ? this.parseData(dto.proximaAcaoEm) : undefined,
        obs: dto.obs !== undefined ? dto.obs?.trim() || null : undefined,
        vendedorId: podeReatribuir && dto.vendedorId != null ? dto.vendedorId : undefined,
        vendedorNome: podeReatribuir && dto.vendedorNome !== undefined ? dto.vendedorNome?.trim() || null : undefined,
      },
    });
  }

  async moverEtapa(id: number, dto: MoverEtapaDto, user: AuthUser) {
    await this.obter(id, user);
    return this.prisma.lead.update({
      where: { id },
      data: {
        etapa: dto.etapa,
        perdaMotivo: dto.etapa === 'perdido' ? dto.perdaMotivo?.trim() || null : null,
      },
    });
  }

  async registrarInteracao(id: number, dto: InteracaoDto, user: AuthUser) {
    await this.obter(id, user);
    const inter = await this.prisma.leadInteracao.create({
      data: { leadId: id, tipo: dto.tipo || 'nota', texto: dto.texto.trim(), autor: user.nome },
    });
    // toca o lead (atualizadoEm) para ele subir na lista/kanban
    await this.prisma.lead.update({ where: { id }, data: { atualizadoEm: new Date() } });
    return inter;
  }

  /** Ganhou: cria (ou vincula) um Cliente a partir do lead e marca etapa=ganho. */
  async converter(id: number, dto: ConverterLeadDto, user: AuthUser) {
    const lead = await this.obter(id, user);
    if (lead.clienteId) {
      return { clienteId: lead.clienteId, jaConvertido: true };
    }
    let clienteId = dto.clienteId;
    if (clienteId) {
      const cli = await this.prisma.cliente.findFirst({ where: { id: clienteId, empresaId: user.empresaId }, select: { id: true } });
      if (!cli) throw new BadRequestException('Cliente informado não encontrado nesta empresa.');
    } else {
      const novo = await this.prisma.cliente.create({
        data: {
          empresaId: user.empresaId,
          nome: (lead.empresa || lead.nome).trim(),
          fantasia: lead.empresa && lead.empresa !== lead.nome ? lead.nome : null,
          cnpjCpf: lead.cnpjCpf,
          contato: lead.contato || lead.nome,
          telefone: lead.telefone,
          email: lead.email,
          cidadeUf: lead.cidadeUf,
          clienteNovo: true,
          obs: lead.obs,
        },
        select: { id: true },
      });
      clienteId = novo.id;
    }
    await this.prisma.lead.update({ where: { id }, data: { etapa: 'ganho', clienteId } });
    return { clienteId, jaConvertido: false };
  }

  async remover(id: number, user: AuthUser) {
    await this.obter(id, user);
    await this.prisma.lead.delete({ where: { id } }); // interações caem por cascade
    return { ok: true };
  }

  /** Lista de vendedores (p/ managers atribuírem a carteira). */
  async vendedores(user: AuthUser) {
    if (this.ehVendedor(user)) return [{ id: user.sub, nome: user.nome }];
    return this.prisma.usuario.findMany({
      where: { empresaId: user.empresaId, ativo: true, acesso: { in: ['vendedor', 'comercial', 'total'] } },
      select: { id: true, nome: true, acesso: true },
      orderBy: { nome: 'asc' },
    });
  }
}
