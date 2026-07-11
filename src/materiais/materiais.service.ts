import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Material, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { proximoCodigo } from '../common/utils/codigo.util';

@Injectable()
export class MateriaisService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Material[]> {
    return this.prisma.material.findMany({
      where: { empresaId },
      orderBy: { codigo: 'asc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Material> {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material || material.empresaId !== empresaId) {
      throw new NotFoundException(`Material ${id} não encontrado.`);
    }
    return material;
  }

  async create(dto: CreateMaterialDto, empresaId: number): Promise<Material> {
    const codigo =
      dto.codigo?.trim() ||
      (await this.gerarCodigo(dto.categoria, empresaId, dto.prefixo ?? 'MP'));
    try {
      return await this.prisma.material.create({
        data: {
          empresaId,
          codigo,
          categoria: dto.categoria,
          descricao: dto.descricao,
          cor: dto.cor,
          unidade: dto.unidade ?? 'un',
          saldo: dto.saldo ?? 0,
          minimo: dto.minimo ?? 0,
          custo: dto.custo ?? 0,
        },
      });
    } catch (err) {
      throw this.tratarErroUnico(err, codigo);
    }
  }

  async update(id: number, dto: UpdateMaterialDto, empresaId: number): Promise<Material> {
    await this.findOne(id, empresaId);
    return this.prisma.material.update({
      where: { id },
      data: {
        categoria: dto.categoria,
        descricao: dto.descricao,
        cor: dto.cor,
        unidade: dto.unidade,
        saldo: dto.saldo,
        minimo: dto.minimo,
        custo: dto.custo,
      },
    });
  }

  /** Materiais com saldo abaixo do mínimo — apoio a compras/estoque. */
  async abaixoDoMinimo(empresaId: number): Promise<Material[]> {
    const materiais = await this.prisma.material.findMany({ where: { empresaId } });
    return materiais.filter((m) => m.saldo.lessThan(m.minimo));
  }

  private async gerarCodigo(
    categoria: string,
    empresaId: number,
    prefixo: 'MP' | 'AVI' = 'MP',
  ): Promise<string> {
    const existentes = await this.prisma.material.findMany({
      where: { empresaId },
      select: { codigo: true },
    });
    return proximoCodigo(prefixo, categoria, existentes.map((m) => m.codigo));
  }

  private tratarErroUnico(err: unknown, codigo: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`Já existe um material com o código "${codigo}".`);
    }
    return err as Error;
  }
}
