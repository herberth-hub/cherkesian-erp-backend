import {
  BadRequestException,
  HttpException,
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

    // Resolve/cadastra os materiais dos itens ANTES da transação (encurta a transação
    // e evita cair a conexão do Neon no meio dela — P2028).
    await this.resolverMateriaisItens(dto.itens, empresaId, fornecedorId);

    // ===== Pré-processamento FORA da transação =====
    // Todas as LEITURAS (materiais, produtos, OCs) e a lógica de baixa acontecem aqui,
    // com this.prisma. A transação abaixo faz só ESCRITAS agrupadas (poucas idas ao
    // banco). Antes eram ~150 idas sequenciais dentro da tx interativa; com NF de muitos
    // itens e a latência até o Neon/pgbouncer, a conexão caía no meio (P2028). Agora são ~5.
    const lancados: string[] = [];
    const movimentosData: Prisma.MovimentoMaterialCreateManyInput[] = [];
    const saldoInc = new Map<number, number>();          // materialId -> incremento total do saldo
    const recebidoPorMat = new Map<number, number>();    // materialId -> qtd recebida
    const recebidoPorProd = new Map<number, number>();   // produtoId  -> qtd recebida (revenda)
    const prodById = new Map<number, { codigo: string }>();

    if (dto.lancarEstoque) {
      const matIds = [...new Set(dto.itens.filter((it) => it.materialId).map((it) => it.materialId as number))];
      const prodIds = [...new Set(dto.itens.filter((it) => it.produtoId).map((it) => it.produtoId as number))];
      const mats = matIds.length ? await this.prisma.material.findMany({ where: { id: { in: matIds } } }) : [];
      const prods = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } } }) : [];
      const matById = new Map(mats.filter((m) => m.empresaId === empresaId).map((m) => [m.id, m] as const));
      for (const p of prods) if (p.empresaId === empresaId) prodById.set(p.id, p);

      const saldoCorrente = new Map<number, number>();   // running saldo p/ o saldoApos de cada movimento
      for (const it of dto.itens) {
        if (!it.materialId) continue;
        const mat = matById.get(it.materialId);
        if (!mat) continue;
        const qtd = Number(it.quantidade);
        const base = saldoCorrente.has(it.materialId) ? (saldoCorrente.get(it.materialId) as number) : Number(mat.saldo);
        const novo = base + qtd;
        saldoCorrente.set(it.materialId, novo);
        saldoInc.set(it.materialId, (saldoInc.get(it.materialId) ?? 0) + qtd);
        recebidoPorMat.set(it.materialId, (recebidoPorMat.get(it.materialId) ?? 0) + qtd);
        movimentosData.push({
          empresaId, materialId: it.materialId, tipo: 'entrada',
          quantidade: new Prisma.Decimal(it.quantidade), unidade: mat.unidade,
          saldoApos: new Prisma.Decimal(novo.toFixed(3)), origem: 'nf_entrada',
          documento: `NF ${dto.numero}`, criadoPor,
        });
        lancados.push(mat.codigo);
      }
      for (const it of dto.itens) {
        if (!it.produtoId || !prodById.has(it.produtoId)) continue;
        const qtd = Math.round(Number(it.quantidade));
        if (qtd < 1) continue;
        recebidoPorProd.set(it.produtoId, (recebidoPorProd.get(it.produtoId) ?? 0) + qtd);
      }
    }

    // Baixa automática das OCs (necessidade × compra): decide FORA da tx quais OCs quitar
    // (mais antigas primeiro; recebimento parcial deixa a OC aberta).
    const ocBaixaSet = new Set<number>();
    const ocsBaixadas: string[] = [];
    const pedidosAfetados = new Set<string>();

    if (recebidoPorMat.size) {
      const ocs = await this.prisma.ordemCompra.findMany({
        where: { materialId: { in: [...recebidoPorMat.keys()] }, status: 'aguardando', fornecedor: { empresaId } },
        orderBy: { id: 'asc' },
      });
      const porMat = new Map<number, typeof ocs>();
      for (const oc of ocs) {
        const k = oc.materialId as number;
        const arr = porMat.get(k);
        if (arr) arr.push(oc); else porMat.set(k, [oc]);
      }
      for (const [matId, qtdRecebida] of recebidoPorMat) {
        let restante = qtdRecebida;
        for (const oc of porMat.get(matId) ?? []) {
          const qtdOc = Number(oc.quantidade);
          if (restante < qtdOc * 0.99) break;
          ocBaixaSet.add(oc.id); ocsBaixadas.push(oc.numero); restante -= qtdOc;
        }
      }
    }
    if (recebidoPorProd.size) {
      const ocs = await this.prisma.ordemCompra.findMany({
        where: { produtoId: { in: [...recebidoPorProd.keys()] }, status: 'aguardando', fornecedor: { empresaId } },
        orderBy: { id: 'asc' },
      });
      const porProd = new Map<number, typeof ocs>();
      for (const oc of ocs) {
        const k = oc.produtoId as number;
        const arr = porProd.get(k);
        if (arr) arr.push(oc); else porProd.set(k, [oc]);
      }
      for (const [prodId, qtdRecebida] of recebidoPorProd) {
        let restante = qtdRecebida;
        for (const oc of porProd.get(prodId) ?? []) {
          const qtdOc = Number(oc.quantidade);
          if (restante < qtdOc * 0.99) break;
          ocBaixaSet.add(oc.id); ocsBaixadas.push(oc.numero); restante -= qtdOc;
          const m = /^Pedido (\S+) \(revenda\)$/.exec(oc.motivo ?? '');
          if (m) pedidosAfetados.add(m[1]);
        }
      }
    }
    const codsNf = [...new Set((dto.itens ?? []).map((it) => (it.codigoFornecedor ?? '').trim()).filter(Boolean))];
    if (codsNf.length) {
      const ocs = await this.prisma.ordemCompra.findMany({
        where: { codigoFornecedor: { in: codsNf }, status: 'aguardando', materialId: null, produtoId: null, fornecedor: { empresaId } },
        orderBy: { id: 'asc' },
      });
      for (const oc of ocs) {
        ocBaixaSet.add(oc.id); ocsBaixadas.push(oc.numero);
        const m = /^Pedido (\S+) \(revenda\)$/.exec(oc.motivo ?? '');
        if (m) pedidosAfetados.add(m[1]);
      }
    }
    const ocBaixaIds = [...ocBaixaSet];

    try {
    return await this.comRetryTx(() => this.prisma.$transaction(async (tx) => {
      // Título(s) a pagar (opcional) — uma conta por parcela; sem parcelas, 1 título.
      let contaPagarId: number | undefined;
      if (dto.gerarContaPagar) {
        const parcelas = (dto.parcelas && dto.parcelas.length)
          ? dto.parcelas
          : [{ vencimento: dto.vencimento || new Date().toISOString().slice(0, 10), valor }];
        const n = parcelas.length;
        for (let i = 0; i < n; i++) {
          const pc = parcelas[i];
          const pcValor = new Prisma.Decimal(Number(pc.valor).toFixed(2));
          const cp = await tx.contaPagar.create({
            data: {
              empresaId,
              filialId,
              fornecedorId,
              categoria: dto.categoria || 'Matéria-prima',
              referencia: `NF entrada ${dto.numero}${n > 1 ? ` (${i + 1}/${n})` : ''}`,
              vencimento: new Date(pc.vencimento),
              valor: pcValor,
              // NF já paga: nasce quitada (não fica em aberto no contas a pagar).
              ...(dto.pago ? { pago: pcValor, status: 'pago' as never, bancoPagto: dto.bancoPagto || undefined } : {}),
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
              produtoId: it.produtoId,
              descricao: it.descricao,
              codigoFornecedor: it.codigoFornecedor?.trim() || null,
              ncm: it.ncm,
              quantidade: new Prisma.Decimal(it.quantidade),
              unidade: it.unidade || 'un',
              valorUnit: new Prisma.Decimal(it.valorUnit),
            })),
          },
        },
        include: { itens: true },
      });

      // Entrada no estoque de matéria-prima: saldos em UMA query (raw) + movimentos em lote.
      if (saldoInc.size) {
        const values = Prisma.join([...saldoInc.entries()].map(([mid, inc]) => Prisma.sql`(${mid}::int, ${inc.toFixed(3)}::numeric)`));
        await tx.$executeRaw`UPDATE "Material" AS m SET saldo = m.saldo + v.inc FROM (VALUES ${values}) AS v(id, inc) WHERE m.id = v.id`;
      }
      if (movimentosData.length) await tx.movimentoMaterial.createMany({ data: movimentosData });
      // Produtos de REVENDA: entram no estoque do produto (Estoque agregado, tamanho único).
      for (const [prodId, qtd] of recebidoPorProd) {
        const prod = prodById.get(prodId);
        if (!prod || qtd < 1) continue;
        const est = await tx.estoque.upsert({
          where: { produtoId_tamanho: { produtoId: prodId, tamanho: 'UNICO' } },
          update: { entradas: { increment: qtd } },
          create: { produtoId: prodId, tamanho: 'UNICO', entradas: qtd, saidas: 0, minimo: 0 },
        });
        await tx.lote.create({ data: { estoqueId: est.id, codigoLote: `NF-${dto.numero}`, quantidade: qtd } }).catch(() => undefined);
        lancados.push(prod.codigo);
      }

      // BAIXA AUTOMÁTICA das OCs recebidas (materiais, revenda e por código do fornecedor):
      // as listas foram decididas FORA da transação; aqui é UMA única atualização em lote.
      // O estoque já entrou pela NF acima; não soma de novo. Evita a duplicidade
      // de "Receber a OC" + "dar entrada na NF".
      if (ocBaixaIds.length) {
        await tx.ordemCompra.updateMany({
          where: { id: { in: ocBaixaIds } },
          data: {
            status: 'recebida',
            situacao: 'recebido',
            recebidaEm: new Date(),
            notaEntradaId: nota.id,
            // Vincula o fornecedor real da compra (a sugestão nasce como "A DEFINIR").
            ...(fornecedorId ? { fornecedorId } : {}),
          },
        });
      }
      // Pedido aguardando material: se não há mais OC de revenda aberta dele, libera p/ expedição.
      const pedidosLiberados: string[] = [];
      for (const numero of pedidosAfetados) {
        const restam = await tx.ordemCompra.count({ where: { status: 'aguardando', motivo: `Pedido ${numero} (revenda)`, fornecedor: { empresaId } } });
        if (restam > 0) continue;
        const ped = await tx.pedido.findFirst({ where: { numero, empresaId }, select: { id: true, etapa: true } });
        if (ped && ped.etapa === 'compra') {
          await tx.pedido.update({ where: { id: ped.id }, data: { etapa: 'estoque', status: 'Pronto para expedição' } });
          pedidosLiberados.push(numero);
        }
      }

      return { ...nota, contaPagarGerada: !!contaPagarId, materiaisAtualizados: lancados, ocsBaixadas, pedidosLiberados };
    }, { timeout: 30000, maxWait: 15000 })); // NF com muitos itens: timeout maior + retry se a conexão cair (P2028)
    } catch (e) {
      if (e instanceof HttpException) throw e; // validações (400/404) passam direto
      const err = e as { code?: string; message?: string };
      this.logger.error(`Falha ao registrar NF de entrada ${dto.numero} (${dto.itens?.length ?? 0} itens): ${err?.code ?? ''} ${err?.message ?? ''}`);
      throw new BadRequestException(`Não foi possível registrar a NF: ${err?.message || 'erro interno'}${err?.code ? ` [${err.code}]` : ''}`);
    }
  }

  /**
   * Edita uma NF de entrada já registrada (ex.: valor divergente).
   * Reverte os efeitos antigos (estoque + OCs) e reaplica com os novos itens,
   * ajustando o título a pagar vinculado quando ainda não houve baixa.
   */
  async update(id: number, dto: CreateNotaEntradaDto, empresaId: number) {
    const nota = await this.prisma.notaEntrada.findUnique({ where: { id }, include: { itens: true } });
    if (!nota || nota.empresaId !== empresaId) throw new NotFoundException(`Nota de entrada ${id} não encontrada.`);

    // Chave: se informada e diferente, valida dedupe (ignorando a própria nota).
    if (dto.chave && digitos(dto.chave).length === 44) {
      const outra = await this.prisma.notaEntrada.findUnique({ where: { chave: digitos(dto.chave) } });
      if (outra && outra.id !== id) throw new BadRequestException(`Esta NF (chave ...${digitos(dto.chave).slice(-6)}) já foi registrada em outra entrada.`);
    }

    // Filial destino (mantém a atual se não informada).
    let filialId = dto.filialId ?? nota.filialId ?? undefined;
    if (dto.filialId) {
      const fil = await this.prisma.filial.findUnique({ where: { id: dto.filialId } });
      if (!fil || fil.empresaId !== empresaId) throw new NotFoundException(`Filial ${dto.filialId} não encontrada.`);
    }

    // Fornecedor: informado > pelo CNPJ emitente > mantém o atual.
    let fornecedorId = dto.fornecedorId ?? nota.fornecedorId ?? undefined;
    if (!dto.fornecedorId && dto.cnpjEmitente) {
      const cnpj = digitos(dto.cnpjEmitente);
      if (cnpj) {
        const existente = await this.prisma.fornecedor.findFirst({ where: { empresaId, cnpjCpf: cnpj } });
        fornecedorId = existente
          ? existente.id
          : (await this.prisma.fornecedor.create({ data: { empresaId, nome: dto.nomeEmitente || `Fornecedor ${cnpj}`, cnpjCpf: cnpj } })).id;
      }
    }

    const valor = dto.itens.reduce((s, it) => s + it.quantidade * it.valorUnit, 0);
    const lancar = dto.lancarEstoque ?? nota.lancadaEstoque;

    // Resolve/cadastra os materiais FORA da transação (encurta a tx; evita P2028 no Neon).
    await this.resolverMateriaisItens(dto.itens, empresaId, fornecedorId);

    return this.comRetryTx(() => this.prisma.$transaction(async (tx) => {
      // 1) REVERTE efeitos antigos ------------------------------------------
      // 1a) estorna o estoque dos itens anteriores (se havia sido lançado)
      if (nota.lancadaEstoque) {
        for (const it of nota.itens) {
          if (!it.materialId) continue;
          await tx.material.update({ where: { id: it.materialId }, data: { saldo: { decrement: it.quantidade } } }).catch(() => undefined);
        }
      }
      // 1b) reabre as OCs que esta NF havia baixado
      await tx.ordemCompra.updateMany({ where: { notaEntradaId: id }, data: { status: 'aguardando', notaEntradaId: null, recebidaEm: null } });
      // 1c) remove os itens antigos (serão recriados)
      await tx.notaEntradaItem.deleteMany({ where: { notaEntradaId: id } });

      // 3) Atualiza cabeçalho + recria itens
      const atualizada = await tx.notaEntrada.update({
        where: { id },
        data: {
          filialId,
          fornecedorId,
          numero: dto.numero,
          serie: dto.serie,
          chave: dto.chave ? digitos(dto.chave) : nota.chave,
          cnpjEmitente: dto.cnpjEmitente ? digitos(dto.cnpjEmitente) : nota.cnpjEmitente,
          nomeEmitente: dto.nomeEmitente ?? nota.nomeEmitente,
          emitidaEm: dto.emitidaEm ? new Date(dto.emitidaEm) : nota.emitidaEm,
          valor: new Prisma.Decimal(valor.toFixed(2)),
          lancadaEstoque: lancar,
          obs: dto.obs ?? nota.obs,
          itens: {
            create: dto.itens.map((it) => ({
              materialId: it.materialId,
              produtoId: it.produtoId,
              descricao: it.descricao,
              codigoFornecedor: it.codigoFornecedor?.trim() || null,
              ncm: it.ncm,
              quantidade: new Prisma.Decimal(it.quantidade),
              unidade: it.unidade || 'un',
              valorUnit: new Prisma.Decimal(it.valorUnit),
            })),
          },
        },
        include: { itens: true },
      });

      // 4) RELANÇA o estoque com as novas quantidades
      const recebidoPorMat = new Map<number, number>();
      if (lancar) {
        for (const it of dto.itens) {
          if (!it.materialId) continue;
          await tx.material.update({ where: { id: it.materialId }, data: { saldo: { increment: new Prisma.Decimal(it.quantidade) } } });
          recebidoPorMat.set(it.materialId, (recebidoPorMat.get(it.materialId) ?? 0) + Number(it.quantidade));
        }
      }

      // 5) Re-baixa as OCs abertas do material (necessidade × compra)
      const ocsBaixadas: string[] = [];
      for (const [matId, qtdRecebida] of recebidoPorMat) {
        let restante = qtdRecebida;
        const ocs = await tx.ordemCompra.findMany({ where: { materialId: matId, status: 'aguardando', fornecedor: { empresaId } }, orderBy: { id: 'asc' } });
        for (const oc of ocs) {
          const qtdOc = Number(oc.quantidade);
          if (restante < qtdOc * 0.99) break;
          await tx.ordemCompra.update({ where: { id: oc.id }, data: { status: 'recebida', recebidaEm: new Date(), notaEntradaId: id, ...(fornecedorId ? { fornecedorId } : {}) } });
          restante -= qtdOc;
          ocsBaixadas.push(oc.numero);
        }
      }

      // 6) Ajusta o título a pagar vinculado ao novo valor (só se ainda não pago)
      let tituloAjustado = false, tituloPago = false;
      if (nota.contaPagarId) {
        const cp = await tx.contaPagar.findUnique({ where: { id: nota.contaPagarId } });
        if (cp) {
          if (Number(cp.pago) > 0) tituloPago = true;
          else { await tx.contaPagar.update({ where: { id: cp.id }, data: { valor: new Prisma.Decimal(valor.toFixed(2)) } }); tituloAjustado = true; }
        }
      }

      return { ...atualizada, ocsBaixadas, tituloAjustado, tituloPago };
    }, { timeout: 30000, maxWait: 15000 }));
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
    }, { timeout: 30000, maxWait: 15000 });
  }

  // ===== Vínculo automático de material pelo CÓDIGO DO FORNECEDOR (artigo) =====
  /** Índice de materiais por código do fornecedor: "fornId|cod" e "cod" (fallback). */
  private indiceCodigoFornecedor(mats: Array<{ id: number; codigoArtigo: string | null; fornecedorId: number | null }>): Map<string, number> {
    const idx = new Map<string, number>();
    for (const m of mats) {
      const ca = String(m.codigoArtigo || '').trim().toLowerCase();
      if (!ca) continue;
      if (m.fornecedorId) idx.set(`${m.fornecedorId}|${ca}`, m.id);
      if (!idx.has(ca)) idx.set(ca, m.id);
    }
    return idx;
  }
  private acharPorCodigoForn(idx: Map<string, number>, fornecedorId: number | undefined, codigoForn?: string | null): number | undefined {
    const c = String(codigoForn || '').trim().toLowerCase();
    if (!c) return undefined;
    return (fornecedorId ? idx.get(`${fornecedorId}|${c}`) : undefined) ?? idx.get(c);
  }
  private registrarCodigoForn(idx: Map<string, number>, fornecedorId: number | undefined, codigoForn: string | undefined, id: number): void {
    const c = String(codigoForn || '').trim().toLowerCase();
    if (!c) return;
    if (fornecedorId) idx.set(`${fornecedorId}|${c}`, id);
    if (!idx.has(c)) idx.set(c, id);
  }

  /** Resolve/cadastra os materiais dos itens FORA da transação (casa por código do
   *  fornecedor → descrição → cria). Encurta a transação e evita P2028 no Neon. */
  private async resolverMateriaisItens(
    itens: Array<{ materialId?: number | null; produtoId?: number | null; descricao?: string; codigoFornecedor?: string; unidade?: string; valorUnit: number }>,
    empresaId: number,
    fornecedorId?: number,
  ): Promise<void> {
    const semVinculo = itens.some((it) => !it.materialId && !it.produtoId && (it.descricao || '').trim());
    if (!semVinculo) return;
    const mats = await this.prisma.material.findMany({ where: { empresaId }, select: { id: true, codigo: true, descricao: true, codigoArtigo: true, fornecedorId: true } });
    const codigosMP = mats.map((m) => m.codigo);
    const matPorDesc = new Map(mats.map((m) => [String(m.descricao || '').trim().toLowerCase(), m.id]));
    const idxCod = this.indiceCodigoFornecedor(mats);
    for (const it of itens) {
      if (it.materialId || it.produtoId) continue;
      const idPorCod = this.acharPorCodigoForn(idxCod, fornecedorId, it.codigoFornecedor);
      if (idPorCod) { it.materialId = idPorCod; continue; }
      const desc = (it.descricao || '').trim();
      if (!desc) continue;
      const chave = desc.toLowerCase();
      const existenteId = matPorDesc.get(chave);
      if (existenteId) { it.materialId = existenteId; continue; }
      const codigo = proximoCodigo('MP', 'Matéria-prima', codigosMP);
      codigosMP.push(codigo);
      const codf = it.codigoFornecedor?.trim();
      const novo = await this.prisma.material.create({
        data: { empresaId, codigo, categoria: 'Matéria-prima', descricao: desc, unidade: it.unidade || 'un', custo: new Prisma.Decimal(Number(it.valorUnit || 0).toFixed(2)), ...(codf ? { codigoArtigo: codf, ...(fornecedorId ? { fornecedorId } : {}) } : {}) },
      });
      it.materialId = novo.id;
      matPorDesc.set(chave, novo.id);
      this.registrarCodigoForn(idxCod, fornecedorId, codf, novo.id);
    }
  }

  /** Re-tenta a transação quando a conexão do banco cai no meio (P2028 do Neon/pooler). */
  private async comRetryTx<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
    let ultimo: unknown;
    for (let i = 0; i < tentativas; i++) {
      try { return await fn(); }
      catch (e) {
        ultimo = e;
        const code = (e as { code?: string })?.code;
        const msg = (e as Error)?.message || '';
        const transiente = code === 'P2028' || /transaction (not found|already closed)|closed transaction|before disconnecting|Server has closed the connection|Can't reach database/i.test(msg);
        if (!transiente || i === tentativas - 1) throw e;
        this.logger.warn(`Transação instável (${code || 'conexão'}), tentativa ${i + 1}/${tentativas}…`);
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw ultimo;
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
    const temNumero = body.numero != null && String(body.numero) !== '';
    if (!temItens || !temNumero) {
      // Busca o XML completo por vários caminhos possíveis do resumo e, como
      // reforço, pelo endpoint direto .xml (o resumo da distribuição NÃO traz
      // número nem itens — só o XML completo depois da ciência).
      const xml = await this.baixarXmlRecebida(host, headers, ch, body);
      if (xml && /<det\b/.test(xml)) {
        const itens = this.extrairItensXml(xml);
        if (itens.length) body.itens = itens;
        // Emitente/número/série pelo XML (o que sai destacado na NF do fornecedor).
        const cnpjXml = /<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/.exec(xml)?.[1];
        const nomeXml = /<emit>[\s\S]*?<xNome>([\s\S]*?)<\/xNome>/.exec(xml)?.[1];
        if (cnpjXml && !body.cnpj_emitente) body.cnpj_emitente = cnpjXml;
        if (nomeXml && !body.nome_emitente) body.nome_emitente = this.decodeXml(nomeXml.trim());
        const nNF = /<ide>[\s\S]*?<nNF>(\d+)<\/nNF>/.exec(xml)?.[1];
        if (nNF) body.numero = nNF;
        const serieX = /<ide>[\s\S]*?<serie>(\d+)<\/serie>/.exec(xml)?.[1];
        if (serieX && !body.serie) body.serie = serieX;
        // CNPJ do DESTINATÁRIO (quem recebeu) — permite selecionar a empresa/filial certa.
        const cnpjDest = /<dest>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/.exec(xml)?.[1] || /<dest>[\s\S]*?<CPF>(\d+)<\/CPF>/.exec(xml)?.[1];
        if (cnpjDest && !body.cnpj_destinatario) body.cnpj_destinatario = cnpjDest;
        // Volumes declarados (transp/vol/qVol) — total p/ etiquetas por volume.
        const qVol = [...xml.matchAll(/<qVol>(\d+)<\/qVol>/g)].reduce((s, m) => s + Number(m[1] || 0), 0);
        if (qVol && !body.quantidade_volumes) body.quantidade_volumes = qVol;
      }
    }
    return body;
  }

  /**
   * Baixa o XML COMPLETO de uma NF-e recebida (destaca número e itens iguais à
   * NF do fornecedor). Tenta, em ordem: caminhos declarados no resumo, o endpoint
   * direto `.xml` e, por fim, o campo XML embutido no próprio JSON.
   */
  private async baixarXmlRecebida(
    host: string,
    headers: Record<string, string>,
    chave: string,
    body: Record<string, unknown>,
  ): Promise<string | null> {
    const candidatos = [
      body.caminho_xml_nota_fiscal,
      body.caminho_xml,
      body.caminho_completo_xml,
      body.caminho_xml_completo,
      body.caminho_completo_nota_fiscal,
      body.caminho_xml_nfe,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    for (const path of candidatos) {
      try {
        const url = path.startsWith('http') ? path : `https://${host}${path}`;
        const r = await fetch(url, { headers });
        if (r.ok) {
          const xml = await r.text();
          if (xml && /<det\b/.test(xml)) return xml;
        }
      } catch { /* tenta o próximo */ }
    }
    // Fallback: endpoint direto do XML da nota recebida (por chave).
    try {
      const r = await fetch(`https://${host}/v2/nfes_recebidas/${chave}.xml`, { headers });
      if (r.ok) {
        const xml = await r.text();
        if (xml && /<det\b/.test(xml)) return xml;
      }
    } catch { /* ignora */ }
    // Último recurso: XML embutido no JSON de resposta.
    for (const k of ['xml', 'xml_nota_fiscal', 'xml_completo']) {
      const v = body[k];
      if (typeof v === 'string' && /<det\b/.test(v)) return v;
    }
    return null;
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
