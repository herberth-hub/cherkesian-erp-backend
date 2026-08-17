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

  // ===== Contas bancárias estruturadas (várias por filial/CNPJ) =====

  /** Lista as contas bancárias da empresa, já com o rótulo pronto p/ o select da baixa. */
  async listarContas(empresaId: number, apenasAtivas = false) {
    const contas = await this.prisma.contaBancaria.findMany({
      where: { empresaId, ...(apenasAtivas ? { ativa: true } : {}) },
      include: { filial: { select: { id: true, nome: true } } },
      orderBy: [{ filialId: 'asc' }, { principal: 'desc' }, { banco: 'asc' }],
    });
    return contas.map((c) => ({ ...c, rotulo: this.rotuloConta(c, c.filial?.nome) }));
  }

  private rotuloConta(c: { banco: string; agencia: string | null; conta: string | null; apelido: string | null }, filialNome?: string) {
    const partes = [c.banco, c.agencia ? `Ag ${c.agencia}` : null, c.conta ? `CC ${c.conta}` : null, filialNome || null].filter(Boolean);
    const base = partes.join(' · ');
    return c.apelido ? `${c.apelido} — ${base}` : base;
  }

  private async filialDaEmpresa(filialId: number, empresaId: number) {
    const fil = await this.prisma.filial.findUnique({ where: { id: filialId } });
    if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
    return fil;
  }

  async criarConta(filialId: number, dto: { banco: string; agencia?: string; conta?: string; tipo?: string; pixChave?: string; apelido?: string; principal?: boolean; ativa?: boolean }, empresaId: number) {
    await this.filialDaEmpresa(filialId, empresaId);
    if (!dto.banco || !dto.banco.trim()) throw new ConflictException('Informe o banco.');
    // Só uma conta principal por filial.
    if (dto.principal) await this.prisma.contaBancaria.updateMany({ where: { empresaId, filialId }, data: { principal: false } });
    return this.prisma.contaBancaria.create({
      data: {
        empresaId, filialId,
        banco: dto.banco.trim(), agencia: dto.agencia?.trim() || null, conta: dto.conta?.trim() || null,
        tipo: dto.tipo || 'corrente', pixChave: dto.pixChave?.trim() || null, apelido: dto.apelido?.trim() || null,
        principal: !!dto.principal, ativa: dto.ativa ?? true,
      },
    });
  }

  async atualizarConta(id: number, dto: { banco?: string; agencia?: string; conta?: string; tipo?: string; pixChave?: string; apelido?: string; principal?: boolean; ativa?: boolean }, empresaId: number) {
    const c = await this.prisma.contaBancaria.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException(`Conta bancária ${id} não encontrada.`);
    if (dto.principal) await this.prisma.contaBancaria.updateMany({ where: { empresaId, filialId: c.filialId, id: { not: id } }, data: { principal: false } });
    return this.prisma.contaBancaria.update({
      where: { id },
      data: {
        banco: dto.banco?.trim() ?? undefined,
        agencia: dto.agencia !== undefined ? (dto.agencia.trim() || null) : undefined,
        conta: dto.conta !== undefined ? (dto.conta.trim() || null) : undefined,
        tipo: dto.tipo ?? undefined,
        pixChave: dto.pixChave !== undefined ? (dto.pixChave.trim() || null) : undefined,
        apelido: dto.apelido !== undefined ? (dto.apelido.trim() || null) : undefined,
        principal: dto.principal ?? undefined,
        ativa: dto.ativa ?? undefined,
      },
    });
  }

  async removerConta(id: number, empresaId: number) {
    const c = await this.prisma.contaBancaria.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException(`Conta bancária ${id} não encontrada.`);
    await this.prisma.contaBancaria.delete({ where: { id } });
    return { removido: true, id };
  }
}
