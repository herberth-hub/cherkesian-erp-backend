import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// bwip-js gera o QR Code (link do vídeo/IT) como PNG base64 para impressão na estação.
const bwipjs = require('bwip-js') as { toBuffer: (opts: Record<string, unknown>) => Promise<Buffer> };

/** Manual da Qualidade (SGQ) — estrutura ISO 9001:2015 (+ emenda 2024, mudança climática). */
type SgqManual = {
  visao?: string;
  missao?: string;
  valores?: string;
  politica?: string;
  escopo?: string;
  clausulas?: Array<{ num: string; titulo: string; texto?: string }>;
  atualizadoEm?: string;
  atualizadoPor?: string;
};

// Esqueleto padrão do Manual, na estrutura oficial vigente (Anexo SL, cláusulas 4–10).
// NÃO inventa requisitos de uma "versão 2026" não publicada — é ponto de partida editável.
const MANUAL_PADRAO: SgqManual = {
  visao: 'Ser referência em uniformes profissionais e hospitalares, reconhecida pela qualidade, prazo e atendimento.',
  missao: 'Fabricar e fornecer uniformes com qualidade consistente, no prazo combinado, cuidando de clientes, colaboradores e meio ambiente.',
  valores: 'Qualidade • Compromisso com o prazo • Respeito às pessoas • Melhoria contínua • Integridade',
  politica:
    'A Cherkesian compromete-se a atender aos requisitos dos clientes e legais aplicáveis, melhorar continuamente o Sistema de Gestão da Qualidade e a satisfação do cliente, considerando também os aspectos de mudança climática que possam afetar o negócio (ISO 9001:2015, Emenda 1:2024).',
  escopo: 'Projeto, fabricação e comercialização de uniformes profissionais e hospitalares.',
  clausulas: [
    { num: '4', titulo: 'Contexto da organização', texto: 'Questões internas/externas, partes interessadas (incl. mudança climática — emenda 2024), escopo do SGQ e seus processos.' },
    { num: '5', titulo: 'Liderança', texto: 'Liderança e comprometimento da direção, Política da Qualidade, papéis e responsabilidades.' },
    { num: '6', titulo: 'Planejamento', texto: 'Ações para riscos e oportunidades, objetivos da qualidade e planejamento de mudanças.' },
    { num: '7', titulo: 'Apoio', texto: 'Recursos, competência, conscientização, comunicação e informação documentada.' },
    { num: '8', titulo: 'Operação', texto: 'Planejamento e controle operacional, requisitos de produtos, projeto, produção (corte/costura/acabamento), controle de terceiros (facção) e liberação.' },
    { num: '9', titulo: 'Avaliação de desempenho', texto: 'Monitoramento, satisfação do cliente, análise de dados, auditoria interna e análise crítica pela direção.' },
    { num: '10', titulo: 'Melhoria', texto: 'Não conformidade e ação corretiva, melhoria contínua.' },
  ],
};

@Injectable()
export class SgqService {
  constructor(private readonly prisma: PrismaService) {}

  /** Visão geral do SGQ/Universidade para o usuário atual (manual, docs, meu progresso, ranking). */
  async overview(empresaId: number, usuario: string) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { sgqManual: true } });
    const manual = (empresa?.sgqManual as SgqManual | null) ?? MANUAL_PADRAO;

    const docs = await this.prisma.sgqDoc.findMany({
      where: { empresaId, ativo: true },
      orderBy: [{ tipo: 'asc' }, { ordem: 'asc' }, { codigo: 'asc' }],
    });

    const meuProg = await this.prisma.sgqProgresso.findMany({ where: { empresaId, usuario, concluido: true }, select: { docId: true } });
    const concluidos = meuProg.map((p) => p.docId);
    const totalPontos = docs.filter((d) => concluidos.includes(d.id)).reduce((s, d) => s + d.pontos, 0);
    const totalDisponivel = docs.reduce((s, d) => s + d.pontos, 0);

    // Ranking por pontos (soma dos pontos dos docs concluídos por usuário).
    const progAll = await this.prisma.sgqProgresso.findMany({ where: { empresaId, concluido: true }, select: { usuario: true, docId: true } });
    const pontoDoc = new Map(docs.map((d) => [d.id, d.pontos]));
    const porUser = new Map<string, number>();
    for (const p of progAll) porUser.set(p.usuario, (porUser.get(p.usuario) ?? 0) + (pontoDoc.get(p.docId) ?? 0));
    const ranking = [...porUser.entries()].map(([u, pts]) => ({ usuario: u, pontos: pts })).sort((a, b) => b.pontos - a.pontos).slice(0, 20);

    return {
      manual,
      docs,
      meuProgresso: concluidos,
      meusPontos: totalPontos,
      totalDisponivel,
      concluidos: concluidos.length,
      totalDocs: docs.length,
      nivel: this.nivel(totalPontos),
      ranking,
    };
  }

  private nivel(pontos: number): string {
    if (pontos >= 300) return 'Mestre';
    if (pontos >= 150) return 'Avançado';
    if (pontos >= 60) return 'Intermediário';
    if (pontos > 0) return 'Iniciante';
    return 'Novato';
  }

  /** Salva o Manual da Qualidade (admin). */
  async salvarManual(empresaId: number, manual: SgqManual, usuario: string) {
    const atual = { ...manual, atualizadoEm: new Date().toISOString(), atualizadoPor: usuario };
    await this.prisma.empresa.update({ where: { id: empresaId }, data: { sgqManual: atual as unknown as Prisma.InputJsonValue } });
    return atual;
  }

  /** Cria ou atualiza um documento (procedimento / instrução de trabalho). */
  async salvarDoc(empresaId: number, dto: { id?: number; tipo?: string; codigo: string; titulo: string; setor?: string; conteudo?: string; videoUrl?: string; clausulaIso?: string; pontos?: number; ordem?: number; revisao?: number }) {
    const data = {
      tipo: ['manual', 'procedimento', 'instrucao'].includes(dto.tipo ?? '') ? dto.tipo! : 'instrucao',
      codigo: (dto.codigo ?? '').trim().toUpperCase(),
      titulo: (dto.titulo ?? '').trim(),
      setor: dto.setor?.trim() || null,
      conteudo: dto.conteudo ?? null,
      videoUrl: dto.videoUrl?.trim() || null,
      clausulaIso: dto.clausulaIso?.trim() || null,
      pontos: dto.pontos != null && dto.pontos >= 0 ? Math.floor(dto.pontos) : 10,
      ordem: dto.ordem != null ? Math.floor(dto.ordem) : 0,
      revisao: dto.revisao != null && dto.revisao > 0 ? Math.floor(dto.revisao) : 1,
    };
    if (dto.id) {
      const ex = await this.prisma.sgqDoc.findUnique({ where: { id: dto.id } });
      if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Documento não encontrado.');
      return this.prisma.sgqDoc.update({ where: { id: dto.id }, data });
    }
    return this.prisma.sgqDoc.create({ data: { empresaId, ...data } });
  }

  async removerDoc(empresaId: number, id: number) {
    const ex = await this.prisma.sgqDoc.findUnique({ where: { id } });
    if (!ex || ex.empresaId !== empresaId) throw new NotFoundException('Documento não encontrado.');
    await this.prisma.sgqDoc.update({ where: { id }, data: { ativo: false } });
    return { ok: true };
  }

  /** Marca um doc como aprendido pelo colaborador (ganha os pontos). Idempotente. */
  async concluir(empresaId: number, usuario: string, docId: number) {
    const doc = await this.prisma.sgqDoc.findUnique({ where: { id: docId } });
    if (!doc || doc.empresaId !== empresaId) throw new NotFoundException('Documento não encontrado.');
    await this.prisma.sgqProgresso.upsert({
      where: { usuario_docId: { usuario, docId } },
      create: { empresaId, usuario, docId, concluido: true, pontos: doc.pontos },
      update: { concluido: true, pontos: doc.pontos, concluidoEm: new Date() },
    });
    return this.overview(empresaId, usuario);
  }

  /** Desmarca (remove a conclusão) — para refazer o treino. */
  async desmarcar(empresaId: number, usuario: string, docId: number) {
    await this.prisma.sgqProgresso.deleteMany({ where: { empresaId, usuario, docId } });
    return this.overview(empresaId, usuario);
  }

  /**
   * Gera a INSTRUÇÃO DE TRABALHO imprimível com QR Code. O QR aponta para o
   * vídeo tutorial (link) — o colaborador lê na estação e assiste o passo a passo.
   */
  async imprimirIt(empresaId: number, id: number) {
    const doc = await this.prisma.sgqDoc.findUnique({ where: { id } });
    if (!doc || doc.empresaId !== empresaId) throw new NotFoundException('Documento não encontrado.');
    const alvo = (doc.videoUrl || '').trim();
    let qr: string | null = null;
    if (alvo) {
      try {
        const buf = await bwipjs.toBuffer({ bcid: 'qrcode', text: alvo, scale: 5, padding: 2 });
        qr = 'data:image/png;base64,' + buf.toString('base64');
      } catch {
        /* sem QR se o link for inválido */
      }
    }
    return { doc, qr, semVideo: !alvo };
  }
}
