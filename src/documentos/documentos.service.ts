import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Documento, Prisma, Produto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthUser } from '../auth/auth.types';
import { Area, perfilPodeAcessar } from '../common/rbac/acesso.config';
import { proximoSequencial } from '../common/utils/codigo.util';
import {
  Pdf,
  assinaturas,
  camposDuplos,
  dataBR,
  gradeTabela,
  imagem,
  itemPedido,
  money,
  novaEtiqueta,
  novoDocumento,
  rodapeGrupo,
  secao,
  tabela,
  tabelaMedidas,
  textoBloco,
  totalDestaque,
} from './pdf.renderer';

/** Tipos suportados nesta fase, com prefixo de numeração e área(s) RBAC exigida(s). */
const TIPOS: Record<string, { titulo: string; prefixo: string; area: Area | Area[] }> = {
  proposta: { titulo: 'Proposta Comercial', prefixo: 'PROP', area: 'vendas' },
  pedido: { titulo: 'Pedido de Venda', prefixo: 'PVD', area: 'vendas' },
  op: { titulo: 'Ordem de Produção', prefixo: 'OPD', area: 'producao' },
  plano_corte: { titulo: 'Plano de Corte', prefixo: 'PCT', area: 'producao' },
  pedido_compra: { titulo: 'Pedido de Compra', prefixo: 'OCD', area: 'compras' },
  romaneio: { titulo: 'Romaneio de Expedição', prefixo: 'ROM', area: 'expedicao' },
  ficha_medidas: { titulo: 'Ficha de Medidas', prefixo: 'MED', area: 'medidas' },
  // Ficha técnica do produto: pode ser emitida por produção (cadastros) e comercial (vendas).
  ficha_tecnica: { titulo: 'Ficha Técnica', prefixo: 'FT', area: ['cadastros', 'vendas'] },
  etiqueta: { titulo: 'Etiqueta de Lote', prefixo: 'ETQ', area: 'estoque' },
};

@Injectable()
export class DocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  listar(): Promise<Documento[]> {
    return this.prisma.documento.findMany({ orderBy: { id: 'desc' }, take: 200 });
  }

  /** Registra o documento e devolve a URL do PDF (gerado sob demanda no GET). */
  async criar(tipo: string, referenciaId: number, user: AuthUser) {
    const def = this.validarTipo(tipo, user);
    await this.validarEstadoReferencia(tipo, referenciaId, user.empresaId);
    // Garante que a referência existe (e pertence à empresa) antes de registrar.
    await this.montarPdf(tipo, referenciaId, user.empresaId, 'PREVIA');

    // Rastreabilidade: reaproveita o documento já existente da MESMA referência
    // (não cria número novo a cada geração de PDF).
    const jaExiste = await this.prisma.documento.findFirst({ where: { tipo, referencia: String(referenciaId) }, orderBy: { id: 'asc' } });
    if (jaExiste) {
      const urlPdf = jaExiste.urlPdf ?? `/api/v1/documentos/${jaExiste.id}/pdf`;
      return { id: jaExiste.id, tipo, numero: jaExiste.numero, referencia: referenciaId, urlPdf };
    }

    // Nº do documento: pedido/proposta usam o NÚMERO REAL do pedido (ex.: PV01)
    // para manter a rastreabilidade; os demais tipos seguem sua numeração própria.
    let numero: string;
    if (tipo === 'pedido' || tipo === 'proposta') {
      const pedido = await this.prisma.pedido.findUnique({ where: { id: referenciaId }, select: { numero: true } });
      numero = pedido?.numero ?? String(referenciaId);
    } else {
      const existentes = await this.prisma.documento.findMany({ where: { tipo }, select: { numero: true } });
      numero = proximoSequencial(def.prefixo, existentes.map((d) => d.numero), { pad: 4, separador: '-' });
    }

    const documento = await this.prisma.documento.create({
      data: {
        tipo,
        referencia: String(referenciaId),
        numero,
        geradoPor: user.usuario,
      },
    });
    const urlPdf = `/api/v1/documentos/${documento.id}/pdf`;
    await this.prisma.documento.update({ where: { id: documento.id }, data: { urlPdf } });
    return { id: documento.id, tipo, numero, referencia: referenciaId, urlPdf };
  }

  /** Regenera o PDF do documento registrado (armazenamento sob demanda; S3 na Fase 4). */
  async gerarPdf(id: number, user: AuthUser): Promise<{ doc: Pdf; numero: string }> {
    const documento = await this.prisma.documento.findUnique({ where: { id } });
    if (!documento) throw new NotFoundException(`Documento ${id} não encontrado.`);
    this.validarTipo(documento.tipo, user);
    const doc = await this.montarPdf(
      documento.tipo,
      Number(documento.referencia),
      user.empresaId,
      documento.numero,
    );
    return { doc, numero: documento.numero };
  }

  /** Envia o documento por e-mail com o PDF anexo (Fase 4 · integração e-mail). */
  async enviarPorEmail(
    id: number,
    user: AuthUser,
    para: string,
    assunto?: string,
    mensagem?: string,
  ) {
    const documento = await this.prisma.documento.findUnique({ where: { id } });
    if (!documento) throw new NotFoundException(`Documento ${id} não encontrado.`);
    const def = this.validarTipo(documento.tipo, user);

    const { doc, numero } = await this.gerarPdf(id, user);
    const pdf = await this.pdfParaBuffer(doc);

    const resultado = await this.email.enviar({
      para,
      assunto: assunto || `${def.titulo} ${numero} — GRUPO CHERKESIAN`,
      texto:
        (mensagem ? mensagem + '\n\n' : '') +
        `Segue em anexo o documento ${numero} (${def.titulo}).\n\n` +
        'GRUPO CHERKESIAN · Uniformes Profissionais\n"Vestindo quem faz acontecer"',
      anexos: [{ filename: `${numero}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    return { documento: numero, para, ...resultado };
  }

  private pdfParaBuffer(doc: Pdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  /**
   * Regras de negócio por etapa (verdade no backend):
   * proposta pertence à fase de ORÇAMENTO; o documento "pedido" só existe
   * após a aprovação do cliente. Reimpressão de documentos já emitidos
   * (GET /:id/pdf) não passa por aqui — histórico continua acessível.
   */
  private async validarEstadoReferencia(
    tipo: string,
    referenciaId: number,
    empresaId: number,
  ): Promise<void> {
    if (tipo !== 'proposta' && tipo !== 'pedido') return;
    const pedido = await this.prisma.pedido.findUnique({ where: { id: referenciaId } });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${referenciaId} não encontrado.`);
    }
    if (tipo === 'proposta' && pedido.etapa !== 'orcamento') {
      throw new BadRequestException(
        `Proposta comercial é emitida na fase de orçamento. O ${pedido.numero} já foi aprovado ` +
          `(etapa: ${pedido.etapa}) — emita o documento "pedido".`,
      );
    }
    if (tipo === 'pedido' && pedido.etapa === 'orcamento') {
      throw new BadRequestException(
        `O documento "pedido" é emitido após a aprovação do orçamento. ` +
          `O ${pedido.numero} ainda está em orçamento — emita a "proposta".`,
      );
    }
  }

  private validarTipo(tipo: string, user: AuthUser) {
    const def = TIPOS[tipo];
    if (!def) {
      throw new BadRequestException(
        `Tipo "${tipo}" não suportado. Disponíveis: ${Object.keys(TIPOS).join(', ')}.`,
      );
    }
    const areas = Array.isArray(def.area) ? def.area : [def.area];
    if (!areas.some((a) => perfilPodeAcessar(user.acesso, a))) {
      throw new ForbiddenException(`Perfil "${user.acesso}" não pode emitir "${tipo}".`);
    }
    return def;
  }

  // ===== Montagem por tipo =====

  private async montarPdf(
    tipo: string,
    referenciaId: number,
    empresaId: number,
    numero: string,
  ): Promise<Pdf> {
    switch (tipo) {
      case 'proposta':
      case 'pedido':
        return this.pdfPedido(tipo, referenciaId, empresaId, numero);
      case 'op':
        return this.pdfOp(referenciaId, empresaId, numero);
      case 'plano_corte':
        return this.pdfPlanoCorte(referenciaId, empresaId, numero);
      case 'pedido_compra':
        return this.pdfCompra(referenciaId, empresaId, numero);
      case 'romaneio':
        return this.pdfRomaneio(referenciaId, empresaId, numero);
      case 'ficha_medidas':
        return this.pdfMedidas(referenciaId, empresaId, numero);
      case 'ficha_tecnica':
        return this.pdfFichaTecnica(referenciaId, empresaId, numero);
      case 'etiqueta':
        return this.pdfEtiqueta(referenciaId, empresaId, numero);
      default:
        throw new BadRequestException(`Tipo "${tipo}" não suportado.`);
    }
  }

  private async pdfPedido(tipo: string, pedidoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { itens: true, cliente: true, filial: true },
    });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    }
    // Mapa de produtos dos itens (p/ aplicar faixas de preço por tamanho no PDF).
    const prodIds = [...new Set(pedido.itens.map((i) => i.produtoId).filter((x): x is number => x != null))];
    const prodsArr = prodIds.length
      ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } } })
      : [];
    const prodMap = new Map<number, Produto>(prodsArr.map((p) => [p.id, p]));
    const titulo = tipo === 'proposta' ? 'Proposta Comercial' : 'Pedido de Venda';
    const doc = novoDocumento(titulo, numero);

    secao(doc, 'Cliente');
    camposDuplos(doc, [
      ['Razão social / nome', pedido.cliente.nome],
      ['CNPJ/CPF', pedido.cliente.cnpjCpf ?? '—'],
      ['Contato', pedido.cliente.contato ?? pedido.cliente.telefone ?? '—'],
      ['Cidade/UF', pedido.cliente.cidadeUf ?? '—'],
    ]);

    // Forma de pagamento + vencimento (converte "19" em data; ignora "50%").
    const pag = this.pagamentoInfo(pedido.formaPagamento, pedido.data ? new Date(pedido.data) : new Date());

    secao(doc, 'Dados do pedido');
    camposDuplos(doc, [
      ['Número do pedido', pedido.numero],
      ['Data', dataBR(pedido.data)],
      ['Forma de pagamento', pag.texto],
      ['Vencimento', pag.vencimentos],
      ['Etapa atual', pedido.etapa],
    ]);

    secao(doc, 'Itens · grade de tamanhos');
    pedido.itens.forEach((i, idx) => {
      const grade = i.grade as Record<string, number> | null;
      const base = i.valorUnit;
      // Linhas por tamanho, cada uma com o preço da sua faixa (especial p/ tamanhos grandes).
      const linhas =
        grade && Object.keys(grade).length
          ? Object.entries(grade)
              .filter(([, q]) => Number(q) > 0)
              .map(([tam, q]) => {
                const unit = this.precoTamanho(i.produtoId ? prodMap.get(i.produtoId) ?? null : null, base,tam);
                const qtd = Number(q) || 0;
                return { tam, qtd, unit: money(unit), total: money(unit.mul(qtd)) };
              })
          : [{ tam: '—', qtd: i.quantidade, unit: money(base), total: money(base.mul(i.quantidade)) }];
      const subtotal = linhas.reduce(
        (s, l) => s.plus(this.precoTamanho(i.produtoId ? prodMap.get(i.produtoId) ?? null : null, base,l.tam).mul(l.qtd)),
        new Prisma.Decimal(0),
      );
      const prod = i.produtoId ? prodMap.get(i.produtoId) ?? null : null;
      itemPedido(doc, {
        num: String(idx + 1).padStart(2, '0'),
        descricao: i.descricao,
        cor: i.cor ?? prod?.cor ?? null,
        foto: prod?.fotoModelo ?? null,
        linhas,
        subtotal: money(subtotal),
      });
    });
    totalDestaque(doc, 'Valor total', money(pedido.valorTotal));

    // Condições comerciais (pagamento, frete, prazo, validade).
    // Mantém o bloco junto: se não couber no restante da página, começa em nova.
    if (doc.y > doc.page.height - 230) doc.addPage();
    secao(doc, 'Condições comerciais');
    const prazoTxt = pedido.prazoEntrega ? dataBR(pedido.prazoEntrega) : 'a combinar';
    camposDuplos(doc, [
      ['Forma de pagamento', pag.texto],
      ['Frete', pedido.frete ?? 'a combinar'],
      ['Prazo de entrega', prazoTxt],
      ['Validade da proposta', tipo === 'proposta' ? '15 dias' : '—'],
    ]);
    if (tipo === 'proposta') {
      textoBloco(doc, 'Cliente novo: produção liberada após aprovação da peça-piloto.');
    }

    // Dados bancários para pagamento (da filial emissora).
    if (pedido.filial?.dadosBancarios?.trim()) {
      secao(doc, 'Dados bancários para pagamento');
      textoBloco(doc, pedido.filial.dadosBancarios);
    }

    if (tipo === 'proposta') {
      assinaturas(doc, 'GRUPO CHERKESIAN', pedido.cliente.nome);
    } else {
      assinaturas(doc, 'GRUPO CHERKESIAN', `${pedido.cliente.nome} — De acordo`);
    }
    rodapeGrupo(doc);
    return doc;
  }

  private async pdfOp(opId: number, empresaId: number, numero: string): Promise<Pdf> {
    const op = await this.prisma.oP.findUnique({
      where: { id: opId },
      include: { pedido: { include: { cliente: true } } },
    });
    if (!op || op.pedido?.empresaId !== empresaId) {
      throw new NotFoundException(`OP ${opId} não encontrada.`);
    }
    const produto = op.produtoId
      ? await this.prisma.produto.findUnique({ where: { id: op.produtoId } })
      : null;
    const bom = op.produtoId
      ? await this.prisma.consumo.findMany({
          where: { produtoId: op.produtoId },
          include: { material: true },
        })
      : [];

    const doc = novoDocumento('Ordem de Produção', numero);
    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Ordem de produção', op.numero],
      ['Pedido de origem', op.pedido?.numero ?? '—'],
      ['Cliente', op.pedido?.cliente?.nome ?? '—'],
      ['Quantidade', `${op.quantidade} peças`],
      ['Status', op.status.replace(/_/g, ' ')],
      ['Prioridade', op.prioridade],
      ['Entrega prevista', dataBR(op.entregaPrev)],
      ['Responsável', op.responsavel ?? '—'],
    ]);

    if (produto) {
      secao(doc, 'Produto');
      camposDuplos(doc, [
        ['Código', produto.codigo],
        ['Grade', produto.grade ?? '—'],
        ['Descrição', produto.descricao],
        ['Cor', op.cor ?? produto.cor ?? '—'],
      ]);
      // Imagem do modelo para o cortador identificar a peça (ou moldura em branco).
      secao(doc, 'Modelo da peça');
      if (produto.fotoModelo) {
        imagem(doc, produto.fotoModelo, 160);
      } else {
        const x = 50, w = doc.page.width - 100, h = 130;
        const y = doc.y + 2;
        doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).dash(3, { space: 3 }).strokeColor('#C9A227').stroke().undash();
        doc.fillColor('#a99a63').font('Helvetica').fontSize(10).text('FOTO DO MODELO (cole/anexe a imagem da peça)', x, y + h / 2 - 6, { width: w, align: 'center' });
        doc.y = y + h + 12; doc.x = x; doc.fillColor('#242a26');
      }
    }

    // Grade de tamanhos em caixinhas: usa a distribuição da OP quando definida;
    // sem distribuição, desenha os tamanhos do produto em branco (preenchimento manual).
    const grade = op.gradeTamanhos as Record<string, number> | null;
    if (grade && Object.keys(grade).length) {
      secao(doc, `Grade de tamanhos (${op.quantidade} peças)`);
      gradeTabela(doc, Object.entries(grade).map(([t, q]) => [t, String(q)]));
    } else if (produto?.grade) {
      const cols = this.expandirGrade(produto.grade);
      if (cols.length <= 1) {
        // Tamanho único: quantidade = total da OP (preenchido).
        secao(doc, `Grade de tamanhos (${op.quantidade} peças)`);
        gradeTabela(doc, [[cols[0] ?? 'ÚNICO', String(op.quantidade)]]);
      } else {
        secao(doc, 'Grade de tamanhos (preencher)');
        gradeTabela(doc, cols.map((t) => [t, '']));
      }
    }

    // Romaneio de corte: materiais a separar para esta OP. Usa o snapshot gravado
    // na geração (com status de conferência); OPs antigas caem no cálculo ao vivo da BOM.
    type Rom = { materialId?: number | null; codigo: string; descricao: string; localizacao?: string | null; quantidade: number; unidade: string; conferido?: boolean; conferidoPor?: string; lotes?: string[] };
    const romaneio = (op.romaneioMateriais as unknown as Rom[] | null) ?? [];
    if (romaneio.length) {
      // Localização: campo manual do material ou endereçamento das unidades em estoque.
      const mids = romaneio.map((r) => r.materialId).filter((x): x is number => x != null);
      if (mids.length) {
        const [mats, unids] = await Promise.all([
          this.prisma.material.findMany({ where: { id: { in: mids } }, select: { id: true, localizacao: true } }),
          this.prisma.unidadeEstoque.findMany({ where: { materialId: { in: mids }, saidaEm: null }, select: { materialId: true, coluna: true, andar: true, caixaMaster: true } }),
        ]);
        const manualMap = new Map(mats.map((m) => [m.id, m.localizacao]));
        const endMap = new Map<number, Set<string>>();
        for (const u of unids) {
          if (u.materialId == null) continue;
          const partes = [u.coluna, u.andar, u.caixaMaster].filter((x) => x != null && x !== '');
          if (!partes.length) continue;
          (endMap.get(u.materialId) ?? endMap.set(u.materialId, new Set()).get(u.materialId)!).add(partes.join(' · '));
        }
        for (const r of romaneio) {
          if (r.materialId == null) continue;
          const manual = manualMap.get(r.materialId);
          if (manual) { r.localizacao = manual; continue; }
          const ends = endMap.get(r.materialId);
          if (ends && ends.size) r.localizacao = [...ends].slice(0, 3).join(' | ');
        }
      }
      secao(doc, `Romaneio de corte — materiais a separar (${op.quantidade} peças)`);
      tabela(
        doc,
        [
          { titulo: 'Conf.', largura: 34 },
          { titulo: 'Material', largura: 74 },
          { titulo: 'Descrição', largura: 150 },
          { titulo: 'Local', largura: 55 },
          { titulo: 'Qtd total', largura: 76, alinhamento: 'right' },
          { titulo: 'Lote fornec.', largura: 56 },
        ],
        romaneio.map((r) => [
          r.conferido ? 'OK' : '—',
          r.codigo,
          r.descricao,
          r.localizacao || '—',
          `${this.qtdBR(r.quantidade)} ${r.unidade}`,
          (r.lotes && r.lotes.length) ? r.lotes.join(', ') : '—',
        ]),
      );
    } else if (bom.length) {
      secao(doc, 'Consumo de material (por peça × total da OP)');
      tabela(
        doc,
        [
          { titulo: 'Material', largura: 90 },
          { titulo: 'Descrição', largura: 190 },
          { titulo: 'Por peça', largura: 105, alinhamento: 'right' },
          { titulo: 'Total OP', largura: 110, alinhamento: 'right' },
        ],
        bom.map((b) => [
          b.material.codigo,
          b.material.descricao,
          `${this.qtdBR(b.quantidade)} ${b.unidade}`,
          `${this.qtdBR(b.quantidade.mul(op.quantidade))} ${b.unidade}`,
        ]),
      );
    }
    assinaturas(doc, 'Separado por (estoque)', 'Recebido no corte');
    return doc;
  }

  /**
   * Expande a grade textual do produto em lista de tamanhos:
   * "PP,GA" → [PP, GA] · "PP ao G4" → escada padrão entre os extremos.
   */
  /**
   * Interpreta a forma de pagamento e calcula o(s) vencimento(s).
   * Ignora números seguidos de "%" (ex.: "50% sinal" não vira 50 dias).
   * Se a forma é só o nº de dias (ex.: "19", "30 ddl"), o texto já mostra a data.
   */
  private pagamentoInfo(forma: string | null, base: Date): { texto: string; vencimentos: string } {
    const f = (forma ?? '').trim();
    // Remove percentuais ("50%") antes de extrair os prazos em dias.
    const semPct = f.replace(/\d{1,3}\s*%/g, '');
    const dias = [...semPct.matchAll(/\d{1,3}/g)]
      .map((m) => parseInt(m[0], 10))
      .filter((d) => d > 0 && d <= 360);
    const uniq = [...new Set(dias)].sort((a, b) => a - b);
    const datas = uniq.map((d) => {
      const x = new Date(base);
      x.setDate(x.getDate() + d);
      return dataBR(x);
    });
    const vencimentos = datas.length ? datas.join(', ') : 'à vista';
    if (!f) return { texto: 'a combinar', vencimentos: 'à vista' };
    // Forma "pura" (só número de dias) → mostra em dias + a data, não o número solto.
    const puro = /^\s*\d{1,3}\s*(ddl|dias?|d)?\s*$/i.test(f);
    const texto = puro && datas.length ? `${uniq[0]} dias (vencimento ${datas[0]})` : f;
    return { texto, vencimentos };
  }

  /**
   * Formata quantidade no padrão brasileiro (vírgula decimal, ponto de milhar).
   * Ex.: 6.3 -> "6,30"; 33.96 -> "33,96"; 0.422 -> "0,422". Evita ler "6.300" como 6300.
   */
  private qtdBR(n: number | Prisma.Decimal): string {
    const fixed = (Number(n) || 0).toFixed(3);
    let [int, dec] = fixed.split('.');
    dec = dec.replace(/0+$/, '');
    if (dec.length < 2) dec = (dec + '00').slice(0, 2);
    const intBR = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${intBR},${dec}`;
  }

  /** Preço unitário de um tamanho: usa precoEspecial quando o tamanho é da faixa especial. */
  private precoTamanho(produto: Produto | null, base: Prisma.Decimal, tam: string): Prisma.Decimal {
    const esp = produto?.tamsEspeciais
      ? String(produto.tamsEspeciais).split(/[,;/ ]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    if (produto?.precoEspecial != null && esp.includes(String(tam).toUpperCase())) {
      return new Prisma.Decimal(produto.precoEspecial);
    }
    return base;
  }

  private expandirGrade(grade: string): string[] {
    const ESCADA = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
    const texto = grade.trim().toUpperCase();
    const m = /^(\S+)\s+AO?\s+(\S+)$/.exec(texto);
    if (m) {
      const i = ESCADA.indexOf(m[1]);
      const f = ESCADA.indexOf(m[2]);
      if (i >= 0 && f >= i) return ESCADA.slice(i, f + 1);
    }
    return texto.split(/[,;/]+/).map((t) => t.trim()).filter(Boolean).slice(0, 16);
  }

  /**
   * Plano de Corte: agrupa as OPs do pedido por modelo (produto) + tecido principal,
   * somando a grade por tamanho e o consumo de tecido — para o setor de Risco encaixar.
   * As OPs continuam individuais (rastreio); este documento é o plano de encaixe.
   */
  private async pdfPlanoCorte(pedidoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { cliente: true, ops: true },
    });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    }
    const ops = pedido.ops ?? [];
    const prodIds = [...new Set(ops.map((o) => o.produtoId).filter((x): x is number => x != null))];
    const prods = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } } }) : [];
    const prodMap = new Map<number, Produto>(prods.map((p) => [p.id, p]));

    type Rom = { codigo: string; descricao: string; quantidade: number; unidade: string };
    const tecidoDaOp = (op: (typeof ops)[number]): Rom | null => {
      const rom = (op.romaneioMateriais as unknown as Rom[] | null) ?? [];
      return rom.find((r) => /^MP-TEC/i.test(r.codigo)) ?? rom.find((r) => /^MP-/i.test(r.codigo)) ?? null;
    };

    type Grupo = { modelo: string; tecido: string; ops: string[]; grade: Record<string, number>; consumo: number; unidade: string };
    const grupos = new Map<string, Grupo>();
    for (const op of ops) {
      const prod = op.produtoId ? prodMap.get(op.produtoId) ?? null : null;
      const modelo = prod ? `${prod.codigo} · ${prod.descricao}` : op.numero;
      const tec = tecidoDaOp(op);
      const tecido = tec ? tec.descricao.split(' · ')[0] : (prod?.tecido || 'Tecido não definido');
      const key = `${op.produtoId ?? 0}|${tec?.codigo ?? tecido}`;
      const g: Grupo = grupos.get(key) ?? { modelo, tecido, ops: [], grade: {}, consumo: 0, unidade: tec?.unidade ?? 'm' };
      g.ops.push(op.numero);
      const grade = (op.gradeTamanhos as Record<string, number> | null) ?? {};
      if (Object.keys(grade).length) {
        for (const [t, q] of Object.entries(grade)) g.grade[t] = (g.grade[t] || 0) + Number(q);
      } else {
        g.grade['ÚNICO'] = (g.grade['ÚNICO'] || 0) + op.quantidade;
      }
      if (tec) g.consumo += Number(tec.quantidade) || 0;
      grupos.set(key, g);
    }

    const doc = novoDocumento('Plano de Corte', numero);
    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Plano de corte', numero],
      ['Pedido de origem', pedido.numero],
      ['Cliente', pedido.cliente.nome],
      ['OPs agrupadas', `${ops.length} OP(s) em ${grupos.size} grupo(s)`],
    ]);
    textoBloco(doc, 'Agrupa as OPs por modelo + tecido para o Risco encaixar o corte e otimizar o enfesto. Cada peça mantém sua OP individual para rastreio.');

    const ESCADA = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'ÚNICO'];
    let idx = 0;
    for (const g of grupos.values()) {
      idx++;
      if (doc.y > doc.page.height - 220) doc.addPage();
      secao(doc, `Grupo ${idx} · ${g.tecido}`);
      camposDuplos(doc, [
        ['Modelo', g.modelo],
        ['Tecido (encaixe)', g.tecido],
        ['OPs deste grupo', g.ops.join(', ')],
        ['Consumo total de tecido', `${this.qtdBR(g.consumo)} ${g.unidade}`],
      ]);
      const entries = Object.entries(g.grade).sort((a, b) => ESCADA.indexOf(a[0]) - ESCADA.indexOf(b[0]));
      gradeTabela(doc, entries.map(([t, q]) => [t, String(q)]));
    }
    assinaturas(doc, 'Risco / Encaixe', 'Corte / Enfesto');
    rodapeGrupo(doc);
    return doc;
  }

  private async pdfCompra(ocId: number, empresaId: number, numero: string): Promise<Pdf> {
    const oc = await this.prisma.ordemCompra.findUnique({
      where: { id: ocId },
      include: { fornecedor: true },
    });
    if (!oc || oc.fornecedor.empresaId !== empresaId) {
      throw new NotFoundException(`Ordem de compra ${ocId} não encontrada.`);
    }
    const doc = novoDocumento('Pedido de Compra', numero);
    secao(doc, 'Fornecedor');
    camposDuplos(doc, [
      ['Nome', oc.fornecedor.nome],
      ['CNPJ/CPF', oc.fornecedor.cnpjCpf ?? '—'],
      ['Contato', oc.fornecedor.contato ?? oc.fornecedor.telefone ?? '—'],
      ['Cidade/UF', oc.fornecedor.cidadeUf ?? '—'],
    ]);
    secao(doc, 'Item');
    tabela(
      doc,
      [
        { titulo: 'Descrição', largura: 265 },
        { titulo: 'Qtd', largura: 90, alinhamento: 'right' },
        { titulo: 'Un.', largura: 55 },
        { titulo: 'Valor', largura: 85, alinhamento: 'right' },
      ],
      [[oc.descricao, this.qtdBR(oc.quantidade), oc.unidade, money(oc.valor)]],
    );
    totalDestaque(doc, 'Valor do pedido', money(oc.valor));
    secao(doc, 'Observações');
    doc.text(
      `OC ${oc.numero} · status ${oc.status} · previsão de entrega ${dataBR(oc.previsao)}.` +
        (oc.motivo ? ` Motivo: ${oc.motivo}` : ''),
    );
    assinaturas(doc, 'GRUPO CHERKESIAN — Compras', oc.fornecedor.nome);
    return doc;
  }

  private async pdfRomaneio(expId: number, empresaId: number, numero: string): Promise<Pdf> {
    const exp = await this.prisma.expedicao.findUnique({ where: { id: expId } });
    if (!exp) throw new NotFoundException(`Expedição ${expId} não encontrada.`);
    const cliente = await this.prisma.cliente.findUnique({ where: { id: exp.clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Expedição ${expId} não encontrada.`);
    }
    const pedido = exp.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: exp.pedidoId } })
      : null;
    const lote = exp.loteId ? await this.prisma.lote.findUnique({ where: { id: exp.loteId } }) : null;

    const doc = novoDocumento('Romaneio de Expedição', numero);
    secao(doc, 'Destinatário');
    camposDuplos(doc, [
      ['Cliente', cliente.nome],
      ['CNPJ/CPF', cliente.cnpjCpf ?? '—'],
      ['Endereço', exp.endereco ?? '—'],
      ['Cidade/UF · CEP', `${exp.cidadeUf ?? '—'} · ${exp.cep ?? '—'}`],
    ]);
    secao(doc, 'Carga');
    camposDuplos(doc, [
      ['Expedição', exp.numero],
      ['Pedido de origem', pedido?.numero ?? '—'],
      ['Peças', String(exp.pecas)],
      ['Volumes', String(exp.volumes)],
      ['Lote consumido', lote?.codigoLote ?? '—'],
      ['Data', dataBR(exp.data)],
    ]);
    secao(doc, 'Transporte');
    camposDuplos(doc, [
      ['Transportadora', exp.transportadora ?? '—'],
      ['Rastreio', exp.rastreio ?? '—'],
      ['Nota fiscal', exp.nf ?? '—'],
      ['Status', exp.status],
    ]);
    assinaturas(doc, 'Expedição — GRUPO CHERKESIAN', 'Recebido por (nome/documento)');
    return doc;
  }

  private async pdfMedidas(clienteId: number, empresaId: number, numero: string): Promise<Pdf> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    }
    const medidas = await this.prisma.medida.findMany({
      where: { empresaId, clienteId },
      orderBy: { colaborador: 'asc' },
    });
    const doc = novoDocumento('Ficha de Medidas', numero);
    secao(doc, 'Cliente');
    camposDuplos(doc, [
      ['Nome', cliente.nome],
      ['Segmento', cliente.segmento ?? '—'],
      ['Contato', cliente.contato ?? cliente.telefone ?? '—'],
      ['Cidade/UF', cliente.cidadeUf ?? '—'],
    ]);
    secao(doc, `Grade de tamanhos (${medidas.length} colaborador(es))`);
    if (medidas.length) {
      tabela(
        doc,
        [
          { titulo: 'Colaborador', largura: 150 },
          { titulo: 'Cargo', largura: 105 },
          { titulo: 'Tam.', largura: 45 },
          { titulo: 'Tórax', largura: 50, alinhamento: 'right' },
          { titulo: 'Cintura', largura: 50, alinhamento: 'right' },
          { titulo: 'Quadril', largura: 50, alinhamento: 'right' },
          { titulo: 'Altura', largura: 45, alinhamento: 'right' },
        ],
        medidas.map((m) => [
          m.colaborador,
          m.cargo ?? '—',
          m.tamanho,
          m.torax ? m.torax.toFixed(0) : '—',
          m.cintura ? m.cintura.toFixed(0) : '—',
          m.quadril ? m.quadril.toFixed(0) : '—',
          m.altura ? m.altura.toFixed(0) : '—',
        ]),
      );
    } else {
      doc.text('Nenhuma medida registrada para este cliente.');
    }
    assinaturas(doc, 'GRUPO CHERKESIAN', `${cliente.nome} — Conferido`);
    return doc;
  }

  private async pdfFichaTecnica(produtoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const produto = await this.prisma.produto.findUnique({
      where: { id: produtoId },
      include: { medidas: { orderBy: { ordem: 'asc' } } },
    });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${produtoId} não encontrado.`);
    }
    const bom = await this.prisma.consumo.findMany({
      where: { produtoId },
      include: { material: true },
    });

    const doc = novoDocumento('Ficha Técnica', numero);

    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Código', produto.codigo],
      ['Referência', produto.referencia ?? '—'],
      ['Descrição', produto.descricao],
      ['Grupo', produto.grupo ?? produto.categoria],
      ['Marca / cliente', produto.marca ?? '—'],
      ['Linha', produto.linha ?? '—'],
      ['Cor', produto.cor ?? '—'],
      ['Grade', produto.grade ?? '—'],
      ['Tecido', produto.tecido ?? '—'],
      ['Composição', produto.composicao ?? '—'],
      ['Modelagem (Audaces)', produto.modelagem ?? '—'],
      ['Preço base', produto.precoBase ? money(produto.precoBase) : '—'],
    ]);

    if (produto.fotoModelo) {
      secao(doc, 'Modelo');
      imagem(doc, produto.fotoModelo, 230);
    }

    if (produto.especificacoes?.trim()) {
      secao(doc, 'Especificações de confecção / costura');
      textoBloco(doc, produto.especificacoes);
    }

    if (produto.medidas.length) {
      secao(doc, 'Tabela de medidas');
      const tamanhos = this.tamanhosDaFicha(produto.grade, produto.medidas);
      tabelaMedidas(
        doc,
        tamanhos,
        produto.medidas.map((m) => {
          const valores = (m.valores ?? {}) as Record<string, string>;
          return {
            descricao: m.descricao,
            tolerancia: m.tolerancia ?? '',
            valores: tamanhos.map((t) => (valores[t] != null ? String(valores[t]) : '')),
          };
        }),
      );
    }

    if (bom.length) {
      secao(doc, 'Materiais / consumo por peça');
      tabela(
        doc,
        [
          { titulo: 'Material', largura: 95 },
          { titulo: 'Descrição', largura: 250 },
          { titulo: 'Un.', largura: 50 },
          { titulo: 'Consumo', largura: 100, alinhamento: 'right' },
        ],
        bom.map((b) => [
          b.material.codigo,
          b.material.descricao,
          b.unidade,
          b.quantidade.toFixed(4),
        ]),
      );
    }

    if (produto.fotoModelagem) {
      secao(doc, 'Modelagem (Audaces)');
      imagem(doc, produto.fotoModelagem, 230);
    }

    if (produto.observacoes?.trim()) {
      secao(doc, 'Observações');
      textoBloco(doc, produto.observacoes);
    }

    assinaturas(doc, 'GRUPO CHERKESIAN — Modelagem/PCP', `${produto.marca ?? 'Cliente'} — Aprovado`);
    return doc;
  }

  /** Colunas de tamanho da tabela: a grade do produto, ou a união das chaves das medidas. */
  private tamanhosDaFicha(grade: string | null, medidas: Array<{ valores: unknown }>): string[] {
    if (grade?.trim()) {
      const cols = this.expandirGrade(grade);
      if (cols.length) return cols;
    }
    const set: string[] = [];
    for (const m of medidas) {
      for (const k of Object.keys((m.valores ?? {}) as Record<string, unknown>)) {
        if (!set.includes(k)) set.push(k);
      }
    }
    return set.slice(0, 16);
  }

  private async pdfEtiqueta(loteId: number, empresaId: number, numero: string): Promise<Pdf> {
    const lote = await this.prisma.lote.findUnique({
      where: { id: loteId },
      include: { estoque: { include: { produto: true } }, op: true },
    });
    if (!lote || lote.estoque.produto.empresaId !== empresaId) {
      throw new NotFoundException(`Lote ${loteId} não encontrado.`);
    }
    const doc = novaEtiqueta();
    const p = lote.estoque.produto;
    doc.fillColor('#9a7d1e').font('Helvetica-Bold').fontSize(9).text('LOTE', 20, 72, { characterSpacing: 1 });
    doc.fillColor('#0A0A0A').font('Helvetica-Bold').fontSize(30).text(lote.codigoLote, 20, 84);
    doc.fillColor('#242a26').font('Helvetica').fontSize(11);
    doc.text(`${p.codigo} — ${p.descricao}`, 20, 130, { width: 380 });
    doc.font('Helvetica-Bold').fontSize(13);
    doc.text(`Tamanho ${lote.estoque.tamanho}  ·  ${lote.quantidade} peças`, 20, 168);
    doc.font('Helvetica').fontSize(10).fillColor('#807d72');
    doc.text(`OP de origem: ${lote.op?.numero ?? '—'}   ·   Entrada: ${dataBR(lote.data)}`, 20, 196);
    doc.text(`Documento ${numero} · Cherkesian ERP`, 20, 258);
    return doc;
  }
}
