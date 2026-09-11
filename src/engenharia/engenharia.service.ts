import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type MockupAssetDto = {
  id?: number;
  categoria: string;
  tipoProduto?: string;
  vista?: string;
  nome: string;
  imagem: string;
  larguraPct?: number;
  ordem?: number;
};

type ProdutoMockupDto = {
  id?: number;
  produtoId?: number;
  nome: string;
  composicao: Record<string, unknown>;
  preview?: string;
};

@Injectable()
export class EngenhariaService {
  constructor(private readonly prisma: PrismaService) {}

  // ===== Biblioteca de assets (desenhos base + opcionais) =====
  async listarAssets(empresaId: number, categoria?: string, tipoProduto?: string) {
    return this.prisma.mockupAsset.findMany({
      where: { empresaId, ativo: true, ...(categoria ? { categoria } : {}), ...(tipoProduto ? { tipoProduto } : {}) },
      orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }, { id: 'asc' }],
    });
  }

  async salvarAsset(empresaId: number, dto: MockupAssetDto) {
    const data = {
      categoria: (dto.categoria || 'base').trim(),
      tipoProduto: dto.tipoProduto?.trim() || null,
      vista: dto.vista?.trim() || null,
      nome: (dto.nome || '').trim() || 'Sem nome',
      imagem: dto.imagem || '',
      larguraPct: dto.larguraPct != null ? Math.max(1, Math.min(100, Math.floor(dto.larguraPct))) : null,
      ordem: dto.ordem != null ? Math.floor(dto.ordem) : 0,
    };
    if (!data.imagem) throw new NotFoundException('Imagem do desenho é obrigatória.');
    if (dto.id) {
      const ex = await this.prisma.mockupAsset.findUnique({ where: { id: dto.id } });
      if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Asset não encontrado.');
      return this.prisma.mockupAsset.update({ where: { id: dto.id }, data });
    }
    return this.prisma.mockupAsset.create({ data: { empresaId, ...data } });
  }

  async removerAsset(empresaId: number, id: number) {
    const ex = await this.prisma.mockupAsset.findUnique({ where: { id } });
    if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Asset não encontrado.');
    await this.prisma.mockupAsset.update({ where: { id }, data: { ativo: false } });
    return { ok: true };
  }

  // ===== Mockups montados por produto =====
  listarMockups(empresaId: number, produtoId?: number) {
    return this.prisma.produtoMockup.findMany({
      where: { empresaId, ...(produtoId ? { produtoId } : {}) },
      orderBy: { id: 'desc' },
      select: { id: true, produtoId: true, nome: true, preview: true, criadoEm: true, atualizadoEm: true },
    });
  }

  async obterMockup(empresaId: number, id: number) {
    const m = await this.prisma.produtoMockup.findUnique({ where: { id } });
    if (!m || m.empresaId !== empresaId) throw new NotFoundException('Mockup não encontrado.');
    return m;
  }

  async salvarMockup(empresaId: number, dto: ProdutoMockupDto) {
    const data = {
      produtoId: dto.produtoId ?? null,
      nome: (dto.nome || '').trim() || 'Mockup',
      composicao: (dto.composicao ?? {}) as unknown as Prisma.InputJsonValue,
      preview: dto.preview ?? null,
    };
    if (dto.id) {
      const ex = await this.prisma.produtoMockup.findUnique({ where: { id: dto.id } });
      if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Mockup não encontrado.');
      return this.prisma.produtoMockup.update({ where: { id: dto.id }, data });
    }
    return this.prisma.produtoMockup.create({ data: { empresaId, ...data } });
  }

  async removerMockup(empresaId: number, id: number) {
    const ex = await this.prisma.produtoMockup.findUnique({ where: { id } });
    if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Mockup não encontrado.');
    await this.prisma.produtoMockup.delete({ where: { id } });
    return { ok: true };
  }
}
