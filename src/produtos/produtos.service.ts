import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Produto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { proximoCodigo } from '../common/utils/codigo.util';
import { ArquivosService } from '../arquivos/arquivos.service';

@Injectable()
export class ProdutosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arquivos: ArquivosService,
  ) {}

  /** Teto de fotos por chamada: ~100 KB cada, então 24 já é ~2,4 MB de resposta. */
  private static readonly FOTOS_POR_LOTE = 24;

  /**
   * Fotos (data URI) dos produtos pedidos, para a galeria do catálogo.
   *
   * Vem em lote e sob demanda porque `findAll` omite os base64: com 221 produtos
   * a ~100 KB, mandar tudo junto seriam ~22 MB a cada abertura da tela. Produto
   * sem foto volta como `null` — a galeria mostra o espaço de "sem foto" e não
   * pergunta de novo.
   */
  async fotos(ids: number[], empresaId: number): Promise<Record<number, string | null>> {
    const limpos = [...new Set((ids ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
      .slice(0, ProdutosService.FOTOS_POR_LOTE);
    if (!limpos.length) return {};
    const rows = await this.prisma.produto.findMany({
      where: { id: { in: limpos }, empresaId },
      select: { id: true, fotoModelo: true },
    });
    const out: Record<number, string | null> = {};
    // Todos os ids pedidos voltam, mesmo sem foto: assim a tela sabe que já
    // perguntou por aquele produto e não fica repetindo a consulta.
    for (const id of limpos) out[id] = null;
    for (const r of rows) out[r.id] = this.imagemParaTela(r.fotoModelo);
    return out;
  }

  /**
   * O que a tela recebe para pôr num `<img src>`: o data URI, se o anexo ainda
   * está no banco, ou um link assinado, se já foi para o bucket.
   */
  private imagemParaTela(v: string | null | undefined): string | null {
    const s: string = String(v ?? '').trim();
    if (ArquivosService.ehReferencia(s)) return this.arquivos.url(s);
    return s.startsWith('data:image') ? s : null;
  }

  // ---------- Cores do produto (cada uma com o seu mockup) ----------

  /** Confere que o produto é da empresa antes de mexer nas cores dele. */
  private async produtoDaEmpresa(produtoId: number, empresaId: number) {
    const p = await this.prisma.produto.findUnique({
      where: { id: produtoId },
      select: { id: true, empresaId: true, cor: true },
    });
    if (!p || p.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${produtoId} não encontrado.`);
    }
    return p;
  }

  /** Nome da cor normalizado: sem espaço sobrando e em caixa alta, que é como o
   *  resto do sistema (OP, etiqueta, NF) grava cor. */
  private static nomeCor(nome: string): string {
    const n = String(nome ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!n) throw new BadRequestException('A cor precisa de um nome.');
    if (n.length > 60) throw new BadRequestException('Nome de cor muito longo (máx. 60).');
    return n;
  }

  /**
   * `Produto.cor` continua sendo o texto que sai na OP, na etiqueta e na NF, e
   * que várias telas leem. Depois de mexer nas cores cadastradas, reescrevemos
   * esse texto a partir delas — assim os dois nunca divergem.
   */
  private async espelharCorTexto(produtoId: number): Promise<string> {
    const cores = await this.prisma.produtoCor.findMany({
      where: { produtoId },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      select: { nome: true },
    });
    const texto = cores.map((c) => c.nome).join(', ');
    await this.prisma.produto.update({ where: { id: produtoId }, data: { cor: texto || null } });
    return texto;
  }

  /** Cores do produto. `comMockup=false` deixa os base64 de fora (lista leve). */
  async cores(produtoId: number, empresaId: number, comMockup = false) {
    await this.produtoDaEmpresa(produtoId, empresaId);
    const linhas = await this.prisma.produtoCor.findMany({
      where: { produtoId },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      select: {
        id: true, nome: true, hex: true, ordem: true,
        ...(comMockup ? { mockupFrente: true, mockupCostas: true } : {}),
      },
    });
    if (!comMockup) return linhas;
    // Aqui pode virar link: a ficha só EXIBE o mockup; quem grava é o upload,
    // que manda um data URI novo.
    return linhas.map((c) => ({
      ...c,
      mockupFrente: this.imagemParaTela(c.mockupFrente),
      mockupCostas: this.imagemParaTela(c.mockupCostas),
    }));
  }

  async criarCor(produtoId: number, empresaId: number, dto: { nome: string; hex?: string }) {
    await this.produtoDaEmpresa(produtoId, empresaId);
    const nome = ProdutosService.nomeCor(dto.nome);
    const ultima = await this.prisma.produtoCor.findFirst({
      where: { produtoId },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    try {
      const cor = await this.prisma.produtoCor.create({
        data: { produtoId, nome, hex: dto.hex?.trim() || null, ordem: (ultima?.ordem ?? -1) + 1 },
        select: { id: true, nome: true, hex: true, ordem: true },
      });
      await this.espelharCorTexto(produtoId);
      return cor;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`O produto já tem a cor "${nome}".`);
      }
      throw e;
    }
  }

  async atualizarCor(
    produtoId: number,
    corId: number,
    empresaId: number,
    dto: { nome?: string; hex?: string | null; ordem?: number; mockupFrente?: string | null; mockupCostas?: string | null },
  ) {
    await this.produtoDaEmpresa(produtoId, empresaId);
    const atual = await this.prisma.produtoCor.findUnique({ where: { id: corId }, select: { produtoId: true } });
    if (!atual || atual.produtoId !== produtoId) {
      throw new NotFoundException(`Cor ${corId} não é deste produto.`);
    }
    const data: Prisma.ProdutoCorUpdateInput = {};
    if (dto.nome !== undefined) data.nome = ProdutosService.nomeCor(dto.nome);
    if (dto.hex !== undefined) data.hex = dto.hex?.trim() || null;
    if (dto.ordem !== undefined) data.ordem = dto.ordem;
    // String vazia apaga o mockup; undefined deixa como está. Mockup novo vai
    // para o bucket, e o que ele substitui sai de lá.
    const antigo = await this.prisma.produtoCor.findUnique({
      where: { id: corId },
      select: { mockupFrente: true, mockupCostas: true },
    });
    for (const lado of ['mockupFrente', 'mockupCostas'] as const) {
      if (dto[lado] === undefined) continue;
      const novo = ProdutosService.mockupOuNulo(dto[lado]);
      data[lado] = novo ? await this.arquivos.guardar(novo, 'mockups') : null;
      const velho = antigo?.[lado] ?? null;
      if (velho && velho !== data[lado]) await this.arquivos.remover(velho);
    }
    try {
      const cor = await this.prisma.produtoCor.update({
        where: { id: corId },
        data,
        select: { id: true, nome: true, hex: true, ordem: true },
      });
      if (dto.nome !== undefined || dto.ordem !== undefined) await this.espelharCorTexto(produtoId);
      return cor;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('O produto já tem outra cor com esse nome.');
      }
      throw e;
    }
  }

  /** Só aceita imagem em data URI. Qualquer outra coisa vira nulo em vez de ir
   *  para o banco e quebrar na hora de desenhar o PDF. */
  private static mockupOuNulo(v: string | null | undefined): string | null {
    const s = String(v ?? '').trim();
    return s.startsWith('data:image') ? s : null;
  }

  async removerCor(produtoId: number, corId: number, empresaId: number) {
    await this.produtoDaEmpresa(produtoId, empresaId);
    const cor = await this.prisma.produtoCor.findUnique({
      where: { id: corId },
      select: { produtoId: true, nome: true, mockupFrente: true, mockupCostas: true },
    });
    if (!cor || cor.produtoId !== produtoId) {
      throw new NotFoundException(`Cor ${corId} não é deste produto.`);
    }
    // Some a cor, somem os mockups dela do bucket.
    await this.arquivos.remover(cor.mockupFrente);
    await this.arquivos.remover(cor.mockupCostas);
    // Pedido já feito naquela cor continua valendo: o item guarda o texto da cor,
    // então só soltamos o vínculo em vez de apagar o histórico.
    await this.prisma.pedidoItem.updateMany({ where: { produtoCorId: corId }, data: { produtoCorId: null } });
    await this.prisma.produtoCor.delete({ where: { id: corId } });
    const texto = await this.espelharCorTexto(produtoId);
    return { ok: true, cor: cor.nome, corTexto: texto };
  }

  /**
   * Mockups de VÁRIAS cores, em lote — mesma razão das fotos do catálogo: são
   * base64 de ~100 KB e não cabem na lista de produtos.
   */
  async mockups(ids: number[], empresaId: number): Promise<Record<number, string | null>> {
    const limpos = [...new Set((ids ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
      .slice(0, ProdutosService.FOTOS_POR_LOTE);
    if (!limpos.length) return {};
    const rows = await this.prisma.produtoCor.findMany({
      where: { id: { in: limpos }, produto: { empresaId } },
      select: { id: true, mockupFrente: true },
    });
    const out: Record<number, string | null> = {};
    for (const id of limpos) out[id] = null;
    for (const r of rows) out[r.id] = this.imagemParaTela(r.mockupFrente);
    return out;
  }

  async findAll(empresaId: number) {
    // Omite os campos base64 pesados (foto/arquivo) — a lista não precisa deles
    // e isso mantém o payload leve. Eles voltam no findOne (edição).
    const produtos = await this.prisma.produto.findMany({
      where: { empresaId },
      omit: { fotoModelo: true, fotoModelagem: true, arquivoModelagem: true, logoVetor: true, logosVetor: true, fichaCliente: true },
      // As cores vêm junto (sem os mockups, que são base64): o item do pedido
      // precisa do id da cor para guardar qual foi escolhida, e são ~250 linhas
      // no total — não pesa como as imagens.
      include: { cores: { select: { id: true, nome: true, hex: true, ordem: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] } },
      orderBy: { codigo: 'asc' },
    });
    // Rendimento: quantas peças o estoque de material rende (limitado pelo material
    // mais escasso da receita). Tecido principal = o material de maior consumo.
    const consumos = await this.prisma.consumo.findMany({
      where: { produto: { empresaId } },
      include: { material: { select: { descricao: true, saldo: true, unidade: true } } },
    });
    const porProd = new Map<number, { rende: number | null; tecido: string | null; maiorQtd: number; consumoMedio: number | null; unidade: string | null }>();
    for (const c of consumos) {
      const q = Number(c.quantidade);
      // Receita por FAMÍLIA não tem saldo próprio: a cor (e o saldo) só se define no
      // pedido. Entra na lista pelo nome da família, sem estimar rendimento.
      if (!c.material) {
        const cur = porProd.get(c.produtoId) ?? { rende: null, tecido: null, maiorQtd: -1, consumoMedio: null, unidade: null };
        if (q > cur.maiorQtd) { cur.maiorQtd = q; cur.tecido = c.familia; cur.consumoMedio = q > 0 ? q : null; cur.unidade = c.unidade; }
        porProd.set(c.produtoId, cur);
        continue;
      }
      const saldo = Number(c.material.saldo);
      // Estimativa REAL do rendimento: se há consumo por tamanho cadastrado, usa a
      // MÉDIA por tamanho (a peça média), não o consumo fixo (que costuma ser o do
      // maior tamanho e subestima quantas peças o estoque rende).
      const qEstim = this.consumoEstimado(c.porTamanho, q);
      const rende = qEstim > 0 ? Math.floor(saldo / qEstim) : null;
      const cur = porProd.get(c.produtoId) ?? { rende: null, tecido: null, maiorQtd: -1, consumoMedio: null, unidade: null };
      if (rende != null) cur.rende = cur.rende == null ? rende : Math.min(cur.rende, rende);
      // Guarda o consumo médio/unidade do tecido principal (maior consumo).
      if (q > cur.maiorQtd) { cur.maiorQtd = q; cur.tecido = c.material.descricao; cur.consumoMedio = qEstim > 0 ? qEstim : null; cur.unidade = c.material.unidade; }
      porProd.set(c.produtoId, cur);
    }
    return produtos.map((p) => {
      const r = porProd.get(p.id);
      return {
        ...p,
        rendePecas: r?.rende ?? null,
        tecidoPrincipal: r?.tecido ?? null,
        consumoMedio: r?.consumoMedio != null ? Number(r.consumoMedio.toFixed(2)) : null,
        consumoUnidade: r?.unidade ?? null,
      };
    });
  }

  /** Consumo médio por peça para estimar o rendimento: média dos valores de
   *  consumo por tamanho (quando cadastrados); senão, o consumo fixo. */
  private consumoEstimado(porTamanho: unknown, fixo: number): number {
    if (porTamanho && typeof porTamanho === 'object') {
      const vals = Object.values(porTamanho as Record<string, unknown>)
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (vals.length) return vals.reduce((s, n) => s + n, 0) / vals.length;
    }
    return fixo;
  }

  async findOne(id: number, empresaId: number) {
    const produto = await this.prisma.produto.findUnique({
      where: { id },
      include: { medidas: { orderBy: { ordem: 'asc' } } },
    });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${id} não encontrado.`);
    }
    // `fotoModelo`/`fotoModelagem` saem como estão (data URI ou `arq:…`), porque
    // o formulário devolve esse mesmo valor no save. O link de exibição vai em
    // campo separado — a tela usa um para mostrar e o outro para gravar.
    return {
      ...produto,
      fotoModeloUrl: this.arquivos.url(produto.fotoModelo),
      fotoModelagemUrl: this.arquivos.url(produto.fotoModelagem),
      mapaDtfUrl: this.arquivos.url(produto.mapaDtf),
      fichaClienteUrl: this.arquivos.url(produto.fichaCliente),
      arquivoModelagemUrl: this.arquivos.url(produto.arquivoModelagem),
      // Cada logo leva o seu link; o `data` continua sendo o que volta no save.
      logosVetor: ((produto.logosVetor ?? []) as Array<{ data?: string; nome?: string }>)
        .map((l) => ({ ...l, url: this.arquivos.url(l?.data) })),
    };
  }

  async create(dto: CreateProdutoDto, empresaId: number): Promise<Produto> {
    const codigo = dto.codigo?.trim() || (await this.gerarCodigo(dto.categoria, empresaId));
    // Fora da transação de propósito: subir imagem é rede, e o Neon derruba
    // transação que fica esperando (P2028).
    await this.anexosParaBucket(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const produto = await tx.produto.create({
          data: {
            empresaId,
            codigo,
            categoria: dto.categoria,
            descricao: dto.descricao,
            cor: dto.cor,
            grade: dto.grade,
            precoBase: dto.precoBase,
            precoEspecial: dto.precoEspecial,
            tamsEspeciais: dto.tamsEspeciais,
            clienteGrupo: dto.clienteGrupo,
            clienteId: dto.clienteId,
            setor: dto.setor,
            custo: dto.custo,
            tipo: dto.tipo,
            componentes: (dto.componentes ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            aplicacoes: (dto.aplicacoes ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            ...this.dadosFicha(dto),
            ...this.dadosPeso(dto),
            ...this.dadosFiscais(dto),
            medidas: dto.medidas?.length ? { create: this.medidasCreate(dto.medidas) } : undefined,
          },
        });
        await this.upsertTecidoBom(tx, produto.id, dto);
        return produto;
      }, { maxWait: 15_000, timeout: 30_000 });
    } catch (err) {
      throw this.tratarErroUnico(err, codigo);
    }
  }

  /** Vincula o tecido homologado (material) à receita BOM do produto — 1 linha
   *  por material. A OP usa a receita p/ baixar o saldo automaticamente. */
  private async upsertTecidoBom(
    tx: Prisma.TransactionClient,
    produtoId: number,
    dto: CreateProdutoDto | UpdateProdutoDto,
  ) {
    // RECEITA COMPLETA (lista): substitui tudo o que havia. É o caminho do conjunto —
    // um tecido para a blusa, outro para a calça, cada um com a sua grade.
    if (Array.isArray(dto.composicaoMateriais)) {
      const limpaPorTam = (pt?: Record<string, number>) => {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(pt ?? {})) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) out[String(k).toUpperCase()] = n;
        }
        return out;
      };
      const linhas = dto.composicaoMateriais
        .filter((l) => (l.materialId || (l.familia ?? '').trim()) && Number(l.quantidade) > 0)
        .map((l) => ({
          produtoId,
          materialId: l.materialId ?? null,
          familia: l.materialId ? null : (l.familia ?? '').trim().toUpperCase() || null,
          parte: (l.parte ?? '').trim().toUpperCase() || null,
          quantidade: new Prisma.Decimal(Number(l.quantidade).toFixed(4)),
          unidade: (l.unidade || 'm').slice(0, 8),
          porTamanho: limpaPorTam(l.porTamanho) as Prisma.InputJsonValue,
        }));
      await tx.consumo.deleteMany({ where: { produtoId } });
      if (linhas.length) await tx.consumo.createMany({ data: linhas });
      return;
    }
    if (!dto.tecidoMaterialId || !(Number(dto.tecidoConsumo) > 0)) return;
    const materialId = dto.tecidoMaterialId;
    const quantidade = new Prisma.Decimal(Number(dto.tecidoConsumo).toFixed(4));
    const unidade = (dto.tecidoUnidade || 'm').slice(0, 8);
    // Consumo por tamanho (opcional): mantém só os tamanhos com valor > 0.
    let porTamanho: Prisma.InputJsonValue | undefined;
    if (dto.tecidoConsumoPorTamanho && typeof dto.tecidoConsumoPorTamanho === 'object') {
      const limpo: Record<string, number> = {};
      for (const [k, v] of Object.entries(dto.tecidoConsumoPorTamanho)) {
        const n = Number(v);
        if (k && Number.isFinite(n) && n > 0) limpo[String(k).toUpperCase()] = n;
      }
      porTamanho = Object.keys(limpo).length ? limpo : ({} as Prisma.InputJsonValue);
    }
    const existente = await tx.consumo.findFirst({ where: { produtoId, materialId } });
    if (existente) {
      await tx.consumo.update({ where: { id: existente.id }, data: { quantidade, unidade, ...(porTamanho !== undefined ? { porTamanho } : {}) } });
    } else {
      await tx.consumo.create({ data: { produtoId, materialId, quantidade, unidade, ...(porTamanho !== undefined ? { porTamanho } : {}) } });
    }
  }

  async update(id: number, dto: UpdateProdutoDto, empresaId: number): Promise<Produto> {
    const antes = await this.findOne(id, empresaId);
    await this.anexosParaBucket(dto, antes);
    return this.prisma.$transaction(async (tx) => {
      const produto = await tx.produto.update({
        where: { id },
        data: {
          categoria: dto.categoria,
          descricao: dto.descricao,
          cor: dto.cor,
          grade: dto.grade,
          precoBase: dto.precoBase,
          precoEspecial: dto.precoEspecial,
          tamsEspeciais: dto.tamsEspeciais,
          clienteGrupo: dto.clienteGrupo,
          clienteId: dto.clienteId,
          setor: dto.setor,
          custo: dto.custo,
          tipo: dto.tipo,
          componentes:
            dto.componentes === undefined
              ? undefined
              : (dto.componentes as unknown as Prisma.InputJsonValue),
          aplicacoes:
            dto.aplicacoes === undefined
              ? undefined
              : (dto.aplicacoes as unknown as Prisma.InputJsonValue),
          ...this.dadosFicha(dto),
          ...this.dadosPeso(dto),
          ...this.dadosFiscais(dto),
        },
      });
      // Tabela de medidas: se veio no payload, substitui integralmente.
      if (dto.medidas !== undefined) {
        await tx.produtoMedida.deleteMany({ where: { produtoId: id } });
        if (dto.medidas.length) {
          await tx.produtoMedida.createMany({
            data: this.medidasCreate(dto.medidas).map((m) => ({ ...m, produtoId: id })),
          });
        }
      }
      await this.upsertTecidoBom(tx, id, dto);
      return produto;
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  /** Normaliza as linhas da tabela de medidas para gravação (ordem sequencial). */
  private medidasCreate(medidas: CreateProdutoDto['medidas']) {
    return (medidas ?? [])
      .filter((m) => m.descricao?.trim())
      .map((m, i) => ({
        ordem: m.ordem ?? i,
        descricao: m.descricao.trim(),
        tolerancia: m.tolerancia?.trim() || null,
        valores: (m.valores ?? {}) as Prisma.InputJsonValue,
      }));
  }

  /** Peso e embalagem do produto (p/ cálculo de peso/volumes no pedido/NF). */
  private dadosPeso(dto: CreateProdutoDto | UpdateProdutoDto) {
    let pesoPorTamanho: Prisma.InputJsonValue | undefined;
    if (dto.pesoPorTamanho && typeof dto.pesoPorTamanho === 'object') {
      const limpo: Record<string, number> = {};
      for (const [k, v] of Object.entries(dto.pesoPorTamanho)) {
        const n = Number(v);
        if (k && Number.isFinite(n) && n > 0) limpo[String(k).toUpperCase()] = n;
      }
      pesoPorTamanho = limpo as Prisma.InputJsonValue;
    }
    // Código do cliente por tamanho (VIVARA etc.): { "36":"MC0400054", ... } — valores são texto.
    let codigosPorTamanho: Prisma.InputJsonValue | undefined;
    if (dto.codigosPorTamanho && typeof dto.codigosPorTamanho === 'object') {
      const limpo: Record<string, string> = {};
      for (const [k, v] of Object.entries(dto.codigosPorTamanho)) {
        const cod = String(v ?? '').trim();
        if (k && cod) limpo[String(k).toUpperCase()] = cod;
      }
      codigosPorTamanho = limpo as Prisma.InputJsonValue;
    }
    return {
      pesoUnitario: dto.pesoUnitario != null ? new Prisma.Decimal(Number(dto.pesoUnitario).toFixed(3)) : dto.pesoUnitario === null ? null : undefined,
      ...(pesoPorTamanho !== undefined ? { pesoPorTamanho } : {}),
      ...(codigosPorTamanho !== undefined ? { codigosPorTamanho } : {}),
      caixaId: dto.caixaId ?? undefined,
      pecasPorCaixa: dto.pecasPorCaixa ?? undefined,
      fardoId: dto.fardoId ?? undefined,
      pecasPorFardo: dto.pecasPorFardo ?? undefined,
      // Produto equivalente (expedição): null limpa, número seta, ausente mantém.
      equivalenteId: dto.equivalenteId === null ? null : (dto.equivalenteId ?? undefined),
    };
  }

  /** Extrai os campos descritivos da ficha técnica presentes no DTO. */
  /** Quantos logos vetorizados cabem num produto, e o tamanho de cada um. */
  private static readonly LOGOS_MAX = 8;
  private static readonly LOGO_MAX_BYTES = 4 * 1024 * 1024; // ~4 MB por arquivo
  private static readonly LOGOS_TOTAL_BYTES = 14 * 1024 * 1024; // teto da linha inteira

  /**
   * Normaliza a lista de logos vetorizados. São base64 dentro da linha do produto,
   * então há limite: sem teto, um punhado de .ai de 9 MB estoura a linha no Postgres
   * e deixa o findOne do produto lento para todo mundo.
   * Mantém `logoVetor`/`logoVetorNome` (campos antigos) apontando para o primeiro.
   */
  private dadosLogos(dto: CreateProdutoDto | UpdateProdutoDto) {
    if (dto.logosVetor === undefined) {
      // Lista não veio: respeita o campo antigo, se ele veio.
      return dto.logoVetor === undefined ? {} : { logoVetor: dto.logoVetor, logoVetorNome: dto.logoVetorNome };
    }
    const lista = (dto.logosVetor ?? [])
      .filter((l) => typeof l?.data === 'string' && l.data.trim())
      .map((l) => ({ nome: String(l.nome ?? 'logo').slice(0, 200), data: String(l.data) }));

    if (lista.length > ProdutosService.LOGOS_MAX) {
      throw new BadRequestException(`Máximo de ${ProdutosService.LOGOS_MAX} logos por produto (enviados: ${lista.length}).`);
    }
    const grande = lista.find((l) => l.data.length > ProdutosService.LOGO_MAX_BYTES);
    if (grande) {
      throw new BadRequestException(`O logo "${grande.nome}" é grande demais (máx. ~4 MB por arquivo).`);
    }
    const total = lista.reduce((s, l) => s + l.data.length, 0);
    if (total > ProdutosService.LOGOS_TOTAL_BYTES) {
      throw new BadRequestException(`Os logos somam ${(total / 1024 / 1024).toFixed(1)} MB — o limite do produto é 14 MB. Remova algum ou mande em resolução menor.`);
    }
    return {
      logosVetor: lista as unknown as Prisma.InputJsonValue,
      logoVetor: lista[0]?.data ?? null,
      logoVetorNome: lista[0]?.nome ?? null,
    };
  }

  /**
   * Sobe para o bucket os anexos que vieram como data URI e deixa intactos os
   * que já são referência.
   *
   * O formulário devolve no PATCH o mesmo valor que recebeu no GET. Por isso o
   * `findOne` entrega a REFERÊNCIA crua (e o link de exibição num campo à
   * parte): se devolvesse o link, o save gravaria o link por cima da
   * referência e a foto se perderia.
   */
  private async anexosParaBucket(
    dto: CreateProdutoDto | UpdateProdutoDto,
    anterior?: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.arquivos.ligado) return;
    // mapaDtf entra aqui porque é o anexo mais pesado do produto (há mapas de
    // 2,5 MB): deixá-lo fora fazia a coluna voltar a encher sozinha a cada
    // produto novo, mesmo depois de migrada.
    // Pasta por tipo de anexo, para o balde ficar legível. Ficha do cliente e
    // arquivo de modelagem NÃO são imagem (PDF, .adsx, .zip), por isso o teste
    // é `data:` e não `data:image` — com o teste antigo eles nunca subiriam.
    const PASTAS: Record<string, string> = {
      fotoModelo: 'produtos',
      fotoModelagem: 'modelagens',
      mapaDtf: 'mapas',
      fichaCliente: 'fichas-cliente',
      arquivoModelagem: 'modelagens',
    };
    for (const campo of ['fotoModelo', 'fotoModelagem', 'mapaDtf', 'fichaCliente', 'arquivoModelagem'] as const) {
      const v = dto[campo];
      if (v === undefined) continue;
      const s = String(v ?? '').trim();
      if (ArquivosService.ehReferencia(s)) continue; // já está lá, nada a fazer
      const velho = (anterior?.[campo] ?? null) as string | null;
      if (s.startsWith('data:')) {
        dto[campo] = await this.arquivos.guardar(s, PASTAS[campo]);
        if (velho && velho !== dto[campo]) await this.arquivos.remover(velho);
      } else if (!s && velho) {
        await this.arquivos.remover(velho); // campo limpo: tira do bucket também
      }
    }
    await this.logosParaBucket(dto, anterior);
  }

  /**
   * Logos vetorizados: lista Json `[{data,nome}]`, então o anexo fica dentro do
   * Json e não numa coluna própria. Cada item vira `arq:…` do mesmo jeito.
   */
  private async logosParaBucket(
    dto: CreateProdutoDto | UpdateProdutoDto,
    anterior?: Record<string, unknown> | null,
  ): Promise<void> {
    if (dto.logosVetor === undefined) return;
    const lista = (dto.logosVetor ?? []) as Array<{ data?: string; nome?: string }>;
    const antes = new Set(
      ((anterior?.logosVetor ?? []) as Array<{ data?: string }>)
        .map((l) => String(l?.data ?? ''))
        .filter((d) => ArquivosService.ehReferencia(d)),
    );
    for (const item of lista) {
      const s = String(item?.data ?? '').trim();
      if (!s || ArquivosService.ehReferencia(s)) { antes.delete(s); continue; }
      if (s.startsWith('data:')) item.data = await this.arquivos.guardar(s, 'logos');
    }
    // O que estava na lista e saiu dela não serve mais a ninguém.
    for (const orfao of antes) await this.arquivos.remover(orfao);
  }

  private dadosFicha(dto: CreateProdutoDto | UpdateProdutoDto) {
    return {
      referencia: dto.referencia,
      fornecedorId: dto.fornecedorId,
      codigoFornecedor: dto.codigoFornecedor,
      descricaoFornecedor: dto.descricaoFornecedor,
      marca: dto.marca,
      linha: dto.linha,
      grupo: dto.grupo,
      modelagem: dto.modelagem,
      tecido: dto.tecido,
      composicao: dto.composicao,
      especificacoes: dto.especificacoes,
      observacoes: dto.observacoes,
      fotoModelo: dto.fotoModelo,
      fotoModelagem: dto.fotoModelagem,
      arquivoModelagem: dto.arquivoModelagem,
      arquivoModelagemNome: dto.arquivoModelagemNome,
      ...this.dadosLogos(dto),
      fichaCliente: dto.fichaCliente,
      fichaClienteNome: dto.fichaClienteNome,
      mapaDtf: dto.mapaDtf,
      mapaDtfNome: dto.mapaDtfNome,
      projeto: dto.projeto,
      revisao: dto.revisao,
      detalhes: dto.detalhes,
    };
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    await this.findOne(id, empresaId);
    const [bom, estoque, itens] = await Promise.all([
      this.prisma.consumo.count({ where: { produtoId: id } }),
      this.prisma.estoque.count({ where: { produtoId: id } }),
      this.prisma.pedidoItem.count({ where: { produtoId: id } }),
    ]);
    const b: string[] = [];
    if (bom) b.push(`${bom} item(ns) de ficha técnica`);
    if (estoque) b.push(`${estoque} registro(s) de estoque`);
    if (itens) b.push(`${itens} item(ns) de pedido`);
    if (b.length) throw new ConflictException(`Não é possível excluir: produto vinculado a ${b.join(', ')}.`);
    await this.prisma.produto.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Extrai apenas os campos fiscais presentes no DTO (para create/update). */
  private dadosFiscais(dto: CreateProdutoDto | UpdateProdutoDto) {
    return {
      ncm: dto.ncm,
      cfop: dto.cfop,
      origem: dto.origem,
      unidadeComercial: dto.unidadeComercial,
      cest: dto.cest,
      icmsCst: dto.icmsCst,
      pisCst: dto.pisCst,
      cofinsCst: dto.cofinsCst,
      icmsAliquota: dto.icmsAliquota,
    };
  }

  /**
   * Ficha de custo do produto: BOM (Consumo) × custo unitário do material.
   * Base da precificação — a margem/impostos são aplicados pelo cliente da API.
   */
  async custo(id: number, empresaId: number) {
    const produto = await this.findOne(id, empresaId);
    const bom = await this.prisma.consumo.findMany({
      where: { produtoId: id },
      include: {
        material: { select: { codigo: true, descricao: true, unidade: true, custo: true } },
      },
    });
    let custoMaterial = new Prisma.Decimal(0);
    const itens = bom.map((b) => {
      // Família sem material fixo: usa o custo MÉDIO das cores dessa família, senão
      // o custo do produto sairia menor do que é só porque a cor não foi escolhida.
      const custoUnit = b.material?.custo ?? new Prisma.Decimal(0);
      const subtotal = b.quantidade.mul(custoUnit);
      custoMaterial = custoMaterial.plus(subtotal);
      return {
        material: b.material?.codigo ?? '—',
        descricao: b.material?.descricao ?? (b.familia ? `${b.familia} (família — cor do pedido)` : '—'),
        quantidade: b.quantidade.toFixed(4),
        unidade: b.unidade,
        custoUnit: custoUnit.toFixed(2),
        subtotal: subtotal.toFixed(2),
      };
    });
    return {
      produto: { id: produto.id, codigo: produto.codigo, descricao: produto.descricao },
      precoBase: produto.precoBase ? produto.precoBase.toFixed(2) : null,
      itens,
      custoMaterial: custoMaterial.toFixed(2),
    };
  }

  /** Gera o próximo código PRD-CAT-0000 para a categoria informada. */
  private async gerarCodigo(categoria: string, empresaId: number): Promise<string> {
    const existentes = await this.prisma.produto.findMany({
      where: { empresaId },
      select: { codigo: true },
    });
    return proximoCodigo('PRD', categoria, existentes.map((p) => p.codigo));
  }

  private tratarErroUnico(err: unknown, codigo: string): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`Já existe um produto com o código "${codigo}".`);
    }
    return err as Error;
  }
}
