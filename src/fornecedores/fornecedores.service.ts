import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Fornecedor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';

@Injectable()
export class FornecedoresService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Fornecedor[]> {
    return this.prisma.fornecedor.findMany({
      where: { empresaId },
      orderBy: { id: 'asc' },
    });
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
