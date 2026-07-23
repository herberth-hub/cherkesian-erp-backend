import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Filial } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFilialDto } from './dto/create-filial.dto';
import { UpdateFilialDto } from './dto/update-filial.dto';

@Injectable()
export class FiliaisService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Filial[]> {
    return this.prisma.filial.findMany({
      where: { empresaId },
      orderBy: [{ matriz: 'desc' }, { nome: 'asc' }],
    });
  }

  async findOne(id: number, empresaId: number): Promise<Filial> {
    const filial = await this.prisma.filial.findUnique({ where: { id } });
    if (!filial || filial.empresaId !== empresaId) {
      throw new NotFoundException(`Filial ${id} não encontrada.`);
    }
    return filial;
  }

  async create(dto: CreateFilialDto, empresaId: number): Promise<Filial> {
    // Cada CNPJ do grupo pode ser marcado como matriz ou filial livremente
    // (o grupo tem vários CNPJs independentes; "matriz" é só um rótulo).
    return this.prisma.filial.create({
      data: { empresaId, ...dto, ativa: dto.ativa ?? true },
    });
  }

  async update(id: number, dto: UpdateFilialDto, empresaId: number): Promise<Filial> {
    await this.findOne(id, empresaId);
    return this.prisma.filial.update({ where: { id }, data: dto });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    await this.findOne(id, empresaId);
    const total = await this.prisma.filial.count({ where: { empresaId } });
    if (total <= 1) {
      throw new ConflictException('Não é possível excluir o único CNPJ cadastrado. Cadastre outro antes.');
    }
    const [pedidos, notas] = await Promise.all([
      this.prisma.pedido.count({ where: { filialId: id } }),
      this.prisma.notaFiscal.count({ where: { filialId: id } }),
    ]);
    const b: string[] = [];
    if (pedidos) b.push(`${pedidos} pedido(s)`);
    if (notas) b.push(`${notas} nota(s) fiscal(is)`);
    if (b.length) throw new ConflictException(`Não é possível excluir: filial vinculada a ${b.join(', ')}. Desative-a em vez de excluir.`);
    await this.prisma.filial.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Retorna a matriz da empresa (fallback quando o pedido não tem filial). */
  matriz(empresaId: number): Promise<Filial | null> {
    return this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
  }
}
