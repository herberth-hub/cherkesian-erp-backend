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
      },
    });
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
