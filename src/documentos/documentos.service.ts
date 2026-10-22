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
import { gradeMista, precoDoTamanho } from '../common/utils/preco-faixa.util';
import {
  Pdf,
  assinaturas,
  camposDuplos,
  dataBR,
  gradeTabela,
  imagem,
  imagemMini,
  setLogoDoc,
  setDataDoc,
  itemPedido,
  pedidoGradeTabela,
  money,
  novaEtiqueta,
  novoDocumento,
  novoDocumentoLimpo,
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
  op_pedido: { titulo: 'Ordem de Produção do Pedido', prefixo: 'OPP', area: 'producao' },
  plano_corte: { titulo: 'Plano de Corte', prefixo: 'PCT', area: 'producao' },
  pedido_compra: { titulo: 'Pedido de Compra', prefixo: 'OCD', area: 'compras' },
  romaneio: { titulo: 'Romaneio de Expedição', prefixo: 'ROM', area: 'expedicao' },
  ficha_medidas: { titulo: 'Ficha de Medidas', prefixo: 'MED', area: 'medidas' },
  // Ficha técnica do produto: pode ser emitida por produção (cadastros) e comercial (vendas).
  // Esta é a do CLIENTE — folha de aprovação, sem consumo de material.
  ficha_tecnica: { titulo: 'Ficha Técnica', prefixo: 'FT', area: ['cadastros', 'vendas'] },
  // A da FÁBRICA, com receita, conjunto e modelagem. Fora de 'vendas' porque leva
  // o consumo de material por peça.
  ficha_producao: { titulo: 'Ficha de Produção', prefixo: 'FPR', area: ['cadastros', 'producao'] },
  etiqueta: { titulo: 'Etiqueta de Lote', prefixo: 'ETQ', area: 'estoque' },
  piloto: { titulo: 'Ficha de Peça Piloto', prefixo: 'PIL', area: ['producao', 'vendas'] },
  piloto_ficha: { titulo: 'Ficha Técnica · Peça Piloto', prefixo: 'FTP', area: ['producao', 'vendas'] },
  // Demonstrativo de cobrança do cliente (títulos em aberto) — referenciaId = clienteId.
  cobranca: { titulo: 'Demonstrativo de Cobrança', prefixo: 'COB', area: 'receber' },
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
  async criar(tipo: string, referenciaId: number, user: AuthUser, ids?: number[]) {
    const def = this.validarTipo(tipo, user);
    await this.validarEstadoReferencia(tipo, referenciaId, user.empresaId);
    // Recorte (hoje só a cobrança): ids ordenados e sem repetição, para que a
    // MESMA seleção reaproveite o mesmo documento em vez de queimar um número novo.
    const filtro = (ids ?? []).length
      ? [...new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(',')
      : null;
    // Garante que a referência existe (e pertence à empresa) antes de registrar.
    await this.montarPdf(tipo, referenciaId, user.empresaId, 'PREVIA', filtro);

    // Rastreabilidade: reaproveita o documento já existente da MESMA referência
    // E do mesmo recorte (não cria número novo a cada geração de PDF).
    const jaExiste = await this.prisma.documento.findFirst({ where: { tipo, referencia: String(referenciaId), filtro }, orderBy: { id: 'asc' } });
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
        filtro,
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
      documento.filtro,
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

    // Aceita VÁRIOS destinatários (vírgula/;/espaço). Valida cada um e normaliza.
    const destinatarios = (para || '').split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    const reEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!destinatarios.length) throw new BadRequestException('Informe ao menos um e-mail de destino.');
    const invalidos = destinatarios.filter((e) => !reEmail.test(e));
    if (invalidos.length) throw new BadRequestException(`E-mail(s) inválido(s): ${invalidos.join(', ')}.`);
    para = [...new Set(destinatarios)].join(', ');

    const { doc, numero } = await this.gerarPdf(id, user);
    const pdf = await this.pdfParaBuffer(doc);

    // Empresa/filial emissora do documento — vira o NOME do remetente ("De:"),
    // o assunto e a assinatura, para o cliente ver de qual empresa da base veio
    // (HC QUALITY / YEREVAN / CHERKESIAN...). Cai em GRUPO CHERKESIAN se não houver.
    let filialId: number | null = null;
    if (documento.tipo === 'pedido' || documento.tipo === 'proposta') {
      const ped = await this.prisma.pedido.findUnique({ where: { id: Number(documento.referencia) }, select: { filialId: true } });
      filialId = ped?.filialId ?? null;
    }
    const marca = await this.marcaRemetente(user.empresaId, filialId);

    // Nos documentos de cobrança (pedido/proposta), inclui a linha do PIX no corpo
    // do e-mail p/ facilitar o pagamento do cliente.
    let pagamentoTxt = '';
    if (documento.tipo === 'pedido' || documento.tipo === 'proposta') {
      const linha = await this.linhaPagamento(user.empresaId, filialId);
      if (linha) pagamentoTxt = `\n\n${linha}`;
    }

    const resultado = await this.email.enviar({
      para,
      remetenteNome: marca,
      assunto: assunto || `${def.titulo} ${numero} — ${marca}`,
      texto:
        (mensagem ? mensagem + '\n\n' : '') +
        `Segue em anexo o documento ${numero} (${def.titulo}).` +
        pagamentoTxt +
        `\n\n${marca} · Uniformes Profissionais\n"Vestindo quem faz acontecer"`,
      anexos: [{ filename: `${numero}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });

    return { documento: numero, para, ...resultado };
  }

  /** Linha de pagamento (PIX) para o corpo do e-mail. Usa a filial do documento
   *  ou a matriz da empresa; extrai a linha do PIX dos dados bancários. */
  async linhaPagamento(empresaId: number, filialId?: number | null): Promise<string> {
    let db = '';
    if (filialId) {
      const f = await this.prisma.filial.findUnique({ where: { id: filialId }, select: { dadosBancarios: true } });
      db = f?.dadosBancarios || '';
    }
    if (!db.trim()) {
      const m = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, select: { dadosBancarios: true } });
      db = m?.dadosBancarios || '';
    }
    if (!db.trim()) return '';
    const linhaPix = db.split(/[\r\n]+/).map((l) => l.trim()).find((l) => /pix/i.test(l));
    return linhaPix ? `Para pagamento — ${linhaPix}` : '';
  }

  /** Nome de exibição da empresa emissora ("De:" do e-mail e assinatura).
   *  Usa a filial do documento (nome fantasia ou razão) ou a matriz da empresa. */
  async marcaRemetente(empresaId: number, filialId?: number | null): Promise<string> {
    const f = filialId
      ? await this.prisma.filial.findUnique({ where: { id: filialId }, select: { nome: true, nomeFantasia: true } })
      : await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, select: { nome: true, nomeFantasia: true } });
    const nome = (f?.nomeFantasia || f?.nome || '').trim();
    return nome || 'GRUPO CHERKESIAN';
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

  /** Ids do recorte guardado em Documento.filtro ("12,15" -> [12,15]). */
  private static idsDoFiltro(filtro?: string | null): number[] {
    return String(filtro ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  }

  private async montarPdf(
    tipo: string,
    referenciaId: number,
    empresaId: number,
    numero: string,
    filtro?: string | null,
  ): Promise<Pdf> {
    // Aplica o logo da empresa no cabeçalho dos documentos.
    const emp = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { logo: true } });
    setLogoDoc(emp?.logo ?? null);
    setDataDoc(null); // padrão: data de HOJE; alguns documentos sobrepõem c/ a data de entrada.
    switch (tipo) {
      case 'proposta':
      case 'pedido':
        return this.pdfPedido(tipo, referenciaId, empresaId, numero);
      case 'op':
        return this.pdfOp(referenciaId, empresaId, numero);
      case 'op_pedido':
        return this.pdfOpPedido(referenciaId, empresaId, numero);
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
      case 'ficha_producao':
        return this.pdfFichaProducao(referenciaId, empresaId, numero);
      case 'cobranca':
        return this.pdfCobranca(referenciaId, empresaId, numero, DocumentosService.idsDoFiltro(filtro));
      case 'etiqueta':
        return this.pdfEtiqueta(referenciaId, empresaId, numero);
      case 'piloto':
        return this.pdfPiloto(referenciaId, empresaId, numero);
      case 'piloto_ficha':
        return this.pdfPilotoFicha(referenciaId, empresaId, numero);
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
    // O cabeçalho mostra a data de ENTRADA (criação) do pedido, não a da impressão.
    setDataDoc(pedido.data ?? pedido.criadoEm ?? null);
    const doc = novoDocumento(titulo, numero);

    // Se o pedido aponta uma UNIDADE/FILIAL do cliente, os dados exibidos são os DELA
    // (nome, CNPJ, cidade) — é ela o destinatário; senão usa o cliente principal.
    const unidade = pedido.clienteUnidadeId
      ? await this.prisma.clienteUnidade.findUnique({ where: { id: pedido.clienteUnidadeId } })
      : null;
    const cli = pedido.cliente;
    const destNome = unidade?.nome || cli.nome;
    const destDoc = unidade?.cnpjCpf || cli.cnpjCpf || '—';
    const destCidadeUf = (unidade && (unidade.municipio || unidade.uf))
      ? `${unidade.municipio || ''}${unidade.uf ? '/' + unidade.uf : ''}`
      : (cli.cidadeUf ?? '—');
    const destContato = cli.contato ?? cli.telefone ?? unidade?.email ?? '—';
    // Endereço + CEP: da unidade quando ela tiver; senão do cliente.
    const usaEndUni = !!(unidade && (unidade.logradouro || unidade.bairro || unidade.cep));
    const destCep = (usaEndUni ? unidade!.cep : cli.cep) || '—';
    const destEndereco = [
      usaEndUni ? unidade!.logradouro : cli.logradouro,
      usaEndUni ? unidade!.numeroEndereco : cli.numeroEndereco,
      usaEndUni ? unidade!.bairro : cli.bairro,
    ].filter(Boolean).join(', ') || '—';

    secao(doc, 'Cliente');
    camposDuplos(doc, [
      ['Razão social / nome', destNome],
      ['CNPJ/CPF', destDoc],
      ['Endereço', destEndereco],
      ['CEP', destCep],
      ['Cidade/UF', destCidadeUf],
      ['Contato', destContato],
    ]);

    // Forma de pagamento + vencimento (converte "19" em data; ignora "50%").
    const pag = this.pagamentoInfo(pedido.formaPagamento, pedido.data ? new Date(pedido.data) : new Date());

    secao(doc, 'Dados do pedido');
    camposDuplos(doc, [
      ['Número do pedido', pedido.numero],
      ['Ordem de compra (cliente)', pedido.ordemCompraCliente || '—'],
      ['Data', dataBR(pedido.data)],
      ['Forma de pagamento', pag.texto],
      ['Vencimento', pag.vencimentos],
      ['Etapa atual', pedido.etapa],
    ]);

    secao(doc, 'Itens · grade de tamanhos');
    // Colunas de tamanho = união dos tamanhos presentes, na ordem da escada.
    const ESCADA = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'ÚNICO'];
    const presentes = new Set<string>();
    for (const i of pedido.itens) {
      const g = i.grade as Record<string, number> | null;
      if (g && Object.keys(g).length) Object.entries(g).forEach(([t, q]) => { if (Number(q) > 0) presentes.add(t.toUpperCase()); });
      else presentes.add('ÚNICO');
    }
    const sizes = ESCADA.filter((s) => presentes.has(s)).concat([...presentes].filter((s) => !ESCADA.includes(s)));

    const rows: Array<{ num: string; codigo?: string | null; descricao: string; cor?: string | null; qtyBySize: Record<string, number>; vUnit: string; vTotal: string }> = [];
    const totBySize: Record<string, number> = {};
    let totPecas = 0;
    let totValor = new Prisma.Decimal(0);
    pedido.itens.forEach((i, idx) => {
      const prod = i.produtoId ? prodMap.get(i.produtoId) ?? null : null;
      const base = i.valorUnit;
      const grade = (i.grade as Record<string, number> | null) ?? null;
      const num = String(idx + 1).padStart(2, '0');
      const cor = i.cor ?? prod?.cor ?? null;
      // Agrupa as quantidades por PREÇO (base vs especial) — cada preço vira uma linha.
      const porPreco = new Map<string, { unit: Prisma.Decimal; q: Record<string, number> }>();
      const misto = gradeMista(prod, grade);
      const add = (tam: string, qtd: number) => {
        if (!(qtd > 0)) return;
        const unit = this.precoTamanho(prod, base, tam, misto);
        const key = unit.toFixed(2);
        if (!porPreco.has(key)) porPreco.set(key, { unit, q: {} });
        porPreco.get(key)!.q[tam] = (porPreco.get(key)!.q[tam] || 0) + qtd;
        totBySize[tam] = (totBySize[tam] || 0) + qtd;
        totPecas += qtd;
      };
      if (grade && Object.keys(grade).length) Object.entries(grade).forEach(([t, q]) => add(t.toUpperCase(), Number(q) || 0));
      else add('ÚNICO', i.quantidade);
      for (const { unit, q } of porPreco.values()) {
        const linhaQtd = Object.values(q).reduce((a, b) => a + b, 0);
        const vt = unit.mul(linhaQtd);
        totValor = totValor.plus(vt);
        rows.push({ num, codigo: prod?.codigo ?? null, descricao: i.descricao, cor, qtyBySize: q, vUnit: money(unit), vTotal: money(vt) });
      }
    });
    pedidoGradeTabela(doc, { sizes, rows, totBySize, totPecas, totValor: money(totValor) });
    totalDestaque(doc, 'Valor total', money(pedido.valorTotal));
    const vFrete = Number(pedido.valorFrete ?? 0);
    if (vFrete > 0) {
      totalDestaque(doc, 'Frete', money(vFrete));
      totalDestaque(doc, 'Total com frete', money(Number(pedido.valorTotal) + vFrete));
    }

    // Condições comerciais (pagamento, frete, prazo, validade).
    // Mantém o bloco junto: se não couber no restante da página, começa em nova.
    if (doc.y > doc.page.height - 230) doc.addPage();
    secao(doc, 'Condições comerciais');
    const prazoTxt = pedido.prazoEntrega ? dataBR(pedido.prazoEntrega) : 'a combinar';
    camposDuplos(doc, [
      ['Forma de pagamento', pag.texto],
      ['Frete', (pedido.frete ?? 'a combinar') + (vFrete > 0 ? ` · ${money(vFrete)}` : '')],
      ['Prazo de entrega', prazoTxt],
      ['Validade da proposta', tipo === 'proposta' ? '15 dias' : '—'],
    ]);
    if (tipo === 'proposta') {
      textoBloco(doc, 'Cliente novo: produção liberada após aprovação da peça-piloto.');
    }

    // Observações do pedido: usa a COMERCIAL; se estiver vazia, cai para a
    // observação "obs" (assim o que o usuário digitar sempre sai no PDF de venda).
    const obsPedido = pedido.obsComercial?.trim() || pedido.obs?.trim();
    if (obsPedido) {
      if (doc.y > doc.page.height - 150) doc.addPage();
      secao(doc, 'Observações');
      textoBloco(doc, obsPedido);
    }

    // Instruções de entrega / etiquetagem (padrão do cliente — ex.: VIVARA via transportadora ZENATUR).
    this.secaoEntrega(doc, pedido.instrucoesEntrega);

    // Dados bancários para pagamento (da filial emissora; se o pedido não tiver
    // filial, usa a matriz da empresa como padrão).
    let dadosBancarios = pedido.filial?.dadosBancarios?.trim() || '';
    if (!dadosBancarios) {
      const matriz = await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, select: { dadosBancarios: true } });
      dadosBancarios = matriz?.dadosBancarios?.trim() || '';
    }
    if (dadosBancarios) {
      secao(doc, 'Dados bancários para pagamento');
      textoBloco(doc, dadosBancarios);
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
    // Escopo: OP de pedido (via pedido.empresaId) OU OP avulsa (op.empresaId próprio).
    if (!op || (op.empresaId ?? op.pedido?.empresaId) !== empresaId) {
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
        imagem(doc, produto.fotoModelo, 128);
      } else {
        const x = 50, w = doc.page.width - 100, h = 92;
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
      // OP parcial: compara com a grade pedida (mesmo produto+cor) e marca os
      // tamanhos incompletos (cortado X de Y) em laranja com "*".
      let pedida: Record<string, number> | null = null;
      if (op.corteParcial && op.pedidoId && op.produtoId) {
        const itens = await this.prisma.pedidoItem.findMany({
          where: { pedidoId: op.pedidoId, produtoId: op.produtoId, ...(op.cor ? { cor: op.cor } : {}) },
          select: { grade: true },
        });
        const acc: Record<string, number> = {};
        for (const it of itens) {
          const g = it.grade as Record<string, number> | null;
          if (g) for (const [t, q] of Object.entries(g)) acc[t.toUpperCase()] = (acc[t.toUpperCase()] ?? 0) + (Number(q) || 0);
        }
        if (Object.keys(acc).length) pedida = acc;
      }
      gradeTabela(
        doc,
        Object.entries(grade).map(([t, q]) => {
          const cortado = Number(q) || 0;
          const ped = pedida?.[t.toUpperCase()];
          if (ped != null && cortado < ped) return [t, String(cortado), { partial: true, sub: `de ${ped}` }];
          return [t, String(cortado)];
        }),
      );
      if (pedida) {
        doc.fillColor('#9a5a00').font('Helvetica').fontSize(8.5)
          .text('* tamanho parcial — corte primeiro os menores; o restante sai na OP complementar quando o tecido chegar.', 50, doc.y, { width: doc.page.width - 100 });
        doc.moveDown(0.4);
        doc.fillColor('#242a26').font('Helvetica').fontSize(10);
      }
    } else if (produto?.grade) {
      const cols = this.expandirGrade(produto.grade);
      if (cols.length <= 1) {
        // Tamanho único: quantidade = total da OP (preenchido).
        secao(doc, `Grade de tamanhos (${op.quantidade} peças)`);
        gradeTabela(doc, [[cols[0] ?? 'ÚNICO', String(op.quantidade)]]);
      } else {
        secao(doc, `Grade de tamanhos (preencher) — total ${op.quantidade} peças`);
        gradeTabela(doc, cols.map((t) => [t, '']), op.quantidade);
      }
    } else if (op.quantidade > 0) {
      // Sem grade e sem template do produto: mostra a quantidade total (tamanho único).
      secao(doc, `Quantidade — ${op.quantidade} peças (tamanho único)`);
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
      if (op.corteParcial) {
        doc.fillColor('#9a5a00').font('Helvetica-Bold').fontSize(9).text('CORTE OTIMIZADO (parcial) — corte primeiro os tamanhos menores; o restante sai na OP complementar.', 50, doc.y, { width: doc.page.width - 100 });
        doc.moveDown(0.4);
        doc.fillColor('#242a26').font('Helvetica').fontSize(10);
      }
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
          b.material?.codigo ?? '—',
          b.material?.descricao ?? (b.familia ? b.familia + ' (família — cor do pedido)' : '—'),
          `${this.qtdBR(b.quantidade)} ${b.unidade}`,
          `${this.qtdBR(b.quantidade.mul(op.quantidade))} ${b.unidade}`,
        ]),
      );
    }
    // Instruções de entrega / etiquetagem do pedido (produção/packing já veem o padrão do cliente).
    this.secaoEntrega(doc, op.pedido?.instrucoesEntrega);

    assinaturas(doc, 'Separado por (estoque)', 'Recebido no corte');
    return doc;
  }

  /** Renderiza a seção "Instruções de entrega / etiquetagem" de um pedido (se houver). */
  private secaoEntrega(doc: Pdf, instrucoesEntrega: unknown): void {
    const ie = (instrucoesEntrega && typeof instrucoesEntrega === 'object')
      ? (instrucoesEntrega as { transportadora?: { nome?: string; cnpj?: string }; entrega?: { razaoSocial?: string; logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; referencia?: string }; instrucoes?: string })
      : null;
    if (!ie) return;
    const t = ie.transportadora ?? {};
    const en = ie.entrega ?? {};
    const endereco = [en.logradouro, en.bairro, en.cidade ? en.cidade + (en.uf ? '/' + en.uf : '') : '', en.cep ? 'CEP ' + en.cep : ''].filter(Boolean).join(' · ');
    const campos: Array<[string, string]> = [];
    if (t.nome) campos.push(['Transportadora', t.nome + (t.cnpj ? ' · ' + t.cnpj : '')]);
    if (endereco) campos.push(['Endereço de entrega', endereco]);
    if (en.referencia) campos.push(['Referência', en.referencia]);
    if (en.razaoSocial) campos.push(['Razão social do destino', en.razaoSocial]);
    const temInstr = !!(ie.instrucoes && ie.instrucoes.trim());
    if (!campos.length && !temInstr) return;
    if (doc.y > doc.page.height - 200) doc.addPage();
    secao(doc, 'Instruções de entrega / etiquetagem');
    if (campos.length) camposDuplos(doc, campos);
    if (temInstr) textoBloco(doc, ie.instrucoes!.trim());
  }

  /**
   * OP CONSOLIDADA DO PEDIDO: um único documento com TODAS as OPs do pedido
   * (todos os produtos/cores + grades), mais o romaneio de materiais somado.
   * Documento "clean" para entregar na mão da produção.
   */
  private async pdfOpPedido(pedidoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { cliente: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    const ops = await this.prisma.oP.findMany({ where: { pedidoId }, orderBy: { id: 'asc' } });
    if (!ops.length) throw new BadRequestException('Este pedido ainda não tem OP gerada.');
    const prodIds = ops.map((o) => o.produtoId).filter((x): x is number => x != null);
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true, descricao: true, cor: true, fotoModelo: true } }) : [];
    const prodMap = new Map(produtos.map((p) => [p.id, p]));
    const totalPecas = ops.reduce((s, o) => s + o.quantidade, 0);

    const doc = novoDocumento('Ordem de Produção do Pedido', numero);
    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Pedido', pedido.numero],
      ['Cliente', pedido.cliente?.nome ?? '—'],
      ['Total de peças', `${totalPecas} peças`],
      ['Ordens de produção', `${ops.length} OP(s)`],
      ['Entrega prevista', dataBR(pedido.prazoEntrega)],
      ['Emitido em', dataBR(new Date())],
    ]);

    // Uma seção compacta por OP: produto + cor + grade de tamanhos.
    type Rom = { materialId?: number | null; codigo: string; descricao: string; localizacao?: string | null; quantidade: number; unidade: string };
    const totMat = new Map<string, { codigo: string; descricao: string; unidade: string; quantidade: number; materialId?: number | null }>();
    for (const op of ops) {
      const prod = op.produtoId ? prodMap.get(op.produtoId) : null;
      if (doc.y > doc.page.height - 200) doc.addPage();
      secao(doc, `${op.numero} · ${prod?.codigo ?? '—'} — ${prod?.descricao ?? op.numero}${op.corteParcial ? '  (PARCIAL)' : ''}`);
      camposDuplos(doc, [
        ['Cor', op.cor ?? prod?.cor ?? '—'],
        ['Quantidade', `${op.quantidade} peças`],
      ]);
      // Miniatura da peça para a produção identificar o modelo.
      imagemMini(doc, prod?.fotoModelo ?? null);
      const grade = op.gradeTamanhos as Record<string, number> | null;
      if (grade && Object.keys(grade).length) {
        gradeTabela(doc, Object.entries(grade).map(([t, q]) => [t, String(Number(q) || 0)] as [string, string]));
      }
      // Acumula os materiais do romaneio (soma por material).
      const rom = (op.romaneioMateriais as unknown as Rom[] | null) ?? [];
      for (const r of rom) {
        const key = String(r.materialId ?? r.codigo);
        const cur = totMat.get(key) ?? { codigo: r.codigo, descricao: r.descricao, unidade: r.unidade, quantidade: 0, materialId: r.materialId };
        cur.quantidade += Number(r.quantidade) || 0;
        totMat.set(key, cur);
      }
    }

    // Romaneio TOTAL de materiais (somado de todas as OPs do pedido).
    if (totMat.size) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      secao(doc, 'Materiais totais a separar (todas as OPs do pedido)');
      tabela(
        doc,
        [
          { titulo: 'Material', largura: 90 },
          { titulo: 'Descrição', largura: 250 },
          { titulo: 'Qtd total', largura: 105, alinhamento: 'right' },
        ],
        [...totMat.values()].map((m) => [m.codigo, m.descricao, `${this.qtdBR(m.quantidade)} ${m.unidade}`]),
      );
    }
    this.secaoEntrega(doc, pedido.instrucoesEntrega);
    assinaturas(doc, 'Separado por (estoque)', 'Recebido no corte');
    rodapeGrupo(doc);
    return doc;
  }

  /**
   * ORDEM DE SERVIÇO para oficina: recorte da produção do pedido por PRODUTO
   * e/ou TAMANHO. Gerada sob demanda (não persiste documento numerado).
   */
  async gerarOsPdf(
    pedidoId: number,
    user: AuthUser,
    filtro: { produtoIds?: number[]; tamanhos?: string[] },
  ): Promise<{ doc: Pdf; numero: string }> {
    this.validarTipo('op', user); // OS é da área de produção
    const empresaId = user.empresaId;
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { cliente: true } });
    if (!pedido || pedido.empresaId !== empresaId) throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    let ops = await this.prisma.oP.findMany({ where: { pedidoId }, orderBy: { id: 'asc' } });
    if (!ops.length) throw new BadRequestException('Este pedido ainda não tem OP gerada.');
    const prodFiltro = filtro.produtoIds && filtro.produtoIds.length ? new Set(filtro.produtoIds) : null;
    const tamFiltro = filtro.tamanhos && filtro.tamanhos.length ? new Set(filtro.tamanhos.map((t) => t.toUpperCase())) : null;
    if (prodFiltro) ops = ops.filter((o) => o.produtoId != null && prodFiltro.has(o.produtoId));
    if (!ops.length) throw new BadRequestException('Nenhuma OP corresponde ao filtro selecionado.');

    const prodIds = ops.map((o) => o.produtoId).filter((x): x is number => x != null);
    const produtos = prodIds.length ? await this.prisma.produto.findMany({ where: { id: { in: prodIds } }, select: { id: true, codigo: true, descricao: true, cor: true, fotoModelo: true } }) : [];
    const prodMap = new Map(produtos.map((p) => [p.id, p]));

    // Recorta a grade de cada OP pelos tamanhos escolhidos e soma o total da OS.
    const linhas: Array<{ op: string; codigo: string; descricao: string; cor: string; foto: string | null; grade: Array<[string, string]>; total: number }> = [];
    let totalOS = 0;
    for (const op of ops) {
      const prod = op.produtoId ? prodMap.get(op.produtoId) : null;
      const g = (op.gradeTamanhos as Record<string, number> | null) ?? {};
      const entradas = Object.entries(g)
        .filter(([t, q]) => (Number(q) || 0) > 0 && (!tamFiltro || tamFiltro.has(t.toUpperCase())))
        .map(([t, q]) => [t, String(Number(q) || 0)] as [string, string]);
      const total = entradas.reduce((s, [, q]) => s + (Number(q) || 0), 0);
      if (!total) continue;
      totalOS += total;
      linhas.push({ op: op.numero, codigo: prod?.codigo ?? '—', descricao: prod?.descricao ?? op.numero, cor: op.cor ?? prod?.cor ?? '—', foto: prod?.fotoModelo ?? null, grade: entradas, total });
    }
    if (!linhas.length) throw new BadRequestException('Nenhuma peça corresponde ao filtro (produto/tamanho).');

    const numero = `OS-${pedido.numero}`;
    const empLogo = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { logo: true } });
    setLogoDoc(empLogo?.logo ?? null);
    const doc = novoDocumento('Ordem de Serviço', numero);
    secao(doc, 'Identificação');
    const filtroTxt = [
      prodFiltro ? `${prodFiltro.size} produto(s)` : 'todos os produtos',
      tamFiltro ? `tamanhos ${[...tamFiltro].join(', ')}` : 'todos os tamanhos',
    ].join(' · ');
    camposDuplos(doc, [
      ['Pedido', pedido.numero],
      ['Cliente', pedido.cliente?.nome ?? '—'],
      ['Total desta OS', `${totalOS} peças`],
      ['Recorte', filtroTxt],
      ['Emitido em', dataBR(new Date())],
      ['Oficina / responsável', '____________________'],
    ]);

    for (const l of linhas) {
      if (doc.y > doc.page.height - 260) doc.addPage();
      secao(doc, `${l.codigo} — ${l.descricao}  ·  ${l.cor}  (${l.total} peças)`);
      // Foto maior na OS (vai na mão do costureiro — ver bem a peça ajuda).
      imagemMini(doc, l.foto, 168);
      gradeTabela(doc, l.grade);
    }
    assinaturas(doc, 'Entregue à oficina', 'Recebido na oficina');
    rodapeGrupo(doc);
    return { doc, numero };
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

  /**
   * Preço unitário de um tamanho. Mesma regra do pedido (preco-faixa.util): o
   * cadastro só sobrepõe o preço da linha quando a grade dela mistura tamanho
   * normal com tamanho da faixa especial — senão o documento imprimiria um preço
   * diferente do que está gravado no item.
   */
  private precoTamanho(
    produto: Produto | null,
    base: Prisma.Decimal,
    tam: string,
    misto: boolean,
  ): Prisma.Decimal {
    return precoDoTamanho(produto, base, tam, misto);
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
    // NOSSO CNPJ comprador (filial emitente): a OC informada, senão a matriz.
    const filialCompra = oc.filialId
      ? await this.prisma.filial.findUnique({ where: { id: oc.filialId } })
      : await this.prisma.filial.findFirst({ where: { empresaId, matriz: true }, orderBy: { id: 'asc' } });

    // Logo do cabeçalho: o da EMPRESA COMPRADORA (filial), se tiver; senão mantém o da empresa/grupo.
    if (filialCompra?.logo) setLogoDoc(filialCompra.logo);
    const doc = novoDocumento('Pedido de Compra', numero);

    const NAVY = '#1b2a4a', GOLD = '#8a6d1e', TINTA = '#242a26', CINZA = '#6a675e', LINHA = '#e7e3d8', BGSOFT = '#faf8f2';
    const W = doc.page.width, X = 50, CW = W - 100;

    // ===== Dois cards lado a lado: COMPRADOR | FORNECEDOR =====
    const card = (x: number, y: number, w: number, titulo: string, rows: Array<[string, string]>): number => {
      const pad = 9;
      doc.font('Helvetica').fontSize(10);
      let h = 26;
      for (const [, v] of rows) h += 10 + doc.heightOfString(v || '—', { width: w - pad * 2 }) + 5;
      h += pad - 3;
      doc.roundedRect(x, y, w, h, 8).fillColor(BGSOFT).fill();
      doc.roundedRect(x, y, w, h, 8).lineWidth(0.8).strokeColor(LINHA).stroke();
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8.5).text(titulo.toUpperCase(), x + pad, y + 7, { characterSpacing: 0.5, width: w - pad * 2 });
      let cy = y + 26;
      for (const [k, v] of rows) {
        doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(k.toUpperCase(), x + pad, cy);
        cy += 10;
        doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10).text(v || '—', x + pad, cy, { width: w - pad * 2 });
        cy += doc.heightOfString(v || '—', { width: w - pad * 2 }) + 5;
      }
      return h;
    };
    const endComprador = [filialCompra?.logradouro, filialCompra?.numeroEndereco, filialCompra?.bairro, filialCompra?.municipio ? `${filialCompra.municipio}${filialCompra.uf ? '/' + filialCompra.uf : ''}` : ''].filter(Boolean).join(' · ') || '—';
    const gap = 14, cw = (CW - gap) / 2, y0 = doc.y + 2;
    const h1 = card(X, y0, cw, 'Comprador (nosso CNPJ)', [['Empresa', filialCompra?.nome ?? '—'], ['CNPJ', filialCompra?.cnpj ?? '—'], ['Endereço', endComprador]]);
    const h2 = card(X + cw + gap, y0, cw, 'Fornecedor', [['Nome', oc.fornecedor.nome], ['CNPJ/CPF', oc.fornecedor.cnpjCpf ?? '—'], ['Contato', [oc.fornecedor.contato ?? oc.fornecedor.telefone, oc.fornecedor.cidadeUf].filter(Boolean).join(' · ') || '—']]);
    doc.y = y0 + Math.max(h1, h2) + 14; doc.x = X;

    // Título de seção compacto (sublinhado dourado).
    const tituloSecao = (t: string) => { doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text(t.toUpperCase(), X, doc.y, { characterSpacing: 0.5 }); doc.moveTo(X, doc.y + 2).lineTo(W - X, doc.y + 2).lineWidth(0.6).strokeColor(LINHA).stroke(); doc.moveDown(0.6); doc.fillColor(TINTA); };

    // ===== ITEM =====
    tituloSecao('Item');
    const grade = (oc.grade && typeof oc.grade === 'object') ? (oc.grade as Record<string, number>) : null;
    const linhaForn = [oc.codigoFornecedor ? oc.codigoFornecedor : '', oc.descricaoFornecedor ? oc.descricaoFornecedor : ''].filter(Boolean).join('  ·  ');
    const iy = doc.y + 2;
    const hDesc = doc.font('Helvetica-Bold').fontSize(11).heightOfString(oc.descricao, { width: CW - 24 });
    const hForn = linhaForn ? doc.font('Helvetica').fontSize(9).heightOfString(linhaForn, { width: CW - 24 }) : 0;
    const cardH = 12 + hDesc + (linhaForn ? hForn + 5 : 0) + 8;
    doc.roundedRect(X, iy, CW, cardH, 8).fillColor('#fbf9f3').fill();
    doc.roundedRect(X, iy, CW, cardH, 8).lineWidth(0.8).strokeColor(LINHA).stroke();
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11).text(oc.descricao, X + 12, iy + 9, { width: CW - 24 });
    if (linhaForn) {
      doc.fillColor(CINZA).font('Helvetica').fontSize(9).text('No fornecedor:  ', X + 12, iy + 9 + hDesc + 4, { continued: true }).fillColor(TINTA).font('Helvetica-Bold').text(linhaForn, { width: CW - 24 });
    }
    doc.y = iy + cardH + 10; doc.x = X;

    // Grade por tamanho (mini-tabela) — quando houver.
    if (grade && Object.keys(grade).length) {
      const ESC = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
      const ordTam = (a: string, b: string) => { const A = a.toUpperCase(), B = b.toUpperCase(); const na = Number(A), nb = Number(B); if (!isNaN(na) && !isNaN(nb)) return na - nb; const i = ESC.indexOf(A), j = ESC.indexOf(B); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); };
      doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8).text('GRADE POR TAMANHO', X, doc.y); doc.moveDown(0.2);
      gradeTabela(doc, Object.entries(grade).sort((x, y) => ordTam(x[0], y[0])).map(([t, q]) => [t, String(q)] as [string, string]));
    }

    // Faixa Qtd · Valor unit · Total do item.
    const valorUnit = Number(oc.quantidade) > 0 ? Number(oc.valor) / Number(oc.quantidade) : Number(oc.valor);
    const ry = doc.y + 2;
    doc.roundedRect(X, ry, CW, 26, 6).lineWidth(0.8).strokeColor(LINHA).stroke();
    const col = CW / 3;
    const cell = (i: number, lab: string, valTxt: string) => { const cx = X + i * col; doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(lab, cx + 10, ry + 4); doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11).text(valTxt, cx + 10, ry + 13); if (i > 0) doc.moveTo(cx, ry + 3).lineTo(cx, ry + 23).lineWidth(0.5).strokeColor(LINHA).stroke(); };
    cell(0, 'QUANTIDADE', `${this.qtdBR(oc.quantidade)} ${oc.unidade}`); cell(1, 'VALOR UNIT.', money(valorUnit)); cell(2, 'TOTAL DO ITEM', money(oc.valor));
    doc.y = ry + 26 + 12; doc.x = X;

    // Valor do pedido — barra azul-marinho.
    const ty = doc.y; doc.roundedRect(X, ty, CW, 34, 8).fillColor(NAVY).fill();
    doc.fillColor('#cdd6e6').font('Helvetica').fontSize(9).text('VALOR DO PEDIDO', X + 14, ty + 12);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(money(oc.valor), X, ty + 8, { width: CW - 14, align: 'right' });
    doc.y = ty + 34 + 14; doc.x = X;

    // ===== CONDIÇÕES: 3 chips (o pagamento vai num bloco proprio, que cabe tudo) =====
    tituloSecao('Condições');
    const sitTxt: Record<string, string> = { aguardando: 'Aguardando', enviada: 'Enviada', comprado: 'Comprado', pago: 'Pago', recebido: 'Recebido' };
    const sit = oc.status === 'recebida' ? 'Recebido' : (sitTxt[oc.situacao ?? 'aguardando'] ?? 'Aguardando');
    const sitCor = (sit === 'Pago' || sit === 'Recebido') ? '#1e7a44' : TINTA;
    const cy2 = doc.y + 2, cW3 = (CW - 2 * 8) / 3;
    const chip = (i: number, lab: string, val: string, cor: string) => { const cx = X + i * (cW3 + 8); doc.roundedRect(cx, cy2, cW3, 40, 6).fillColor(BGSOFT).fill(); doc.roundedRect(cx, cy2, cW3, 40, 6).lineWidth(0.7).strokeColor(LINHA).stroke(); doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(lab, cx + 10, cy2 + 7, { width: cW3 - 20 }); doc.fillColor(cor).font('Helvetica-Bold').fontSize(12).text(val, cx + 10, cy2 + 19, { width: cW3 - 20 }); };
    chip(0, 'SITUAÇÃO', sit, sitCor);
    chip(1, 'PRAZO', oc.prazoEntregaDias != null ? `${oc.prazoEntregaDias} dias` : '—', TINTA);
    chip(2, 'PREVISÃO', dataBR(oc.previsaoEntrega ?? oc.previsao), TINTA);
    doc.y = cy2 + 40 + 12; doc.x = X;

    // Dados para pagamento — o FAVORECIDO é o FORNECEDOR (nós compramos e pagamos a ele).
    const fornForn: any = oc.fornecedor;
    const pgLinhas = [
      `Favorecido: ${fornForn.nome}${fornForn.cnpjCpf ? ` · ${fornForn.cnpjCpf}` : ''}`,
      fornForn.dadosBancarios?.trim() ? fornForn.dadosBancarios.trim() : '',
      fornForn.chavePix?.trim() ? `PIX: ${fornForn.chavePix.trim()}` : '',
    ].filter(Boolean).join('\n');
    {
      const txtH = doc.font('Helvetica').fontSize(9.5).heightOfString(pgLinhas, { width: CW - 20 });
      const by = doc.y, bh = 22 + txtH + 8;
      doc.roundedRect(X, by, CW, bh, 6).fillColor(BGSOFT).fill();
      doc.roundedRect(X, by, CW, bh, 6).lineWidth(0.7).strokeColor(LINHA).stroke();
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('DADOS PARA PAGAMENTO AO FORNECEDOR', X + 10, by + 7, { characterSpacing: 0.5 });
      doc.fillColor(TINTA).font('Helvetica').fontSize(9.5).text(pgLinhas, X + 10, by + 19, { width: CW - 20, lineGap: 1.5 });
      doc.y = by + bh + 12; doc.x = X;
    }

    if (oc.motivo) { tituloSecao('Observações'); doc.fillColor('#4a463c').font('Helvetica').fontSize(9.5).text(oc.motivo, X, doc.y, { width: CW, lineGap: 1.5 }); doc.moveDown(1); doc.x = X; }

    assinaturas(doc, `${filialCompra?.nome ?? 'GRUPO CHERKESIAN'} — Compras`, `${oc.fornecedor.nome} — De acordo`);
    rodapeGrupo(doc);
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
      // Quem levou a mercadoria: é por aqui que se cobra a entrega e se rastreia
      // a carga depois. Preenchido obrigatoriamente no despacho.
      ['Transporte', exp.transportadora ?? '—'],
      ['Rastreio', exp.rastreio ?? '—'],
      ['Lote consumido', lote?.codigoLote ?? '—'],
      ['Data', dataBR(exp.data)],
    ]);

    // Itens · grade de tamanhos, SEM valores. Mostra APENAS o que foi enviado NESTA
    // expedição (snapshot exp.itens); só cai no pedido inteiro se não houver snapshot.
    const snap = exp.itens as Array<{ descricao: string; cor?: string | null; quantidade: number; grade?: Record<string, number> | null; pedidoItemId?: number }> | null;
    const itens = (snap && snap.length)
      ? snap
      : (pedido ? (await this.prisma.pedido.findUnique({ where: { id: pedido.id }, include: { itens: true } }))?.itens ?? [] : []);
    if (itens.length) {
      const ESCADA = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'ÚNICO'];
      const presentes = new Set<string>();
      for (const i of itens) {
        const g = i.grade as Record<string, number> | null;
        if (g && Object.keys(g).length) Object.entries(g).forEach(([t, q]) => { if (Number(q) > 0) presentes.add(t.toUpperCase()); });
        else presentes.add('ÚNICO');
      }
      const sizes = ESCADA.filter((s) => presentes.has(s)).concat([...presentes].filter((s) => !ESCADA.includes(s)));
      const totBySize: Record<string, number> = {};
      let totPecas = 0;
      const rows = itens.map((i, idx) => {
        const g = (i.grade as Record<string, number> | null) ?? null;
        const q: Record<string, number> = {};
        const add = (t: string, v: number) => { if (v > 0) { q[t] = (q[t] || 0) + v; totBySize[t] = (totBySize[t] || 0) + v; totPecas += v; } };
        if (g && Object.keys(g).length) Object.entries(g).forEach(([t, v]) => add(t.toUpperCase(), Number(v) || 0));
        else add('ÚNICO', i.quantidade);
        return { num: String(idx + 1).padStart(2, '0'), codigo: null as string | null, descricao: i.descricao, cor: (i as { cor?: string | null }).cor ?? null, qtyBySize: q, vUnit: '', vTotal: '' };
      });
      // Instrução clara de SEPARAÇÃO: mostra a quantidade DESTA remessa (evita
      // confundir o separador com o total do pedido em expedições parciais).
      const pedItens = pedido
        ? await this.prisma.pedidoItem.findMany({ where: { pedidoId: pedido.id }, select: { id: true, descricao: true, quantidade: true, quantidadeExpedida: true } })
        : [];
      /**
       * JÁ EXPEDIDO vem das EXPEDIÇÕES do pedido, não do contador `quantidadeExpedida`.
       * O contador é mantido em vários pontos (criação, ajuste ao conferido, estorno,
       * retificação do pedido) e pode dessincronizar — aconteceu no PV55, que tinha
       * 609 peças despachadas de fato e o contador zerado, e o romaneio saiu com
       * "já expedido 0 / falta = pedido inteiro" em todas as linhas.
       * Somar os snapshots é a fonte que não mente: é o que cada remessa levou.
       */
      const expedidoPorItem = new Map<number, number>();
      if (pedido) {
        const exps = await this.prisma.expedicao.findMany({
          where: { pedidoId: pedido.id, status: { not: 'Cancelada' } },
          select: { itens: true },
        });
        for (const e of exps) {
          for (const s of ((e.itens as Array<{ pedidoItemId?: number; quantidade?: number }> | null) ?? [])) {
            if (s.pedidoItemId == null) continue;
            expedidoPorItem.set(s.pedidoItemId, (expedidoPorItem.get(s.pedidoItemId) ?? 0) + Number(s.quantidade || 0));
          }
        }
      }
      const pedidoTotalPecas = pedItens.reduce((s, i) => s + i.quantidade, 0);
      const parcial = pedidoTotalPecas > totPecas;
      secao(doc, `Separar para esta expedição · ${totPecas} peça(s)`);
      if (parcial) {
        doc.fillColor('#9a5a00').font('Helvetica-Bold').fontSize(9.5).text(`ATENÇÃO — Expedição PARCIAL: separe ${totPecas} de ${pedidoTotalPecas} peças do pedido. Não envie o restante nesta remessa.`, 50, doc.y, { width: doc.page.width - 100 });
        doc.moveDown(0.4);
        doc.fillColor('#222222').font('Helvetica').fontSize(10);
      }
      pedidoGradeTabela(doc, { sizes, rows, totBySize, totPecas, totValor: '' }, { semValor: true });

      // Rastro do parcial: por item — Pedido / Esta remessa / Já expedido / Falta.
      if (parcial && pedItens.length) {
        const porItem = new Map(pedItens.map((i) => [i.id, i]));
        // Esta remessa por pedidoItemId (do snapshot); fallback: casa por descrição.
        const remessaPorItem = new Map<number, number>();
        (snap ?? []).forEach((s) => { if (s.pedidoItemId) remessaPorItem.set(s.pedidoItemId, (remessaPorItem.get(s.pedidoItemId) ?? 0) + Number(s.quantidade || 0)); });
        let tPed = 0, tRem = 0, tExp = 0, tFalta = 0;
        const linhas = pedItens.map((i, idx) => {
          const rem = remessaPorItem.get(i.id) ?? 0;
          // Inclui ESTA remessa (o snapshot dela já entrou na soma) — é o que faz o
          // "falta" descontar o que está saindo agora, e não só o que já saiu antes.
          const jaExp = Math.max(expedidoPorItem.get(i.id) ?? 0, i.quantidadeExpedida ?? 0);
          const falta = Math.max(0, i.quantidade - jaExp);
          tPed += i.quantidade; tRem += rem; tExp += jaExp; tFalta += falta;
          return [String(idx + 1).padStart(2, '0'), i.descricao, String(i.quantidade), String(rem), String(jaExp), String(falta)];
        });
        linhas.push(['', 'TOTAL', String(tPed), String(tRem), String(tExp), String(tFalta)]);
        secao(doc, 'Rastreio do pedido (parcial)');
        tabela(
          doc,
          [
            { titulo: '#', largura: 26 },
            { titulo: 'Descrição', largura: 209 },
            { titulo: 'Pedido', largura: 60, alinhamento: 'right' },
            { titulo: 'Esta remessa', largura: 80, alinhamento: 'right' },
            { titulo: 'Já expedido', largura: 70, alinhamento: 'right' },
            { titulo: 'Falta', largura: 50, alinhamento: 'right' },
          ],
          linhas,
        );
      }
    }

    secao(doc, 'Transporte');
    camposDuplos(doc, [
      ['Transportadora', exp.transportadora ?? '—'],
      ['Rastreio', exp.rastreio ?? '—'],
      ['Nota fiscal', exp.nf ?? '—'],
      ['Status', exp.status],
    ]);
    // Instruções de entrega / etiquetagem do pedido — o packing confere aqui.
    this.secaoEntrega(doc, pedido?.instrucoesEntrega);
    // CARIMBO DE IMPRESSÃO. O romaneio lê "já expedido"/"falta" do banco VIVO a cada
    // impressão, então duas vias impressas em momentos diferentes mostram números
    // diferentes — e sem a hora não dá para saber qual é a atual. Já aconteceu de um
    // papel antigo em mãos divergir da tela e ninguém conseguir datar a diferença.
    const agora = new Date();
    const carimbo = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (doc.y + 40 > doc.page.height - 80) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor('#9a5a00').font('Helvetica-Bold').fontSize(8.5)
      .text(`Impresso em ${carimbo} — os números de "já expedido" e "falta" valem para ESTE instante.`, 50, doc.y, { width: doc.page.width - 100 });
    doc.fillColor('#666666').font('Helvetica').fontSize(8)
      .text('Se esta via for antiga, reimprima antes de embarcar: uma via reimpressa mantém o mesmo número de romaneio.', 50, doc.y + 1, { width: doc.page.width - 100 });
    doc.fillColor('#222222').font('Helvetica').fontSize(10);
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

  /**
   * FICHA TÉCNICA no layout do cliente. Página A4 desenhada em posição absoluta
   * (não no fluxo padrão de documento), porque o desenho é fixo: duas colunas,
   * faixa de rodapé, títulos na cor da marca. As medidas vieram da ficha de
   * referência aprovada.
   */
  private async pdfFichaTecnica(produtoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const produto = await this.prisma.produto.findUnique({
      where: { id: produtoId },
      include: { medidas: { orderBy: { ordem: 'asc' } } },
    });
    if (!produto || produto.empresaId !== empresaId) {
      throw new NotFoundException(`Produto ${produtoId} não encontrado.`);
    }
    const cliente = produto.clienteId
      ? await this.prisma.cliente.findUnique({ where: { id: produto.clienteId }, select: { nome: true, fantasia: true } })
      : null;

    // Paleta da ficha de referência.
    const LARANJA = '#d9692b', AZUL = '#1e88e5', ONIX = '#141414', CINZA = '#6b6b6b', ZEBRA = '#f6f6f6';
    const doc = novoDocumentoLimpo('Ficha Técnica', numero);
    const W = doc.page.width, H = doc.page.height;
    const M = 34, LARG = W - M * 2;
    const txt = (t: string, x: number, y: number, o: Record<string, unknown> = {}) => doc.text(String(t ?? ''), x, y, { lineBreak: false, ...o });

    // ===== Cabeçalho (fundo branco, marca à esquerda, tagline à direita) =====
    let logoOk = false;
    const logo = produto.fotoModelo ? null : null; // o logo da empresa é aplicado por setLogoDoc; aqui usamos a marca textual
    void logo;
    if (!logoOk) {
      doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(19);
      txt('HC', M, 42);
      doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(9.5);
      txt('Q U A L I T Y   C O R P O R A T E', M + 38, 40);
      doc.fillColor(AZUL).font('Helvetica').fontSize(6.5);
      txt('P R O F E S S I O N A L   W O R K W E A R   &   H E A L T H', M + 38, 56);
      logoOk = true;
    }
    doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(7.5);
    ['UNIFORMES', 'PROFISSIONAIS', 'E EPIS PARA', 'UM AMBIENTE', 'MAIS SEGURO.'].forEach((l, i) =>
      doc.text(l, W - M - 150, 20 + i * 10, { width: 150, align: 'right', lineBreak: false }));

    // ===== Título =====
    doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(15);
    txt('FICHA TÉCNICA DO PRODUTO', M, 118);
    doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(8.5);
    doc.text(`Ref.: ${produto.codigo}${produto.revisao ? `  |  Rev. ${produto.revisao}` : ''}`, W - M - 240, 120, { width: 240, align: 'right', lineBreak: false });
    doc.fillColor(CINZA).font('Helvetica').fontSize(7.5);
    doc.text(`Emissão: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, W - M - 240, 132, { width: 240, align: 'right', lineBreak: false });
    doc.moveTo(M, 146).lineTo(W - M, 146).lineWidth(0.8).strokeColor(LARANJA).stroke();

    // ===== Cliente / Projeto =====
    const rot = (t: string, x: number, y: number) => { doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(7.5); txt(t, x, y); };
    const val = (t: string, x: number, y: number, larg: number) => {
      doc.fillColor(CINZA).font('Helvetica').fontSize(9);
      doc.text(String(t ?? '—'), x, y, { width: larg, lineBreak: false, ellipsis: true });
    };
    rot('CLIENTE', M, 160);
    val(cliente?.nome ?? produto.clienteGrupo ?? produto.marca ?? '—', M, 172, 240);
    rot('PROJETO', 286, 160);
    val(produto.projeto ?? produto.descricao, 286, 172, W - M - 286);

    // ===== Coluna esquerda: vista frontal =====
    const COL_E = M, COL_D = 286, LARG_D = W - M - COL_D;
    let yE = 196;
    if (produto.fotoModelo) {
      const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/s.exec(produto.fotoModelo);
      if (m) { try { doc.image(Buffer.from(m[1], 'base64'), COL_E, yE, { fit: [236, 300], align: 'center' }); } catch { /* imagem inválida */ } }
      yE += 306;
      doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(8);
      doc.text('VISTA FRONTAL', COL_E, yE, { width: 236, align: 'center', lineBreak: false });
    }

    // ===== Coluna direita: personalização + especificações =====
    let yD = 196;
    const aplicacoes = Array.isArray(produto.aplicacoes)
      ? (produto.aplicacoes as Array<{ tipo?: string; tamanho?: string; local?: string }>)
      : [];
    if (aplicacoes.length || produto.mapaDtf) {
      doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(9);
      txt('DETALHE DA PERSONALIZAÇÃO', COL_D, yD);
      yD += 16;
      let xTab = COL_D;
      if (produto.mapaDtf && /^data:image\//i.test(produto.mapaDtf)) {
        const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/s.exec(produto.mapaDtf);
        if (m) { try { doc.image(Buffer.from(m[1], 'base64'), COL_D, yD, { fit: [92, 92] }); xTab = COL_D + 100; } catch { /* ignora */ } }
      }
      // Só o que está cadastrado. Nada de "Logomarca 1" ou "conforme manual da
      // marca": a ficha vai assinada pelo cliente, então não pode afirmar o que
      // ninguém preencheu.
      const pares: Array<[string, string]> = aplicacoes.length
        ? aplicacoes.slice(0, 6).map((a, i): [string, string] => [
            aplicacoes.length > 1 ? `ARTE ${i + 1}` : 'ARTE',
            [a.tipo, a.tamanho, a.local].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ') || '—',
          ])
        : [['MAPA', produto.mapaDtfNome ?? 'anexado ao produto']];
      pares.forEach(([r, v], i) => {
        const y = yD + i * 15;
        doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(6.5); txt(r, xTab, y);
        doc.fillColor(LARANJA).font('Helvetica').fontSize(7.5);
        doc.text(v, xTab + 50, y - 1, { width: W - M - (xTab + 50), lineBreak: false, ellipsis: true });
      });
      yD += 15 * pares.length + 14;
    }

    // Especificações da peça (tabela zebrada de duas colunas)
    const espec: Array<[string, string]> = [['Peça', produto.descricao], ['Cor', produto.cor ?? '—']];
    if (produto.modelagem) espec.push(['Modelagem', produto.modelagem]);
    for (const l of String(produto.detalhes ?? '').split('\n')) {
      const t = l.trim(); if (!t) continue;
      const i = t.indexOf(':');
      espec.push(i > 0 ? [t.slice(0, i).trim(), t.slice(i + 1).trim()] : ['—', t]);
    }
    if (produto.tecido) espec.push(['Tecido', produto.tecido]);
    if (produto.composicao) espec.push(['Composição', produto.composicao]);
    if (produto.grade) espec.push(['Grade', produto.grade]);

    doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(9);
    txt('ESPECIFICAÇÕES DA PEÇA', COL_D, yD);
    yD += 14;
    espec.forEach(([r, v], i) => {
      const y = yD + i * 13.4;
      if (i % 2 === 0) doc.rect(COL_D, y - 2, LARG_D, 13.4).fill(ZEBRA);
      doc.fillColor(ONIX).font('Helvetica-Bold').fontSize(7); txt(r, COL_D + 8, y + 1.5);
      doc.fillColor(CINZA).font('Helvetica').fontSize(7);
      doc.text(v, COL_D + 68, y + 1.5, { width: LARG_D - 76, lineBreak: false, ellipsis: true });
    });
    yD += espec.length * 13.4 + 12;

    // ===== Tabela de medidas (largura total) =====
    let y = Math.max(yE + 20, yD, 520);
    if (produto.medidas.length) {
      const tamanhos = this.tamanhosDaFicha(produto.grade, produto.medidas);
      doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8); txt('TABELA DE MEDIDAS', M, y);
      doc.fillColor(CINZA).font('Helvetica').fontSize(7);
      doc.text('Medidas da peça pronta, em cm.', M, y, { width: LARG, align: 'right', lineBreak: false });
      y += 14;
      const cLarg = 132, tLarg = (LARG - cLarg) / Math.max(1, tamanhos.length);
      doc.rect(M, y, LARG, 17).fill(ONIX);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7); txt('MEDIDA', M + 8, y + 5.5);
      tamanhos.forEach((t, i) => doc.text(t, M + cLarg + i * tLarg, y + 5.5, { width: tLarg, align: 'center', lineBreak: false }));
      y += 17;
      produto.medidas.forEach((md, i) => {
        if (i % 2 === 0) doc.rect(M, y, LARG, 17).fill(ZEBRA);
        doc.fillColor(ONIX).font('Helvetica').fontSize(7);
        doc.text(md.descricao, M + 8, y + 5.5, { width: cLarg - 12, lineBreak: false, ellipsis: true });
        tamanhos.forEach((t, j) => {
          const v = (md.valores as Record<string, unknown> | null)?.[t];
          doc.text(v == null || v === '' ? '—' : String(v), M + cLarg + j * tLarg, y + 5.5, { width: tLarg, align: 'center', lineBreak: false });
        });
        y += 17;
      });
      y += 12;
    }

    // ===== Observações =====
    const obs = [produto.especificacoes, produto.observacoes].filter((x) => String(x ?? '').trim()).join('\n');
    const notas = [
      obs,
      'Imagem ilustrativa. Tonalidade final conforme amostra física aprovada.',
    ].filter(Boolean).join('\n');
    doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8); txt('OBSERVAÇÕES', M, y);
    y += 12;
    doc.fillColor(ONIX).font('Helvetica').fontSize(7.5);
    doc.text(notas, M, y, { width: LARG });
    y = Math.max(doc.y + 14, y + 30);

    // ===== Aprovação do cliente =====
    const yAp = Math.min(y, H - 130);
    doc.rect(M, yAp, 132, 18).fill(ONIX);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5); txt('APROVAÇÃO DO CLIENTE', M + 10, yAp + 5.5);
    let xo = M + 152;
    for (const o of ['Aprovado', 'Aprovado com ajustes', 'Reprovado']) {
      doc.rect(xo, yAp + 4, 9, 9).lineWidth(0.8).strokeColor(ONIX).stroke();
      doc.fillColor(ONIX).font('Helvetica').fontSize(8); txt(o, xo + 13, yAp + 6);
      xo += 13 + doc.widthOfString(o) + 26;
    }
    const yl = yAp + 52, lw = (LARG - 32) / 3;
    ['Nome', 'Assinatura', 'Data'].forEach((r, i) => {
      const xi = M + i * (lw + 16);
      doc.moveTo(xi, yl).lineTo(xi + lw, yl).lineWidth(0.8).strokeColor('#bdbdbd').stroke();
      doc.fillColor(CINZA).font('Helvetica').fontSize(7); txt(r, xi, yl + 5);
    });

    // ===== Rodapé =====
    doc.rect(0, H - 52, W, 52).fill(ONIX);
    doc.fillColor(LARANJA).font('Helvetica-Bold').fontSize(8);
    txt('hcqualitycorp.com.br', M + 10, H - 33);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(8);
    doc.text('(11) 97620-8741', 0, H - 33, { width: W, align: 'center', lineBreak: false });
    doc.fillColor('#bdbdbd');
    doc.text('contato@hcqualitycorp.com.br', W - M - 220, H - 33, { width: 220, align: 'right', lineBreak: false });
    doc.fillColor('#8a8a8a').fontSize(6.5);
    doc.text('Q U A L I D A D E   |   S E G U R A N Ç A   |   C O N F O R T O', 0, H - 18, { width: W, align: 'center', lineBreak: false });

    return doc;
  }

  /**
   * FICHA DE PRODUÇÃO — a que fica na fábrica.
   *
   * Separada da ficha do cliente de propósito: esta carrega o que a produção
   * precisa e o cliente não deve receber (consumo de material por peça, família
   * de tecido, composição do conjunto) e o que não cabe numa folha de aprovação
   * (modelagem do Audaces, mapa de aplicação em página inteira).
   */
  private async pdfFichaProducao(produtoId: number, empresaId: number, numero: string): Promise<Pdf> {
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

    const doc = novoDocumento('Ficha de Produção', numero);

    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Código', produto.codigo],
      ['Referência', produto.referencia ?? '—'],
      ['Descrição', produto.descricao],
      ['Grupo', produto.grupo ?? produto.categoria],
      ['Marca / cliente', produto.marca ?? produto.clienteGrupo ?? '—'],
      ['Linha', produto.linha ?? '—'],
      ['Cor', produto.cor ?? '—'],
      ['Grade', produto.grade ?? '—'],
      ['Tecido', produto.tecido ?? '—'],
      ['Composição', produto.composicao ?? '—'],
      ['Modelagem (Audaces)', produto.modelagem ?? '—'],
      ['Projeto', produto.projeto ?? '—'],
      ['Revisão', produto.revisao ?? '—'],
      // Preço NÃO entra: ficha técnica, não comercial.
    ]);

    if (produto.fotoModelo) {
      secao(doc, 'Modelo');
      imagem(doc, produto.fotoModelo, 230);
    }

    if (produto.especificacoes?.trim()) {
      secao(doc, 'Especificações de confecção / costura');
      textoBloco(doc, produto.especificacoes);
    }

    // Detalhes de construção (mesmo campo que vira a tabela da ficha do cliente).
    const detalhes = String(produto.detalhes ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (detalhes.length) {
      secao(doc, 'Detalhes de construção', 28 + detalhes.length * 22);
      tabela(
        doc,
        [
          { titulo: 'Item', largura: 150 },
          { titulo: 'Especificação', largura: 345 },
        ],
        detalhes.map((l) => {
          const i = l.indexOf(':');
          return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ['—', l];
        }),
      );
    }

    // Composição do conjunto (peças componentes) definida na Receita técnica.
    const componentes = Array.isArray(produto.componentes)
      ? (produto.componentes as Array<{ produtoId?: number; quantidade?: number }>)
      : [];
    if (componentes.length) {
      const ids = [...new Set(componentes.map((c) => c.produtoId).filter((x): x is number => !!x))];
      const pcs = ids.length
        ? await this.prisma.produto.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true, descricao: true } })
        : [];
      const pmap = new Map(pcs.map((p) => [p.id, p]));
      secao(doc, 'Composição do conjunto', 28 + componentes.length * 22);
      tabela(
        doc,
        [
          { titulo: 'Código', largura: 110 },
          { titulo: 'Peça componente', largura: 290 },
          { titulo: 'Qtd / conjunto', largura: 95, alinhamento: 'right' },
        ],
        componentes.map((c) => {
          const p = c.produtoId ? pmap.get(c.produtoId) : null;
          return [p?.codigo ?? `#${c.produtoId ?? '—'}`, p?.descricao ?? '—', String(c.quantidade ?? 1)];
        }),
      );
    }

    const aplicacoes = Array.isArray(produto.aplicacoes)
      ? (produto.aplicacoes as Array<{ tipo?: string; tamanho?: string; local?: string }>)
      : [];
    if (aplicacoes.length) {
      secao(doc, 'Aplicações (bordado / DTF / silk)', 28 + aplicacoes.length * 22);
      tabela(
        doc,
        [
          { titulo: 'Aplicação', largura: 140 },
          { titulo: 'Tamanho', largura: 160 },
          { titulo: 'Local', largura: 195 },
        ],
        aplicacoes.map((a) => [a.tipo ?? '—', a.tamanho ?? '—', a.local ?? '—']),
      );
    }

    // MAPA DE APLICAÇÃO DTF — em página inteira, que é o que chega na mão de quem
    // aplica. A tabela acima diz o tamanho; o mapa diz ONDE cada arte entra na peça,
    // e sem ele o setor de DTF tem que adivinhar o posicionamento.
    if (produto.mapaDtf) {
      const ehImagem = /^data:image\//i.test(produto.mapaDtf);
      secao(doc, 'Mapa de aplicação (DTF / bordado)');
      if (ehImagem) {
        imagem(doc, produto.mapaDtf, 330);
        doc.moveDown(0.3);
        doc.fillColor('#666666').font('Helvetica').fontSize(8)
          .text('Confira uma amostra física antes da produção em série.', 50, doc.y, { width: doc.page.width - 100 });
        doc.fillColor('#222222').fontSize(10);
      } else {
        // PDF não entra como página aqui — avisa em vez de sumir com o anexo.
        doc.fillColor('#9a5a00').font('Helvetica-Bold').fontSize(9)
          .text(`Mapa anexado ao produto: ${produto.mapaDtfNome ?? 'arquivo'} — abra pelo cadastro do produto (não é imagem, por isso não entra nesta página).`, 50, doc.y, { width: doc.page.width - 100 });
        doc.fillColor('#222222').font('Helvetica').fontSize(10);
      }
    }

    if (produto.medidas.length) {
      secao(doc, 'Tabela de medidas', 30 + produto.medidas.length * 20);
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
    } else {
      // Dizer que falta é melhor do que entregar a ficha sem a seção e deixar a
      // costura medir no olho.
      secao(doc, 'Tabela de medidas');
      doc.fillColor('#9a5a00').font('Helvetica-Bold').fontSize(9)
        .text('Sem tabela de medidas cadastrada — preencha no cadastro do produto, aba Ficha técnica.', 50, doc.y, { width: doc.page.width - 100 });
      doc.fillColor('#222222').font('Helvetica').fontSize(10);
    }

    if (bom.length) {
      secao(doc, 'Materiais / consumo por peça', 28 + bom.length * 22);
      tabela(
        doc,
        [
          { titulo: 'Material', largura: 95 },
          { titulo: 'Descrição', largura: 250 },
          { titulo: 'Un.', largura: 50 },
          { titulo: 'Consumo', largura: 100, alinhamento: 'right' },
        ],
        bom.map((b) => [
          b.material?.codigo ?? '—',
          b.material?.descricao ?? (b.familia ? b.familia + ' (família — cor do pedido)' : '—'),
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

    assinaturas(doc, 'GRUPO CHERKESIAN — Modelagem/PCP', 'Produção — Conferido');
    return doc;
  }

  /** Demonstrativo de cobrança: títulos EM ABERTO do cliente, com o nº da NF de
   *  origem, vencimento, valor/recebido/saldo, total e a linha do PIX. */
  private async pdfCobranca(clienteId: number, empresaId: number, numero: string, ids: number[] = []): Promise<Pdf> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    }
    const titulos = await this.prisma.contaReceber.findMany({
      where: { empresaId, clienteId },
      orderBy: { vencimento: 'asc' },
    });
    let abertos = titulos.filter((t) => Number(t.valor) - Number(t.pago) > 0.005);
    // Seleção: o demonstrativo sai SÓ com os títulos escolhidos na tela. Sem
    // seleção, continua valendo tudo o que o cliente tem em aberto.
    if (ids.length) {
      const escolhidos = new Set(ids);
      const fora = ids.filter((id) => !titulos.some((t) => t.id === id));
      if (fora.length) {
        throw new BadRequestException(`Título(s) ${fora.join(', ')} não pertencem a ${cliente.nome}.`);
      }
      abertos = abertos.filter((t) => escolhidos.has(t.id));
      if (!abertos.length) throw new BadRequestException('Os títulos selecionados já estão quitados — não há o que cobrar.');
    }
    const nfIds = [...new Set(abertos.map((t) => t.notaFiscalId).filter((x): x is number => x != null))];
    const nfs = nfIds.length
      ? await this.prisma.notaFiscal.findMany({ where: { id: { in: nfIds } }, select: { id: true, numero: true } })
      : [];
    const nfMap = new Map(nfs.map((n) => [n.id, n.numero]));

    const doc = novoDocumento('Demonstrativo de Cobrança', numero);
    secao(doc, 'Cliente');
    camposDuplos(doc, [
      ['Razão social / nome', cliente.nome],
      ['CNPJ/CPF', cliente.cnpjCpf ?? '—'],
      ['Cidade/UF', cliente.cidadeUf ?? '—'],
      ['Contato', cliente.contato ?? cliente.telefone ?? '—'],
    ]);

    const hoje0 = new Date();
    hoje0.setHours(0, 0, 0, 0);
    let totalSaldo = 0;
    let totalVencido = 0;
    const rows = abertos.map((t) => {
      const saldo = Number(t.valor) - Number(t.pago);
      totalSaldo += saldo;
      const venc = new Date(t.vencimento);
      const vencido = venc.getTime() < hoje0.getTime();
      if (vencido) totalVencido += saldo;
      const nf = (t.notaFiscalId ? nfMap.get(t.notaFiscalId) : null) ?? t.documento ?? '—';
      return [nf, dataBR(t.vencimento) + (vencido ? ' (vencido)' : ''), money(t.valor), money(t.pago), money(saldo)];
    });

    secao(doc, 'Títulos em aberto', 28 + abertos.length * 22);
    if (rows.length) {
      tabela(
        doc,
        [
          { titulo: 'NF / Doc.', largura: 110 },
          { titulo: 'Vencimento', largura: 130 },
          { titulo: 'Valor', largura: 95, alinhamento: 'right' },
          { titulo: 'Recebido', largura: 90, alinhamento: 'right' },
          { titulo: 'Saldo', largura: 70, alinhamento: 'right' },
        ],
        rows,
      );
    } else {
      textoBloco(doc, 'Não há títulos em aberto para este cliente no momento. Obrigado!');
    }

    totalDestaque(doc, 'Total em aberto', money(totalSaldo));
    if (totalVencido > 0) totalDestaque(doc, 'Total vencido', money(totalVencido));

    // Linha de pagamento (PIX): usa a filial de um dos títulos ou a matriz.
    const filialId = abertos.find((t) => t.filialId)?.filialId ?? null;
    const linhaPix = await this.linhaPagamento(empresaId, filialId);
    if (linhaPix) {
      secao(doc, 'Pagamento');
      textoBloco(doc, linhaPix);
    }

    rodapeGrupo(doc);
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

  /**
   * FICHA DE PEÇA PILOTO — documento para enviar à piloteira JUNTO com o produto/molde.
   * Traz a identificação da amostra, referência de modelagem, cor, foto do modelo,
   * especificações de costura e a tabela de medidas do produto (quando houver).
   */
  private async pdfPiloto(pilotoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const piloto = await this.prisma.piloto.findUnique({ where: { id: pilotoId } });
    if (!piloto || (piloto.empresaId != null && piloto.empresaId !== empresaId)) {
      throw new NotFoundException(`Peça piloto ${pilotoId} não encontrada.`);
    }
    const produto = piloto.produtoId
      ? await this.prisma.produto.findUnique({ where: { id: piloto.produtoId }, include: { medidas: { orderBy: { ordem: 'asc' } } } })
      : null;
    if (produto && produto.empresaId !== empresaId) {
      throw new NotFoundException(`Peça piloto ${pilotoId} não encontrada.`);
    }
    const cliente = piloto.clienteId ? await this.prisma.cliente.findUnique({ where: { id: piloto.clienteId }, select: { nome: true } }) : null;
    const pedido = piloto.pedidoId ? await this.prisma.pedido.findUnique({ where: { id: piloto.pedidoId }, select: { numero: true } }) : null;

    const doc = novoDocumento('Ficha de Peça Piloto', numero);
    secao(doc, 'Identificação');
    camposDuplos(doc, [
      ['Piloto', piloto.codigo],
      ['Pedido de origem', pedido?.numero ?? '—'],
      ['Cliente', cliente?.nome ?? piloto.clienteNome ?? '—'],
      ['Tentativa', `${piloto.tentativa ?? 1}ª`],
      ['Status', String(piloto.status ?? '—').replace(/_/g, ' ')],
      ['Setor de uso', piloto.setor ?? '—'],
      ['Solicitado em', dataBR(piloto.solicitacao)],
      ['Enviado à piloteira em', dataBR(piloto.envio)],
      ['Prazo de retorno', dataBR(piloto.prazoRetorno)],
      ['Emitido em', dataBR(new Date())],
    ]);

    // Briefing completo (quando preenchido): renderiza as seções/campos respondidos.
    const brief = piloto.briefing as { produto?: string; secoes?: Array<{ sec: string; campos: Array<{ label: string; unid?: string; valor?: string }> }> } | null;
    const temBriefing = !!(brief && Array.isArray(brief.secoes) && brief.secoes.length);
    if (temBriefing) {
      if (piloto.briefingProduto) {
        secao(doc, 'Produto do briefing');
        camposDuplos(doc, [['Tipo', piloto.briefingProduto], ['Revisão', (brief as { revisao?: string }).revisao ?? 'Rev.01']]);
      }
      for (const s of brief!.secoes!) {
        const preenchidos = (s.campos || []).filter((c) => c.valor != null && String(c.valor).trim() !== '');
        if (!preenchidos.length) continue;
        if (doc.y > doc.page.height - 140) doc.addPage();
        secao(doc, s.sec);
        camposDuplos(doc, preenchidos.map((c) => [c.label + (c.unid ? ` (${c.unid})` : ''), String(c.valor)] as [string, string]));
      }
    } else {
      secao(doc, 'Peça / modelagem');
      camposDuplos(doc, [
        ['Produto', produto ? `${produto.codigo} — ${produto.descricao}` : '—'],
        ['Referência de modelagem', piloto.modelagem ?? produto?.modelagem ?? '—'],
        ['Artigo / tecido', piloto.artigo ?? produto?.tecido ?? '—'],
        ['Marca / fornecedor', piloto.marca ?? produto?.marca ?? '—'],
        ['Cor', piloto.cor ?? produto?.cor ?? '—'],
        ['Grade', produto?.grade ?? '—'],
      ]);
    }

    // Tabela de medidas do briefing (Especificado × Medido → desvio + OK/FORA).
    const meds = (brief as { medidas?: Array<{ cod: string; ponto: string; tol: number; esp?: number | string; med?: number | string; desvio?: number | null; status?: string }> } | null)?.medidas ?? [];
    if (meds.length) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      secao(doc, 'Tabela de medidas (cm · peça pronta, mesa plana)');
      tabela(
        doc,
        [
          { titulo: 'Cód.', largura: 40 },
          { titulo: 'Ponto de medida', largura: 205 },
          { titulo: 'Tol.±', largura: 45, alinhamento: 'right' },
          { titulo: 'Especif.', largura: 60, alinhamento: 'right' },
          { titulo: 'Medido', largura: 60, alinhamento: 'right' },
          { titulo: 'Desvio', largura: 55, alinhamento: 'right' },
          { titulo: 'Status', largura: 50 },
        ],
        meds.map((m) => [
          m.cod,
          m.ponto,
          `±${m.tol}`,
          m.esp != null && m.esp !== '' ? String(m.esp) : '—',
          m.med != null && m.med !== '' ? String(m.med) : '—',
          m.desvio != null ? (m.desvio > 0 ? '+' : '') + Number(m.desvio).toFixed(2) : '—',
          m.status || '—',
        ]),
      );
    }

    // Foto do modelo (ou moldura em branco p/ anexar).
    secao(doc, 'Modelo da peça');
    if (produto?.fotoModelo) {
      imagem(doc, produto.fotoModelo, 200);
    } else {
      const x = 50, w = doc.page.width - 100, h = 120, y = doc.y + 2;
      doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).dash(3, { space: 3 }).strokeColor('#C9A227').stroke().undash();
      doc.fillColor('#a99a63').font('Helvetica').fontSize(10).text('FOTO DO MODELO (anexe a imagem / molde da peça)', x, y + h / 2 - 6, { width: w, align: 'center' });
      doc.y = y + h + 12; doc.x = x; doc.fillColor('#242a26');
    }

    if (produto?.especificacoes?.trim()) {
      secao(doc, 'Especificações de confecção / costura');
      textoBloco(doc, produto.especificacoes);
    }

    if (produto?.medidas?.length) {
      secao(doc, 'Tabela de medidas');
      const tamanhos = this.tamanhosDaFicha(produto.grade, produto.medidas);
      tabelaMedidas(
        doc,
        tamanhos,
        produto.medidas.map((m) => {
          const valores = (m.valores ?? {}) as Record<string, string>;
          return { descricao: m.descricao, tolerancia: m.tolerancia ?? '', valores: tamanhos.map((t) => (valores[t] != null ? String(valores[t]) : '')) };
        }),
      );
    }

    if (produto?.fotoModelagem) {
      secao(doc, 'Modelagem (Audaces)');
      imagem(doc, produto.fotoModelagem, 200);
    }

    if (piloto.obs?.trim()) {
      secao(doc, 'Observações');
      textoBloco(doc, piloto.obs);
    }

    // Fluxo da piloto (14 etapas) com status concluído/pendente.
    const fluxo = (brief as { fluxo?: Array<{ n: number; etapa: string; resp?: string; feito?: boolean }> } | null)?.fluxo ?? [];
    if (fluxo.length) {
      if (doc.y > doc.page.height - 180) doc.addPage();
      const feitos = fluxo.filter((f) => f.feito).length;
      secao(doc, `Fluxo da piloto — ${feitos}/${fluxo.length} etapas concluídas`);
      tabela(
        doc,
        [
          { titulo: '#', largura: 26 },
          { titulo: 'Etapa', largura: 205 },
          { titulo: 'Responsável', largura: 185 },
          { titulo: 'Status', largura: 60 },
        ],
        fluxo.map((f) => [String(f.n), f.etapa, f.resp ?? '—', f.feito ? 'Concluída' : 'Pendente']),
      );
    }

    assinaturas(doc, 'Enviado por (Cherkesian)', 'Recebido pela piloteira');
    return doc;
  }

  /**
   * FICHA TÉCNICA (rosto) da peça piloto — layout em caixas p/ impressão, estilo
   * ficha de produto: cabeçalho + referência, desenho/modelo, Produto, Tecido,
   * Aviamentos e Observações, preenchidos com o briefing quando houver.
   */
  private async pdfPilotoFicha(pilotoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const piloto = await this.prisma.piloto.findUnique({ where: { id: pilotoId } });
    if (!piloto || (piloto.empresaId != null && piloto.empresaId !== empresaId)) throw new NotFoundException(`Peça piloto ${pilotoId} não encontrada.`);
    const produto = piloto.produtoId ? await this.prisma.produto.findUnique({ where: { id: piloto.produtoId } }) : null;
    if (produto && produto.empresaId !== empresaId) throw new NotFoundException(`Peça piloto ${pilotoId} não encontrada.`);
    const cliente = piloto.clienteId ? await this.prisma.cliente.findUnique({ where: { id: piloto.clienteId }, select: { nome: true } }) : null;

    // Índice de campos do briefing por rótulo (sem acento) → valor.
    const brief = piloto.briefing as { produto?: string; secoes?: Array<{ sec: string; campos: Array<{ label: string; valor?: string }> }> } | null;
    const flat: Array<{ label: string; valor: string }> = [];
    for (const s of brief?.secoes ?? []) for (const c of s.campos ?? []) if (c.valor != null && String(c.valor).trim() !== '') flat.push({ label: c.label, valor: String(c.valor) });
    const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const campo = (...subs: string[]): string => {
      for (const sub of subs) { const f = flat.find((x) => norm(x.label).includes(norm(sub))); if (f) return f.valor; }
      return '';
    };
    const secaoCampos = (sub: string) => (brief?.secoes ?? []).find((s) => norm(s.sec).includes(norm(sub)))?.campos?.filter((c) => c.valor != null && String(c.valor).trim() !== '') ?? [];

    const doc = novoDocumento('Ficha Técnica · Peça Piloto', numero);
    const OURO = '#C9A227', TIN = '#242a26';
    const x0 = 50, W = doc.page.width - 100;
    let y = doc.y + 2;
    const box = (x: number, yy: number, w: number, h: number, titulo?: string) => {
      doc.roundedRect(x, yy, w, h, 4).lineWidth(0.8).strokeColor(OURO).stroke();
      if (titulo) { doc.fillColor('#7a5b12').font('Helvetica-Bold').fontSize(8).text(titulo.toUpperCase(), x + 6, yy + 4, { width: w - 12 }); }
      doc.fillColor(TIN);
    };
    const linhas = (x: number, yy: number, w: number, pares: Array<[string, string]>) => {
      let ly = yy;
      for (const [rot, val] of pares) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b6b6b').text(rot.toUpperCase() + ': ', x, ly, { continued: true, width: w });
        doc.font('Helvetica').fontSize(9).fillColor(TIN).text(val || '—', { width: w });
        ly = doc.y + 3;
      }
      return ly;
    };

    // Cabeçalho: título + referência
    const ref = campo('referência de modelo', 'código do modelo') || piloto.modelagem || piloto.codigo;
    doc.rect(x0, y, W, 24).fillAndStroke('#faf6ea', OURO);
    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(13).text('FICHA TÉCNICA · PEÇA PILOTO', x0 + 8, y + 6, { width: W * 0.55 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#7a5b12').text('REF.: ' + (piloto.codigo || numero) + (ref && ref !== piloto.codigo ? '  ·  ' + ref : ''), x0 + W * 0.55, y + 7, { width: W * 0.45 - 8, align: 'right' });
    y += 24 + 8;

    // Desenho / modelo da peça
    const hDes = 180;
    box(x0, y, W, hDes, 'Desenho / modelo da peça');
    if (produto?.fotoModelo) { try { doc.image(Buffer.from(String(produto.fotoModelo).split(',').pop() || '', 'base64'), x0 + 8, y + 18, { fit: [W - 16, hDes - 26], align: 'center', valign: 'center' }); } catch { /* ignora imagem inválida */ } }
    else { doc.fillColor('#a99a63').font('Helvetica').fontSize(10).text('(anexe o desenho técnico / foto — frente e costas)', x0, y + hDes / 2, { width: W, align: 'center' }); doc.fillColor(TIN); }
    y += hDes + 8;

    // Produto (esq) + Tecido (dir)
    const colH = 132, lw = W * 0.52, rw = W - lw - 10, rx = x0 + lw + 10;
    box(x0, y, lw, colH, 'Produto');
    linhas(x0 + 8, y + 18, lw - 16, [
      ['Nome', piloto.briefingProduto || produto?.descricao || campo('nome do produto') || '—'],
      ['Modelagem', campo('modelagem', 'modelo') || piloto.modelagem || '—'],
      ['Segmento / público', campo('público', 'segmento') || '—'],
      ['Grade', campo('tamanhos da piloto', 'tamanho base') || produto?.grade || '—'],
      ['Cor / variante', piloto.cor || campo('cor') || produto?.cor || '—'],
      ['Cliente', cliente?.nome || piloto.clienteNome || '—'],
    ]);
    box(rx, y, rw, colH, 'Tecido');
    linhas(rx + 8, y + 18, rw - 16, [
      ['Tecido', campo('tipo de malha', 'tipo de tecido', 'tecido') || produto?.tecido || '—'],
      ['Composição', campo('composição') || produto?.composicao || '—'],
      ['Fornecedor', campo('fornecedor') || '—'],
      ['Gramatura', campo('gramatura') || '—'],
      ['Tratamentos', campo('tratamento') || '—'],
    ]);
    y += colH + 8;

    // Aviamentos (seção do briefing) — tabela rótulo × valor
    const avi = secaoCampos('aviamentos');
    const aviRows = (avi.length ? avi.map((c) => [c.label, String(c.valor)]) : [['Linha de costura', campo('linha de costura') || ''], ['Etiqueta de marca', campo('etiqueta de marca') || ''], ['Etiqueta de composição', campo('composição e conservação') || ''], ['Embalagem', campo('embalagem individual') || '']]).filter((r) => r[1]);
    if (doc.y > doc.page.height - 200) doc.addPage();
    secao(doc, 'Aviamentos, etiquetas e embalagem');
    if (aviRows.length) {
      tabela(doc, [{ titulo: 'Item', largura: 210 }, { titulo: 'Especificação', largura: W - 210 }], aviRows.map((r) => [r[0], r[1]]));
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#8a8a8a').text('(preencher aviamentos no briefing)', x0, doc.y + 2); doc.fillColor(TIN);
    }

    // Observações
    const obs = [campo('o que o cliente não abre', 'itens críticos'), campo('observações de processo'), campo('ajustes solicitados'), piloto.obs || ''].filter(Boolean).join('  ·  ');
    secao(doc, 'Observações');
    textoBloco(doc, obs || '—');

    assinaturas(doc, 'Aprovado — Modelagem/Qualidade', 'Recebido pela piloteira');
    return doc;
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
