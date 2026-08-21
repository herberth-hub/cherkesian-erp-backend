import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Fornecedor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';

@Injectable()
export class FornecedoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number) {
    // Não carrega o catálogo (base64) na listagem — só um flag.
    const [fornecedores, comCat] = await Promise.all([
      this.prisma.fornecedor.findMany({ where: { empresaId }, orderBy: { id: 'asc' }, omit: { catalogo: true } }),
      this.prisma.fornecedor.findMany({ where: { empresaId, NOT: { catalogo: null } }, select: { id: true } }),
    ]);
    const catSet = new Set(comCat.map((f) => f.id));
    return fornecedores.map((f) => ({ ...f, temCatalogo: catSet.has(f.id) }));
  }

  /** Ficha do fornecedor: compras (OCs), notas de entrada e contas a pagar. */
  async resumo(id: number, empresaId: number) {
    const f = await this.findOne(id, empresaId);
    const [ocs, notas, pagar, materiais] = await Promise.all([
      this.prisma.ordemCompra.findMany({ where: { fornecedorId: id }, select: { numero: true, valor: true, status: true, motivo: true }, orderBy: { id: 'desc' } }),
      this.prisma.notaEntrada.findMany({ where: { fornecedorId: id }, select: { id: true, numero: true, valor: true, emitidaEm: true }, orderBy: { id: 'desc' } }),
      this.prisma.contaPagar.findMany({ where: { empresaId, fornecedorId: id }, select: { id: true, categoria: true, referencia: true, valor: true, pago: true, vencimento: true, status: true }, orderBy: { vencimento: 'desc' } }),
      this.prisma.material.findMany({ where: { empresaId, fornecedorId: id }, select: { id: true, codigo: true, descricao: true, artigo: true, composicao: true, largura: true, gramatura: true, saldo: true, unidade: true }, orderBy: { descricao: 'asc' } }),
    ]);
    const soma = (arr: { valor: unknown }[]) => Number(arr.reduce((s, x) => s + Number(x.valor), 0).toFixed(2));
    const abertoPagar = Number(pagar.reduce((s, t) => s + (Number(t.valor) - Number(t.pago)), 0).toFixed(2));
    const limite = f.limiteCredito != null ? Number(f.limiteCredito) : null;
    return {
      fornecedor: { id: f.id, nome: f.nome, fantasia: f.nomeFantasia, cnpjCpf: f.cnpjCpf, temCatalogo: !!f.catalogo, catalogoNome: f.catalogoNome, limiteCredito: limite, condicaoPagamento: f.condicaoPagamento },
      credito: { limite, emAberto: abertoPagar, disponivel: limite != null ? Number((limite - abertoPagar).toFixed(2)) : null, condicaoPagamento: f.condicaoPagamento },
      compras: { qtd: ocs.length, valor: soma(ocs) },
      materiaisQtd: materiais.length,
      materiais: materiais.map((m) => ({ id: m.id, codigo: m.codigo, descricao: m.descricao, artigo: m.artigo, composicao: m.composicao, largura: m.largura != null ? Number(m.largura) : null, gramatura: m.gramatura != null ? Number(m.gramatura) : null, saldo: Number(m.saldo), unidade: m.unidade })),
      notasEntrada: { qtd: notas.length, valor: soma(notas) },
      contasPagar: {
        qtd: pagar.length,
        total: soma(pagar),
        aberto: Number(pagar.reduce((s, t) => s + (Number(t.valor) - Number(t.pago)), 0).toFixed(2)),
      },
      listaCompras: ocs.map((o) => ({ numero: o.numero, valor: Number(o.valor), status: o.status, motivo: o.motivo })),
      listaNotas: notas.map((n) => ({ numero: n.numero, valor: Number(n.valor), emitidaEm: n.emitidaEm })),
      listaPagar: pagar.map((t) => ({ id: t.id, categoria: t.categoria, referencia: t.referencia, valor: Number(t.valor), saldo: Number(t.valor) - Number(t.pago), vencimento: t.vencimento, status: t.status })),
    };
  }

  /** Baixa/visualiza o catálogo (PDF/imagem) do fornecedor. */
  async getCatalogo(id: number, empresaId: number) {
    const f = await this.prisma.fornecedor.findUnique({ where: { id }, select: { empresaId: true, catalogo: true, catalogoNome: true } });
    if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Fornecedor ${id} não encontrado.`);
    if (!f.catalogo) throw new NotFoundException('Este fornecedor não tem catálogo anexado.');
    const m = /^data:([^;]+);base64,(.*)$/s.exec(f.catalogo);
    const contentType = m ? m[1] : 'application/octet-stream';
    const b64 = m ? m[2] : f.catalogo;
    const content = Buffer.from(b64, 'base64');
    const ext = contentType.includes('pdf') ? 'pdf' : /png/.test(contentType) ? 'png' : /jpe?g/.test(contentType) ? 'jpg' : 'bin';
    const filename = f.catalogoNome && /\.[a-z0-9]{2,4}$/i.test(f.catalogoNome) ? f.catalogoNome : `catalogo-${id}.${ext}`;
    return { content, contentType, filename };
  }

  async findOne(id: number, empresaId: number): Promise<Fornecedor> {
    const fornecedor = await this.prisma.fornecedor.findUnique({ where: { id } });
    if (!fornecedor || fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Fornecedor ${id} não encontrado.`);
    }
    return fornecedor;
  }

  create(dto: CreateFornecedorDto, empresaId: number): Promise<Fornecedor> {
    return this.prisma.fornecedor.create({
      data: { empresaId, ...dto },
    });
  }

  async update(id: number, dto: UpdateFornecedorDto, empresaId: number): Promise<Fornecedor> {
    await this.findOne(id, empresaId);
    return this.prisma.fornecedor.update({ where: { id }, data: dto });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    await this.findOne(id, empresaId);
    const [ocs, titulos] = await Promise.all([
      this.prisma.ordemCompra.count({ where: { fornecedorId: id } }),
      this.prisma.contaPagar.count({ where: { fornecedorId: id } }),
    ]);
    const b: string[] = [];
    if (ocs) b.push(`${ocs} ordem(ns) de compra`);
    if (titulos) b.push(`${titulos} título(s) a pagar`);
    if (b.length) throw new ConflictException(`Não é possível excluir: fornecedor vinculado a ${b.join(', ')}.`);
    await this.prisma.fornecedor.delete({ where: { id } });
    return { removido: true, id };
  }
}
