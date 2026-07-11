import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Documento } from '@prisma/client';
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
  gradeCaixinhas,
  money,
  novaEtiqueta,
  novoDocumento,
  secao,
  tabela,
  totalDestaque,
} from './pdf.renderer';

/** Tipos suportados nesta fase, com prefixo de numeração e área RBAC exigida. */
const TIPOS: Record<string, { titulo: string; prefixo: string; area: Area }> = {
  proposta: { titulo: 'Proposta Comercial', prefixo: 'PROP', area: 'vendas' },
  pedido: { titulo: 'Pedido de Venda', prefixo: 'PVD', area: 'vendas' },
  op: { titulo: 'Ordem de Produção', prefixo: 'OPD', area: 'producao' },
  pedido_compra: { titulo: 'Pedido de Compra', prefixo: 'OCD', area: 'compras' },
  romaneio: { titulo: 'Romaneio de Expedição', prefixo: 'ROM', area: 'expedicao' },
  ficha_medidas: { titulo: 'Ficha de Medidas', prefixo: 'MED', area: 'medidas' },
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

    const existentes = await this.prisma.documento.findMany({
      where: { tipo },
      select: { numero: true },
    });
    const numero = proximoSequencial(def.prefixo, existentes.map((d) => d.numero), {
      pad: 4,
      separador: '-',
    });

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
    if (!perfilPodeAcessar(user.acesso, def.area)) {
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
      case 'pedido_compra':
        return this.pdfCompra(referenciaId, empresaId, numero);
      case 'romaneio':
        return this.pdfRomaneio(referenciaId, empresaId, numero);
      case 'ficha_medidas':
        return this.pdfMedidas(referenciaId, empresaId, numero);
      case 'etiqueta':
        return this.pdfEtiqueta(referenciaId, empresaId, numero);
      default:
        throw new BadRequestException(`Tipo "${tipo}" não suportado.`);
    }
  }

  private async pdfPedido(tipo: string, pedidoId: number, empresaId: number, numero: string): Promise<Pdf> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { itens: true, cliente: true },
    });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${pedidoId} não encontrado.`);
    }
    const titulo = tipo === 'proposta' ? 'Proposta Comercial' : 'Pedido de Venda';
    const doc = novoDocumento(titulo, numero);

    secao(doc, 'Cliente');
    camposDuplos(doc, [
      ['Razão social / nome', pedido.cliente.nome],
      ['CNPJ/CPF', pedido.cliente.cnpjCpf ?? '—'],
      ['Contato', pedido.cliente.contato ?? pedido.cliente.telefone ?? '—'],
      ['Cidade/UF', pedido.cliente.cidadeUf ?? '—'],
    ]);

    secao(doc, 'Dados do pedido');
    camposDuplos(doc, [
      ['Número do pedido', pedido.numero],
      ['Data', dataBR(pedido.data)],
      ['Forma de pagamento', pedido.formaPagamento ?? 'a combinar'],
      ['Etapa atual', pedido.etapa],
    ]);

    secao(doc, 'Itens');
    tabela(
      doc,
      [
        { titulo: 'Descrição', largura: 265 },
        { titulo: 'Qtd', largura: 60, alinhamento: 'right' },
        { titulo: 'Valor unit.', largura: 85, alinhamento: 'right' },
        { titulo: 'Subtotal', largura: 85, alinhamento: 'right' },
      ],
      pedido.itens.map((i) => [
        i.descricao,
        String(i.quantidade),
        money(i.valorUnit),
        money(i.valorUnit.mul(i.quantidade)),
      ]),
    );
    totalDestaque(doc, 'Valor total', money(pedido.valorTotal));

    if (tipo === 'proposta') {
      secao(doc, 'Condições');
      doc.text('Proposta válida por 15 dias. Cliente novo: produção liberada após aprovação da peça-piloto.');
      assinaturas(doc, 'GRUPO CHERKESIAN', pedido.cliente.nome);
    } else {
      assinaturas(doc, 'GRUPO CHERKESIAN', `${pedido.cliente.nome} — De acordo`);
    }
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
        ['Cor', produto.cor ?? '—'],
      ]);
    }

    // Grade de tamanhos em caixinhas: usa a distribuição da OP quando definida;
    // sem distribuição, desenha os tamanhos do produto em branco (preenchimento manual).
    const grade = op.gradeTamanhos as Record<string, number> | null;
    if (grade && Object.keys(grade).length) {
      secao(doc, `Grade de tamanhos (${op.quantidade} peças)`);
      gradeCaixinhas(doc, Object.entries(grade).map(([t, q]) => [t, String(q)]));
    } else if (produto?.grade) {
      secao(doc, 'Grade de tamanhos (preencher)');
      gradeCaixinhas(doc, this.expandirGrade(produto.grade).map((t) => [t, '']));
    }

    if (bom.length) {
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
          `${b.quantidade.toFixed(3)} ${b.unidade}`,
          `${b.quantidade.mul(op.quantidade).toFixed(3)} ${b.unidade}`,
        ]),
      );
    }
    assinaturas(doc, 'PCP / Programação', 'Produção — Recebido');
    return doc;
  }

  /**
   * Expande a grade textual do produto em lista de tamanhos:
   * "PP,GA" → [PP, GA] · "PP ao G4" → escada padrão entre os extremos.
   */
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
      [[oc.descricao, oc.quantidade.toFixed(3), oc.unidade, money(oc.valor)]],
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
