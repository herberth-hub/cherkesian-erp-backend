import { Injectable, NotFoundException } from '@nestjs/common';
import { Transportadora } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type TransportadoraDto = Partial<Omit<Transportadora, 'id' | 'empresaId' | 'criadoEm'>> & { nome?: string };

@Injectable()
export class TransportadorasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Transportadora[]> {
    return this.prisma.transportadora.findMany({ where: { empresaId }, orderBy: [{ ativa: 'desc' }, { nome: 'asc' }] });
  }

  async create(dto: TransportadoraDto, empresaId: number): Promise<Transportadora> {
    if (!dto.nome || !dto.nome.trim()) throw new NotFoundException('Informe o nome/razão social da transportadora.');
    return this.prisma.transportadora.create({ data: { ...this.limpar(dto), nome: dto.nome.trim(), empresaId } });
  }

  async update(id: number, dto: TransportadoraDto, empresaId: number): Promise<Transportadora> {
    const t = await this.prisma.transportadora.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) throw new NotFoundException(`Transportadora ${id} não encontrada.`);
    return this.prisma.transportadora.update({ where: { id }, data: this.limpar(dto) });
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    const t = await this.prisma.transportadora.findUnique({ where: { id } });
    if (!t || t.empresaId !== empresaId) throw new NotFoundException(`Transportadora ${id} não encontrada.`);
    await this.prisma.transportadora.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Normaliza strings ('' → null) e mantém só os campos aceitos. */
  private limpar(dto: TransportadoraDto) {
    const campos = ['nome', 'cnpjCpf', 'inscricaoEstadual', 'telefone', 'logradouro', 'numeroEndereco', 'bairro', 'municipio', 'uf', 'cep', 'placaVeiculo', 'ufVeiculo', 'rntc'] as const;
    const out: Record<string, unknown> = {};
    for (const k of campos) {
      const v = (dto as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = typeof v === 'string' ? (v.trim() || null) : v;
    }
    if (dto.ativa !== undefined) out.ativa = dto.ativa;
    if (out.uf && typeof out.uf === 'string') out.uf = (out.uf as string).toUpperCase();
    if (out.ufVeiculo && typeof out.ufVeiculo === 'string') out.ufVeiculo = (out.ufVeiculo as string).toUpperCase();
    return out;
  }
}
