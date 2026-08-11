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

  async findAll(empresaId: number) {
    // Omite os campos base64 pesados (foto/arquivo) — a lista não precisa deles
    // e isso mantém o payload leve. Eles voltam no findOne (edição).
    const produtos = await this.prisma.produto.findMany({
      where: { empresaId },
      omit: { fotoModelo: true, fotoModelagem: true, arquivoModelagem: true },
      orderBy: { codigo: 'asc' },
    });
    // Rendimento: quantas peças o estoque de material rende (limitado pelo material
    // mais escasso da receita). Tecido principal = o material de maior consumo.
    const consumos = await this.prisma.consumo.findMany({
      where: { produto: { empresaId } },
      include: { material: { select: { descricao: true, saldo: true, unidade: true } } },
    });
    const porProd = new Map<number, { rende: number | null; tecido: string | null; maiorQtd: number }>();
    for (const c of consumos) {
      const q = Number(c.quantidade);
      const saldo = Number(c.material.saldo);
      // Estimativa REAL do rendimento: se há consumo por tamanho cadastrado, usa a
      // MÉDIA por tamanho (a peça média), não o consumo fixo (que costuma ser o do
      // maior tamanho e subestima quantas peças o estoque rende).
      const qEstim = this.consumoEstimado(c.porTamanho, q);
      const rende = qEstim > 0 ? Math.floor(saldo / qEstim) : null;
      const cur = porProd.get(c.produtoId) ?? { rende: null, tecido: null, maiorQtd: -1 };
      if (rende != null) cur.rende = cur.rende == null ? rende : Math.min(cur.rende, rende);
      if (q > cur.maiorQtd) { cur.maiorQtd = q; cur.tecido = c.material.descricao; }
      porProd.set(c.produtoId, cur);
    }
    return produtos.map((p) => {
      const r = porProd.get(p.id);
      return { ...p, rendePecas: r?.rende ?? null, tecidoPrincipal: r?.tecido ?? null };
    });
  }

  /** Consumo médio por peça para estimar o rendimento: média dos valores de
   *  consumo por tamanho (quando cadastrados); senão, o consumo fixo. */
  private consumoEstimado(porTamanho: unknown, fixo: number): number {
    if (porTamanho && typeof porTamanho === 'object') {
      const vals = Object.values(porTamanho as Record<string, unknown>)
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (vals.length) return vals.reduce((s, n) => s + n, 0) / vals.length;
    }
    return fixo;
  }

  async findOne(id: number, empresaId: number) {
    const produto = await this.prisma.produto.findUnique({
      where: { id },
      include: { medidas: { orderBy: { ordem: 'asc' } } },
    });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${id} não encontrado.`);
    }
    return produto;
  }

  async create(dto: CreateProdutoDto, empresaId: number): Promise<Produto> {
    const codigo = dto.codigo?.trim() || (await this.gerarCodigo(dto.categoria, empresaId));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const produto = await tx.produto.create({
          data: {
            empresaId,
            codigo,
            categoria: dto.categoria,
            descricao: dto.descricao,
            cor: dto.cor,
            grade: dto.grade,
            precoBase: dto.precoBase,
            precoEspecial: dto.precoEspecial,
            tamsEspeciais: dto.tamsEspeciais,
            clienteGrupo: dto.clienteGrupo,
            clienteId: dto.clienteId,
            setor: dto.setor,
            custo: dto.custo,
            tipo: dto.tipo,
            componentes: (dto.componentes ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            ...this.dadosFicha(dto),
            ...this.dadosFiscais(dto),
            medidas: dto.medidas?.length ? { create: this.medidasCreate(dto.medidas) } : undefined,
          },
        });
        await this.upsertTecidoBom(tx, produto.id, dto);
        return produto;
      });
    } catch (err) {
      throw this.tratarErroUnico(err, codigo);
    }
  }

  /** Vincula o tecido homologado (material) à receita BOM do produto — 1 linha
   *  por material. A OP usa a receita p/ baixar o saldo automaticamente. */
  private async upsertTecidoBom(
    tx: Prisma.TransactionClient,
    produtoId: number,
    dto: CreateProdutoDto | UpdateProdutoDto,
  ) {
    if (!dto.tecidoMaterialId || !(Number(dto.tecidoConsumo) > 0)) return;
    const materialId = dto.tecidoMaterialId;
    const quantidade = new Prisma.Decimal(Number(dto.tecidoConsumo).toFixed(4));
    const unidade = (dto.tecidoUnidade || 'm').slice(0, 8);
    // Consumo por tamanho (opcional): mantém só os tamanhos com valor > 0.
    let porTamanho: Prisma.InputJsonValue | undefined;
    if (dto.tecidoConsumoPorTamanho && typeof dto.tecidoConsumoPorTamanho === 'object') {
      const limpo: Record<string, number> = {};
      for (const [k, v] of Object.entries(dto.tecidoConsumoPorTamanho)) {
        const n = Number(v);
        if (k && Number.isFinite(n) && n > 0) limpo[String(k).toUpperCase()] = n;
      }
      porTamanho = Object.keys(limpo).length ? limpo : ({} as Prisma.InputJsonValue);
    }
    const existente = await tx.consumo.findFirst({ where: { produtoId, materialId } });
    if (existente) {
      await tx.consumo.update({ where: { id: existente.id }, data: { quantidade, unidade, ...(porTamanho !== undefined ? { porTamanho } : {}) } });
    } else {
      await tx.consumo.create({ data: { produtoId, materialId, quantidade, unidade, ...(porTamanho !== undefined ? { porTamanho } : {}) } });
    }
  }

  async update(id: number, dto: UpdateProdutoDto, empresaId: number): Promise<Produto> {
    await this.findOne(id, empresaId);
    return this.prisma.$transaction(async (tx) => {
      const produto = await tx.produto.update({
        where: { id },
        data: {
          categoria: dto.categoria,
          descricao: dto.descricao,
          cor: dto.cor,
          grade: dto.grade,
          precoBase: dto.precoBase,
          precoEspecial: dto.precoEspecial,
          tamsEspeciais: dto.tamsEspeciais,
          clienteGrupo: dto.clienteGrupo,
          clienteId: dto.clienteId,
          setor: dto.setor,
          custo: dto.custo,
          tipo: dto.tipo,
          componentes:
            dto.componentes === undefined
              ? undefined
              : (dto.componentes as unknown as Prisma.InputJsonValue),
          ...this.dadosFicha(dto),
          ...this.dadosFiscais(dto),
        },
      });
      // Tabela de medidas: se veio no payload, substitui integralmente.
      if (dto.medidas !== undefined) {
        await tx.produtoMedida.deleteMany({ where: { produtoId: id } });
        if (dto.medidas.length) {
          await tx.produtoMedida.createMany({
            data: this.medidasCreate(dto.medidas).map((m) => ({ ...m, produtoId: id })),
          });
        }
      }
      await this.upsertTecidoBom(tx, id, dto);
      return produto;
    });
  }

  /** Normaliza as linhas da tabela de medidas para gravação (ordem sequencial). */
  private medidasCreate(medidas: CreateProdutoDto['medidas']) {
    return (medidas ?? [])
      .filter((m) => m.descricao?.trim())
      .map((m, i) => ({
        ordem: m.ordem ?? i,
        descricao: m.descricao.trim(),
        tolerancia: m.tolerancia?.trim() || null,
        valores: (m.valores ?? {}) as Prisma.InputJsonValue,
      }));
  }

  /** Extrai os campos descritivos da ficha técnica presentes no DTO. */
  private dadosFicha(dto: CreateProdutoDto | UpdateProdutoDto) {
    return {
      referencia: dto.referencia,
      marca: dto.marca,
      linha: dto.linha,
      grupo: dto.grupo,
      modelagem: dto.modelagem,
      tecido: dto.tecido,
      composicao: dto.composicao,
      especificacoes: dto.especificacoes,
      observacoes: dto.observacoes,
      fotoModelo: dto.fotoModelo,
      fotoModelagem: dto.fotoModelagem,
      arquivoModelagem: dto.arquivoModelagem,
      arquivoModelagemNome: dto.arquivoModelagemNome,
    };
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
