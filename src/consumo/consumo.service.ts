import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Consumo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsumoDto } from './dto/create-consumo.dto';

@Injectable()
export class ConsumoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista a BOM; opcionalmente filtrada por produto. Sempre no escopo da empresa. */
  findAll(empresaId: number, produtoId?: number): Promise<Consumo[]> {
    return this.prisma.consumo.findMany({
      where: {
        produto: { empresaId },
        ...(produtoId ? { produtoId } : {}),
      },
      include: {
        material: { select: { id: true, codigo: true, descricao: true, unidade: true } },
        produto: { select: { id: true, codigo: true, descricao: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  async create(dto: CreateConsumoDto, empresaId: number): Promise<Consumo> {
    // Produto e material precisam existir e pertencer à empresa.
    const [produto, material] = await Promise.all([
      this.prisma.produto.findUnique({ where: { id: dto.produtoId } }),
      this.prisma.material.findUnique({ where: { id: dto.materialId } }),
    ]);
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${dto.produtoId} não encontrado.`);
    }
    if (!material || material.empresaId !== empresaId) {
      throw new NotFoundException(`Material ${dto.materialId} não encontrado.`);
    }

    // Evita duplicar o mesmo material na receita do mesmo produto.
    const jaExiste = await this.prisma.consumo.findFirst({
      where: { produtoId: dto.produtoId, materialId: dto.materialId },
    });
    if (jaExiste) {
      throw new BadRequestException(
        'Este material já faz parte da receita do produto. Edite ou remova o item existente.',
      );
    }

    return this.prisma.consumo.create({
      data: {
        produtoId: dto.produtoId,
        materialId: dto.materialId,
        quantidade: dto.quantidade,
        unidade: dto.unidade,
      },
    });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: number }> {
    const consumo = await this.prisma.consumo.findUnique({
      where: { id },
      include: { produto: { select: { empresaId: true } } },
    });
    if (!consumo || consumo.produto.empresaId !== empresaId) {
      throw new NotFoundException(`Item de consumo ${id} não encontrado.`);
    }
    await this.prisma.consumo.delete({ where: { id } });
    return { removido: id };
  }
}
