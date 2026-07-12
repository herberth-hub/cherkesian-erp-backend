import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Produto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { proximoCodigo } from '../common/utils/codigo.util';

@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Produto[]> {
    return this.prisma.produto.findMany({
      where: { empresaId },
      orderBy: { codigo: 'asc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Produto> {
    const produto = await this.prisma.produto.findUnique({ where: { id } });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${id} não encontrado.`);
    }
    return produto;
  }

  async create(dto: CreateProdutoDto, empresaId: number): Promise<Produto> {
    const codigo = dto.codigo?.trim() || (await this.gerarCodigo(dto.categoria, empresaId));
    try {
      return await this.prisma.produto.create({
        data: {
          empresaId,
          codigo,
          categoria: dto.categoria,
          descricao: dto.descricao,
          cor: dto.cor,
          grade: dto.grade,
          precoBase: dto.precoBase,
          ...this.dadosFiscais(dto),
        },
      });
    } catch (err) {
      throw this.tratarErroUnico(err, codigo);
    }
  }

  async update(id: number, dto: UpdateProdutoDto, empresaId: number): Promise<Produto> {
    await this.findOne(id, empresaId);
    return this.prisma.produto.update({
      where: { id },
      data: {
        categoria: dto.categoria,
        descricao: dto.descricao,
        cor: dto.cor,
        grade: dto.grade,
        precoBase: dto.precoBase,
        ...this.dadosFiscais(dto),
      },
    });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    await this.findOne(id, empresaId);
    const [bom, estoque, itens] = await Promise.all([
      this.prisma.consumo.count({ where: { produtoId: id } }),
      this.prisma.estoque.count({ where: { produtoId: id } }),
      this.prisma.pedidoItem.count({ where: { produtoId: id } }),
    ]);
    const b: string[] = [];
    if (bom) b.push(`${bom} item(ns) de ficha técnica`);
    if (estoque) b.push(`${estoque} registro(s) de estoque`);
    if (itens) b.push(`${itens} item(ns) de pedido`);
    if (b.length) throw new ConflictException(`Não é possível excluir: produto vinculado a ${b.join(', ')}.`);
    await this.prisma.produto.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Extrai apenas os campos fiscais presentes no DTO (para create/update). */
  private dadosFiscais(dto: CreateProdutoDto | UpdateProdutoDto) {
    return {
      ncm: dto.ncm,
      cfop: dto.cfop,
      origem: dto.origem,
      unidadeComercial: dto.unidadeComercial,
      cest: dto.cest,
      icmsCst: dto.icmsCst,
      pisCst: dto.pisCst,
      cofinsCst: dto.cofinsCst,
      icmsAliquota: dto.icmsAliquota,
    };
  }

  /**
   * Ficha de custo do produto: BOM (Consumo) × custo unitário do material.
   * Base da precificação — a margem/impostos são aplicados pelo cliente da API.
   */
  async custo(id: number, empresaId: number) {
    const produto = await this.findOne(id, empresaId);
    const bom = await this.prisma.consumo.findMany({
      where: { produtoId: id },
      include: {
        material: { select: { codigo: true, descricao: true, unidade: true, custo: true } },
      },
    });
    let custoMaterial = new Prisma.Decimal(0);
    const itens = bom.map((b) => {
      const subtotal = b.quantidade.mul(b.material.custo);
      custoMaterial = custoMaterial.plus(subtotal);
      return {
        material: b.material.codigo,
        descricao: b.material.descricao,
        quantidade: b.quantidade.toFixed(4),
        unidade: b.unidade,
        custoUnit: b.material.custo.toFixed(2),
        subtotal: subtotal.toFixed(2),
      };
    });
    return {
      produto: { id: produto.id, codigo: produto.codigo, descricao: produto.descricao },
      precoBase: produto.precoBase ? produto.precoBase.toFixed(2) : null,
      itens,
      custoMaterial: custoMaterial.toFixed(2),
    };
  }

  /** Gera o próximo código PRD-CAT-0000 para a categoria informada. */
  private async gerarCodigo(categoria: string, empresaId: number): Promise<string> {
    const existentes = await this.prisma.produto.findMany({
      where: { empresaId },
      select: { codigo: true },
    });
    return proximoCodigo('PRD', categoria, existentes.map((p) => p.codigo));
  }

  private tratarErroUnico(err: unknown, codigo: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`Já existe um produto com o código "${codigo}".`);
    }
    return err as Error;
  }
}
