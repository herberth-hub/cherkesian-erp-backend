import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotaEntradaDto } from './dto/create-nota-entrada.dto';
import { proximoCodigo } from '../common/utils/codigo.util';

const digitos = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Notas de Entrada — NF de compra recebida do fornecedor.
 * Ao registrar, opcionalmente: (a) dá entrada no estoque de matéria-prima
 * (soma ao saldo dos materiais vinculados) e (b) gera um título no A Pagar.
 * Rastreador: consulta na Focus as NF-e emitidas contra o CNPJ (distribuição).
 */
@Injectable()
export class NotasEntradaService {
  private readonly logger = new Logger(NotasEntradaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  findAll(empresaId: number) {
    return this.prisma.notaEntrada.findMany({
      where: { empresaId },
      include: { fornecedor: { select: { id: true, nome: true } }, filial: { select: { id: true, nome: true, cnpj: true } }, itens: true },
      orderBy: { id: 'desc' },
    });
  }

  /** Marca a NF como etiquetada (volumes emitidos). */
  async marcarEtiquetasGeradas(id: number, empresaId: number) {
    const nota = await this.prisma.notaEntrada.findUnique({ where: { id } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota de entrada ${id} não encontrada.`);
    await this.prisma.notaEntrada.update({ where: { id }, data: { etiquetasGeradas: true } });
    return { ok: true };
  }

  async findOne(id: number, empresaId: number) {
    const nota = await this.prisma.notaEntrada.findUnique({
      where: { id },
      include: { fornecedor: true, itens: true },
    });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota de entrada ${id} não encontrada.`);
    return nota;
  }

  async create(dto: CreateNotaEntradaDto, empresaId: number, criadoPor: string) {
    if (dto.fornecedorId) {
      const f = await this.prisma.fornecedor.findUnique({ where: { id: dto.fornecedorId } });
      if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Fornecedor ${dto.fornecedorId} não encontrado.`);
    }
    if (dto.chave && digitos(dto.chave).length === 44) {
      const existe = await this.prisma.notaEntrada.findUnique({ where: { chave: digitos(dto.chave) } });
      if (existe) throw new BadRequestException(`Esta NF (chave ...${digitos(dto.chave).slice(-6)}) já foi registrada.`);
    }

    // Filial/CNPJ destinatário: usa a informada (validando a empresa); senão a matriz.
    let filialId = dto.filialId;
    if (filialId) {
      const fil = await this.prisma.filial.findUnique({ where: { id: filialId } });
      if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${filialId} não encontrada.`);
    } else {
      const matriz = await this.prisma.filial.findFirst({ where: { empresaId }, orderBy: [{ matriz: 'desc' }, { id: 'asc' }] });
      filialId = matriz?.id;
    }

    // Fornecedor: usa o informado; senão acha pelo CNPJ do emitente; senão CADASTRA na hora.
    let fornecedorId = dto.fornecedorId;
    if (!fornecedorId && dto.cnpjEmitente) {
      const cnpj = digitos(dto.cnpjEmitente);
      if (cnpj) {
        const existente = await this.prisma.fornecedor.findFirst({ where: { empresaId, cnpjCpf: cnpj } });
        fornecedorId = existente
          ? existente.id
          : (await this.prisma.fornecedor.create({ data: { empresaId, nome: dto.nomeEmitente || `Fornecedor ${cnpj}`, cnpjCpf: cnpj } })).id;
      }
    }

    const valor = dto.itens.reduce((s, it) => s + it.quantidade * it.valorUnit, 0);

    return this.prisma.$transaction(async (tx) => {
      // Auto-cadastro de materiais: cada item SEM vínculo acha (por descrição) ou CADASTRA
      // um material seguindo a regra de código MP-CAT-0000. Toda entrada fica no cadastro.
      const codigosMP = (await tx.material.findMany({ where: { empresaId }, select: { codigo: true } })).map((m) => m.codigo);
      for (const it of dto.itens) {
        if (it.materialId) continue;
        const desc = (it.descricao || '').trim();
        if (!desc) continue;
        const existente = await tx.material.findFirst({ where: { empresaId, descricao: { equals: desc, mode: 'insensitive' } } });
        if (existente) { it.materialId = existente.id; continue; }
        const codigo = proximoCodigo('MP', 'Matéria-prima', codigosMP);
        codigosMP.push(codigo);
        const novo = await tx.material.create({
          data: { empresaId, codigo, categoria: 'Matéria-prima', descricao: desc, unidade: it.unidade || 'un', custo: new Prisma.Decimal(Number(it.valorUnit || 0).toFixed(2)) },
        });
        it.materialId = novo.id;
      }

      // Título(s) a pagar (opcional) — uma conta por parcela; sem parcelas, 1 título.
      let contaPagarId: number | undefined;
      if (dto.gerarContaPagar) {
        const parcelas = (dto.parcelas && dto.parcelas.length)
          ? dto.parcelas
          : [{ vencimento: dto.vencimento || new Date().toISOString().slice(0, 10), valor }];
        const n = parcelas.length;
        for (let i = 0; i < n; i++) {
          const pc = parcelas[i];
          const cp = await tx.contaPagar.create({
            data: {
              empresaId,
              filialId,
              fornecedorId,
              categoria: dto.categoria || 'Matéria-prima',
              referencia: `NF entrada ${dto.numero}${n > 1 ? ` (${i + 1}/${n})` : ''}`,
              vencimento: new Date(pc.vencimento),
              valor: new Prisma.Decimal(Number(pc.valor).toFixed(2)),
            },
          });
          if (i === 0) contaPagarId = cp.id;
        }
      }

      const nota = await tx.notaEntrada.create({
        data: {
          empresaId,
          filialId,
          fornecedorId,
          numero: dto.numero,
          serie: dto.serie,
          chave: dto.chave ? digitos(dto.chave) : undefined,
          cnpjEmitente: dto.cnpjEmitente ? digitos(dto.cnpjEmitente) : undefined,
          nomeEmitente: dto.nomeEmitente,
          emitidaEm: dto.emitidaEm ? new Date(dto.emitidaEm) : undefined,
          valor: new Prisma.Decimal(valor.toFixed(2)),
          origem: 'manual',
          lancadaEstoque: !!dto.lancarEstoque,
          contaPagarId,
          obs: dto.obs,
          criadoPor,
          itens: {
            create: dto.itens.map((it) => ({
              materialId: it.materialId,
              descricao: it.descricao,
              ncm: it.ncm,
              quantidade: new Prisma.Decimal(it.quantidade),
              unidade: it.unidade || 'un',
              valorUnit: new Prisma.Decimal(it.valorUnit),
            })),
          },
        },
        include: { itens: true },
      });

      // Entrada no estoque de matéria-prima (soma ao saldo dos materiais vinculados)
      const lancados: string[] = [];
      const recebidoPorMat = new Map<number, number>();
      if (dto.lancarEstoque) {
        for (const it of dto.itens) {
          if (!it.materialId) continue;
          const mat = await tx.material.findUnique({ where: { id: it.materialId } });
          if (!mat || mat.empresaId !== empresaId) continue;
          await tx.material.update({
            where: { id: it.materialId },
            data: { saldo: { increment: new Prisma.Decimal(it.quantidade) } },
          });
          lancados.push(mat.codigo);
          recebidoPorMat.set(it.materialId, (recebidoPorMat.get(it.materialId) ?? 0) + Number(it.quantidade));
        }
      }

      // BAIXA AUTOMÁTICA das OCs/sugestão (necessidade × compra): para cada material
      // recebido, quita as OCs abertas do mesmo material (mais antigas primeiro), sem
      // somar estoque de novo (o estoque já entrou pela NF acima). Evita a duplicidade
      // de "Receber a OC" + "dar entrada na NF". Recebimento parcial deixa a OC aberta.
      const ocsBaixadas: string[] = [];
      for (const [matId, qtdRecebida] of recebidoPorMat) {
        let restante = qtdRecebida;
        const ocs = await tx.ordemCompra.findMany({
          where: { materialId: matId, status: 'aguardando', fornecedor: { empresaId } },
          orderBy: { id: 'asc' },
        });
        for (const oc of ocs) {
          const qtdOc = Number(oc.quantidade);
          if (restante < qtdOc * 0.99) break; // não cobre esta OC → para (fica aberta)
          await tx.ordemCompra.update({
            where: { id: oc.id },
            data: {
              status: 'recebida',
              recebidaEm: new Date(),
              notaEntradaId: nota.id,
              // Vincula o fornecedor real da compra (a sugestão nasce como "A DEFINIR").
              ...(fornecedorId ? { fornecedorId } : {}),
            },
          });
          restante -= qtdOc;
          ocsBaixadas.push(oc.numero);
        }
      }

      return { ...nota, contaPagarGerada: !!contaPagarId, materiaisAtualizados: lancados, ocsBaixadas };
    });
  }

  async remove(id: number, empresaId: number) {
    const nota = await this.findOne(id, empresaId);
    return this.prisma.$transaction(async (tx) => {
      // Estorna o estoque, se foi lançado
      if (nota.lancadaEstoque) {
        for (const it of nota.itens) {
          if (!it.materialId) continue;
          await tx.material.update({
            where: { id: it.materialId },
            data: { saldo: { decrement: it.quantidade } },
          }).catch(() => undefined);
        }
      }
      // Reabre as OCs que esta entrada havia baixado (desfaz o vínculo necessidade × compra)
      await tx.ordemCompra.updateMany({
        where: { notaEntradaId: id },
        data: { status: 'aguardando', notaEntradaId: null, recebidaEm: null },
      });
      // Remove o título a pagar gerado, se ainda existir e não tiver baixa
      if (nota.contaPagarId) {
        const cp = await tx.contaPagar.findUnique({ where: { id: nota.contaPagarId } });
        if (cp && Number(cp.pago) === 0) await tx.contaPagar.delete({ where: { id: cp.id } }).catch(() => undefined);
      }
      await tx.notaEntrada.delete({ where: { id } });
      return { removido: true, id };
    });
  }

  // ===== Rastreador SEFAZ (Focus — distribuição de NF-e) =====

  private async tokenEmpresa(empresaId: number): Promise<{ token: string; host: string; cnpj: string }> {
    const matriz = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });
    const token = matriz?.focusToken || this.config.get<string>('FOCUS_NFE_TOKEN');
    if (!token) throw new BadRequestException('Provedor NF-e não configurado (FOCUS_NFE_TOKEN).');
    const cnpj = digitos(matriz?.cnpj);
    if (!cnpj) throw new BadRequestException('CNPJ da matriz não configurado.');
    const host = this.config.get<string>('NFE_AMBIENTE') === 'producao'
      ? 'api.focusnfe.com.br'
      : 'homologacao.focusnfe.com.br';
    return { token, host, cnpj };
  }

  private focusHeaders(token: string) {
    return { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64') };
  }

  /** Lista as NF-e emitidas contra o CNPJ (as já importadas vêm marcadas). */
  async sefazListar(empresaId: number) {
    const { token, host, cnpj } = await this.tokenEmpresa(empresaId);
    const url = `https://${host}/v2/nfes_recebidas?cnpj=${cnpj}`;
    let lista: any[] = [];
    try {
      const res = await fetch(url, { headers: this.focusHeaders(token) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, motivo: `Focus HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, notas: [] };
      }
      lista = Array.isArray(body) ? body : ((body as { nfes?: any[] }).nfes ?? []);
    } catch (err) {
      this.logger.error(`Falha ao consultar NF-e recebidas: ${String(err)}`);
      return { ok: false, motivo: 'Erro de comunicação com o provedor.', notas: [] };
    }

    const chaves = lista.map((n) => digitos(n.chave_nfe || n.chave)).filter(Boolean);
    const jaImport = new Set(
      (await this.prisma.notaEntrada.findMany({ where: { empresaId, chave: { in: chaves } }, select: { chave: true } }))
        .map((n) => n.chave),
    );
    const notas = lista.map((n) => {
      const chave = digitos(n.chave_nfe || n.chave);
      return {
        chave,
        numero: n.numero ?? n.nfe ?? '—',
        emitente: n.nome_emitente ?? n.emitente ?? '—',
        cnpjEmitente: digitos(n.cnpj_emitente || n.cnpj),
        valor: Number(n.valor_total ?? n.valor ?? 0),
        data: n.data_emissao ?? n.data ?? null,
        situacao: n.situacao ?? n.status ?? '—',
        importada: jaImport.has(chave),
      };
    });
    return { ok: true, cnpj, quantidade: notas.length, notas };
  }

  /** Lista os CT-e (fretes) emitidos contra o CNPJ — arquivo dos conhecimentos de transporte. */
  async ctesListar(empresaId: number) {
    const { token, host, cnpj } = await this.tokenEmpresa(empresaId);
    const url = `https://${host}/v2/ctes_recebidas?cnpj=${cnpj}`;
    let lista: any[] = [];
    try {
      const res = await fetch(url, { headers: this.focusHeaders(token) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, motivo: `Focus HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, ctes: [] };
      lista = Array.isArray(body) ? body : ((body as { ctes?: any[] }).ctes ?? []);
    } catch (err) {
      this.logger.error(`Falha ao consultar CT-e recebidos: ${String(err)}`);
      return { ok: false, motivo: 'Erro de comunicação com o provedor.', ctes: [] };
    }
    const ctes = lista.map((c) => ({
      chave: digitos(c.chave_cte || c.chave),
      numero: c.numero ?? c.cte ?? '—',
      transportadora: c.nome_emitente ?? c.emitente ?? c.razao_social_emitente ?? '—',
      cnpjEmitente: digitos(c.cnpj_emitente || c.cnpj),
      valor: Number(c.valor_total ?? c.valor ?? c.valor_frete ?? 0),
      data: c.data_emissao ?? c.data ?? null,
      situacao: c.situacao ?? c.status ?? '—',
      caminho_xml: c.caminho_xml || c.caminho_xml_cte || null,
      caminho_pdf: c.caminho_dacte || c.caminho_pdf || null,
    }));
    return { ok: true, cnpj, quantidade: ctes.length, ctes };
  }

  /** Detalhe (JSON) de uma NF-e recebida pela chave — para pré-preencher a entrada. */
  async sefazDetalhe(empresaId: number, chave: string) {
    const { token, host } = await this.tokenEmpresa(empresaId);
    const ch = digitos(chave);
    const headers = this.focusHeaders(token);
    // Ciência da operação: sem manifestar, a SEFAZ só devolve o RESUMO (sem número/itens).
    // A ciência libera o XML completo. Ignora erro (ex.: já manifestada).
    await fetch(`https://${host}/v2/nfes_recebidas/${ch}/manifesto`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'ciencia' }),
    }).catch(() => null);
    const res = await fetch(`https://${host}/v2/nfes_recebidas/${ch}.json?completa=1`, { headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new BadRequestException(`Focus HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    // O JSON de notas recebidas NÃO traz os itens — eles só vêm no XML completo.
    // Se não houver itens, baixa o XML e extrai os produtos (descrição, qtd, un, valor).
    const temItens = Array.isArray(body.itens) && (body.itens as unknown[]).length > 0;
    if (!temItens) {
      const xmlPath = (body.caminho_xml_nota_fiscal || body.caminho_xml || body.caminho_completo_xml) as string | undefined;
      if (xmlPath) {
        try {
          const xres = await fetch(xmlPath.startsWith('http') ? xmlPath : `https://${host}${xmlPath}`, { headers });
          const xml = await xres.text();
          const itens = this.extrairItensXml(xml);
          if (itens.length) body.itens = itens;
          // Emitente/número pelo XML (reforço), caso o resumo não tenha.
          const cnpjXml = /<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/.exec(xml)?.[1];
          const nomeXml = /<emit>[\s\S]*?<xNome>([\s\S]*?)<\/xNome>/.exec(xml)?.[1];
          if (cnpjXml && !body.cnpj_emitente) body.cnpj_emitente = cnpjXml;
          if (nomeXml && !body.nome_emitente) body.nome_emitente = this.decodeXml(nomeXml.trim());
          const nNF = /<ide>[\s\S]*?<nNF>(\d+)<\/nNF>/.exec(xml)?.[1];
          if (nNF && !body.numero) body.numero = nNF;
          const serieX = /<ide>[\s\S]*?<serie>(\d+)<\/serie>/.exec(xml)?.[1];
          if (serieX && !body.serie) body.serie = serieX;
        } catch { /* mantém o resumo se o XML falhar */ }
      }
    }
    return body;
  }

  /** Extrai os itens (produtos) de um XML de NF-e: descrição, qtd, unidade, valor, NCM. */
  private extrairItensXml(xml: string): Array<{ codigo?: string; descricao: string; ncm?: string; quantidade: number; unidade: string; valorUnit: number; valorTotal?: number }> {
    const dets = [...xml.matchAll(/<det\b[^>]*>([\s\S]*?)<\/det>/g)];
    const tag = (seg: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(seg)?.[1]?.trim();
    return dets.map((m) => {
      const seg = m[1];
      const prodMatch = /<prod>([\s\S]*?)<\/prod>/.exec(seg);
      const prod = prodMatch ? prodMatch[1] : seg;
      return {
        codigo: tag(prod, 'cProd'),
        descricao: this.decodeXml(tag(prod, 'xProd') || 'Item'),
        ncm: tag(prod, 'NCM'),
        quantidade: Number(tag(prod, 'qCom') || tag(prod, 'qTrib') || 1),
        unidade: (tag(prod, 'uCom') || tag(prod, 'uTrib') || 'un').slice(0, 6),
        valorUnit: Number(tag(prod, 'vUnCom') || tag(prod, 'vUnTrib') || 0),
        valorTotal: Number(tag(prod, 'vProd') || 0) || undefined,
      };
    }).filter((it) => it.descricao);
  }

  /** Decodifica entidades XML comuns (&amp; &lt; &gt; &quot; &#39;). */
  private decodeXml(s: string): string {
    return s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }
}
