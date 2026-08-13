import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmbalagensService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number) {
    return this.prisma.embalagem.findMany({ where: { empresaId, ativo: true }, orderBy: [{ tipo: 'asc' }, { nome: 'asc' }] });
  }

  async salvar(empresaId: number, dto: { id?: number; tipo?: string; nome?: string; pesoVazio?: number; comprimento?: number; largura?: number; altura?: number; capacidade?: number }) {
    const data = {
      tipo: dto.tipo === 'fardo' ? 'fardo' : 'caixa',
      nome: (dto.nome || '').trim() || 'Embalagem',
      pesoVazio: new Prisma.Decimal(Number(dto.pesoVazio || 0).toFixed(3)),
      comprimento: dto.comprimento != null ? Math.round(Number(dto.comprimento)) : null,
      largura: dto.largura != null ? Math.round(Number(dto.largura)) : null,
      altura: dto.altura != null ? Math.round(Number(dto.altura)) : null,
      capacidade: dto.capacidade != null ? Math.round(Number(dto.capacidade)) : null,
    };
    if (dto.id) {
      const ex = await this.prisma.embalagem.findUnique({ where: { id: dto.id } });
      if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Embalagem não encontrada.');
      return this.prisma.embalagem.update({ where: { id: dto.id }, data });
    }
    return this.prisma.embalagem.create({ data: { empresaId, ...data } });
  }

  async remover(empresaId: number, id: number) {
    const ex = await this.prisma.embalagem.findUnique({ where: { id } });
    if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Embalagem não encontrada.');
    await this.prisma.embalagem.update({ where: { id }, data: { ativo: false } });
    return { ok: true };
  }

  /** Peso líquido/bruto + volumes de um PEDIDO, a partir do peso por tamanho e das
   *  embalagens (caixa/fardo) dos produtos + embalagem unitária global. */
  async pesoDoPedido(empresaId: number, pedidoId: number) {
    const pedido = await this.prisma.pedido.findFirst({ where: { id: pedidoId, empresaId }, include: { itens: true } });
    if (!pedido) throw new NotFoundException('Pedido não encontrado.');
    const emp = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { pesoEmbalagemUnit: true } });
    const embUnit = Number(emp?.pesoEmbalagemUnit || 0);
    const prodIds = pedido.itens.map((i) => i.produtoId).filter((x): x is number => x != null);
    const prods = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, pesoUnitario: true, pesoPorTamanho: true, caixaId: true, pecasPorCaixa: true, fardoId: true, pecasPorFardo: true } }) : [];
    const pmap = new Map(prods.map((p) => [p.id, p]));
    const embIds = [...new Set(prods.flatMap((p) => [p.caixaId, p.fardoId]).filter((x): x is number => x != null))];
    const embs = embIds.length ? await this.prisma.embalagem.findMany({ where: { id: { in: embIds } } }) : [];
    const embMap = new Map(embs.map((e) => [e.id, e]));

    let pesoLiquido = 0, pesoEmbalagens = 0, volumes = 0, totalPecas = 0;
    let dimensoes: string | null = null;
    let semPeso = 0;
    for (const it of pedido.itens) {
      const prod = it.produtoId ? pmap.get(it.produtoId) : null;
      const grade = (it.grade as Record<string, number> | null) ?? null;
      const porTam: Record<string, number> = grade && Object.keys(grade).length ? grade : { 'ÚNICO': it.quantidade };
      const pt = (prod?.pesoPorTamanho as Record<string, number> | null) ?? {};
      const pUnit = Number(prod?.pesoUnitario || 0);
      let qtdItem = 0;
      for (const [t, q] of Object.entries(porTam)) {
        const qn = Number(q) || 0;
        qtdItem += qn;
        const pw = Number(pt[t.toUpperCase()] ?? pUnit);
        if (!pw) semPeso += qn;
        pesoLiquido += pw * qn;
      }
      totalPecas += qtdItem;
      // Embalagens: usa caixa se configurada; senão fardo.
      if (prod?.pecasPorCaixa && prod.pecasPorCaixa > 0 && prod.caixaId) {
        const nc = Math.ceil(qtdItem / prod.pecasPorCaixa);
        const cx = embMap.get(prod.caixaId);
        volumes += nc; pesoEmbalagens += nc * Number(cx?.pesoVazio || 0);
        if (!dimensoes && cx?.comprimento) dimensoes = `${cx.comprimento} x ${cx.largura ?? 0} x ${cx.altura ?? 0}`;
      } else if (prod?.pecasPorFardo && prod.pecasPorFardo > 0 && prod.fardoId) {
        const nf = Math.ceil(qtdItem / prod.pecasPorFardo);
        const fd = embMap.get(prod.fardoId);
        volumes += nf; pesoEmbalagens += nf * Number(fd?.pesoVazio || 0);
        if (!dimensoes && fd?.comprimento) dimensoes = `${fd.comprimento} x ${fd.largura ?? 0} x ${fd.altura ?? 0}`;
      }
    }
    const pesoBruto = pesoLiquido + pesoEmbalagens + embUnit * totalPecas;
    return {
      pesoLiquido: Number(pesoLiquido.toFixed(3)),
      pesoBruto: Number(pesoBruto.toFixed(3)),
      volumes: volumes || 1,
      dimensoes,
      pecas: totalPecas,
      semPeso, // peças sem peso cadastrado (não entraram no cálculo)
    };
  }
}
