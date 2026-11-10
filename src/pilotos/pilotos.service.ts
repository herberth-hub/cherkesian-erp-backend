import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Piloto, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePilotoDto } from './dto/create-piloto.dto';
import { CreatePilotoAvulsoDto } from './dto/create-piloto-avulso.dto';
import { UpdatePilotoDto } from './dto/update-piloto.dto';
import { ArquivosService } from '../arquivos/arquivos.service';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class PilotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arquivos: ArquivosService,
  ) {}

  findAll(empresaId: number): Promise<Piloto[]> {
    // Cobre pilotos de pedido (empresaId preenchido no backfill) e avulsos.
    return this.prisma.piloto.findMany({
      where: { OR: [{ empresaId }, { pedido: { empresaId } }] },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Piloto> {
    const piloto = await this.prisma.piloto.findUnique({
      where: { id },
      include: { pedido: { select: { empresaId: true } } },
    });
    const dono = piloto?.empresaId ?? piloto?.pedido?.empresaId;
    if (!piloto || dono !== empresaId) {
      throw new NotFoundException(`Piloto ${id} não encontrado.`);
    }
    return piloto;
  }

  async create(dto: CreatePilotoDto, empresaId: number): Promise<Piloto> {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId } });
    if (!pedido || pedido.empresaId !== empresaId) {
      throw new NotFoundException(`Pedido ${dto.pedidoId} não encontrado.`);
    }

    const codigo = await this.gerarCodigo();
    return this.prisma.piloto.create({
      data: {
        empresaId,
        codigo,
        pedidoId: pedido.id,
        clienteId: pedido.clienteId,
        produtoId: dto.produtoId,
        solicitacao: new Date(),
        prazoRetorno: dto.prazoRetorno ? new Date(dto.prazoRetorno) : undefined,
        status: 'em_desenvolvimento',
        liberado: false,
        obs: dto.obs,
      },
    });
  }

  /** Peça-piloto AVULSA: desenvolvimento de amostra sem pedido vinculado. */
  async criarAvulso(dto: CreatePilotoAvulsoDto, empresaId: number): Promise<Piloto> {
    const codigo = await this.gerarCodigo();
    return this.prisma.piloto.create({
      data: {
        empresaId,
        codigo,
        clienteId: dto.clienteId ?? undefined,
        clienteNome: dto.clienteNome?.trim() || null,
        produtoId: dto.produtoId ?? undefined,
        modelagem: dto.modelagem?.trim() || null,
        artigo: dto.artigo?.trim() || null,
        marca: dto.marca?.trim() || null,
        cor: dto.cor?.trim() || null,
        setor: dto.setor?.trim() || null,
        solicitacao: new Date(),
        prazoRetorno: dto.prazoRetorno ? new Date(dto.prazoRetorno) : undefined,
        status: 'em_desenvolvimento',
        liberado: false,
        obs: dto.obs?.trim() || null,
      },
    });
  }

  async update(id: number, dto: UpdatePilotoDto, empresaId: number): Promise<Piloto> {
    await this.findOne(id, empresaId);
    return this.prisma.piloto.update({
      where: { id },
      data: {
        status: dto.status,
        envio: dto.envio ? new Date(dto.envio) : undefined,
        prazoRetorno: dto.prazoRetorno ? new Date(dto.prazoRetorno) : undefined,
        tentativa: dto.tentativa,
        obs: dto.obs,
        briefingProduto: dto.briefingProduto,
        briefing: dto.briefing !== undefined ? (dto.briefing as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  /** Aprova a peça-piloto: libera a produção e avança o pedido para a etapa de material. */
  async aprovar(id: number, empresaId: number): Promise<Piloto> {
    const piloto = await this.findOne(id, empresaId);
    if (piloto.liberado) {
      throw new ConflictException(`Piloto ${piloto.codigo} já está liberado.`);
    }
    const atualizado = await this.prisma.piloto.update({
      where: { id },
      data: { status: 'aprovada', liberado: true },
    });
    // Piloto de PEDIDO avança a etapa; piloto AVULSO (sem pedido) só é aprovado.
    if (piloto.pedidoId != null) {
      await this.prisma.pedido.updateMany({
        where: { id: piloto.pedidoId, etapa: 'piloto' },
        data: { etapa: 'material' },
      });
    }
    return atualizado;
  }

  /**
   * FOTO / DESENHO DA PEÇA na própria piloto.
   *
   * A ficha técnica puxava a imagem só do Produto — e piloto avulsa não tem
   * produto, porque ele só nasce depois da aprovação. Resultado: a ficha das
   * pilotos da GRSA saía com a moldura do desenho vazia, que é justamente a
   * parte que a piloteira olha primeiro.
   *
   * Guarda no bucket como `arq:…` (o mesmo caminho da foto do produto), para
   * não inchar a linha do banco com base64.
   */
  async salvarFoto(id: number, empresaId: number, dataUri: string | null | undefined, nome?: string) {
    const piloto = await this.findOne(id, empresaId);
    const s = (dataUri ?? '').trim();

    if (!s) { // string vazia = REMOVER a foto (diferente de não mexer)
      if (piloto.foto) await this.arquivos.remover(piloto.foto).catch(() => undefined);
      return this.prisma.piloto.update({ where: { id }, data: { foto: null, fotoNome: null } });
    }

    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) {
      throw new BadRequestException('Envie uma imagem (PNG, JPG, WEBP ou GIF) da peça.');
    }
    // ~9 MB de arquivo viram ~12 MB em base64. Acima disso é foto de câmera
    // crua, que não melhora a ficha e trava o upload.
    if (s.length > 12_000_000) throw new BadRequestException('Imagem muito grande (máx ~9 MB). Reduza antes de enviar.');

    const anterior = piloto.foto;
    const ref = await this.arquivos.guardar(s, 'pilotos');
    const atualizado = await this.prisma.piloto.update({
      where: { id },
      data: { foto: ref, fotoNome: (nome ?? '').trim().slice(0, 160) || null },
    });
    // Só apaga a antiga DEPOIS de a nova estar gravada: se algo falhar no meio,
    // o pior caso é um arquivo órfão no bucket, não uma ficha sem imagem.
    if (anterior && anterior !== ref) await this.arquivos.remover(anterior).catch(() => undefined);
    return atualizado;
  }

  /**
   * ETIQUETA DA PEÇA-PILOTO (100x50 mm) — vai colada na embalagem que sai para
   * o cliente.
   *
   * A piloto chega na mesa de quem vai avaliar junto com outras amostras, de
   * outros fornecedores e de outras tentativas da mesma peça. Sem etiqueta,
   * "qual é essa?" vira telefonema. Por isso o que está aqui é o mínimo para
   * identificar a peça sem abrir sistema nenhum: de quem é, o que é, qual
   * tecido, qual cor, qual TENTATIVA e até quando a avaliação é esperada —
   * mais o código em barras, que é por onde ela volta a ser encontrada.
   */
  async etiqueta(id: number, empresaId: number) {
    const piloto = await this.findOne(id, empresaId);
    const produto = piloto.produtoId
      ? await this.prisma.produto.findUnique({ where: { id: piloto.produtoId }, select: { codigo: true, descricao: true, tecido: true, composicao: true, grade: true } })
      : null;
    const cliente = piloto.clienteId
      ? await this.prisma.cliente.findUnique({ where: { id: piloto.clienteId }, select: { nome: true } })
      : null;
    const pedido = piloto.pedidoId
      ? await this.prisma.pedido.findUnique({ where: { id: piloto.pedidoId }, select: { numero: true, cliente: { select: { nome: true } } } })
      : null;

    const dia = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
    const dados = {
      codigo: piloto.codigo,
      cliente: piloto.clienteNome || cliente?.nome || pedido?.cliente?.nome || '—',
      pedido: pedido?.numero ?? '—',
      // Piloto AVULSO não tem produto cadastrado ainda (o produto só nasce depois
      // de aprovada): aí quem nomeia a peça é a modelagem.
      produto: produto?.descricao ?? piloto.modelagem ?? piloto.briefingProduto ?? '—',
      produtoCodigo: produto?.codigo ?? '—',
      modelagem: piloto.modelagem ?? '—',
      // O artigo do piloto manda: ele é o que foi usado NESTA amostra, que pode
      // não ser o tecido padrão da ficha do produto.
      artigo: piloto.artigo ?? produto?.tecido ?? '—',
      // A MARCA do tecido NÃO vai nos dados da etiqueta, de propósito: esta
      // etiqueta é lida pelo cliente, e dizer de qual fábrica vem o pano é
      // entregar o caminho para ele comprar direto. Quem precisa da marca
      // (ficha, compras, histórico) continua tendo — só a etiqueta não leva.
      composicao: produto?.composicao ?? '—',
      cor: piloto.cor ?? '—',
      setor: piloto.setor ?? '—',
      tamanho: produto?.grade ? String(produto.grade).split(',')[0].trim() : '—',
      tentativa: piloto.tentativa,
      status: piloto.status,
      solicitacao: dia(piloto.solicitacao),
      envio: dia(piloto.envio),
      prazoRetorno: dia(piloto.prazoRetorno),
    };
    return { dados, zpl: this.zplEtiqueta(dados) };
  }

  /**
   * ZPL da etiqueta 100x50 mm @203dpi (800 x 400 pontos).
   *
   * Esta etiqueta vai colada na embalagem que o CLIENTE recebe, e isso manda
   * em duas omissões:
   *
   *  · A MARCA do tecido não entra — nem no texto, nem no QR. Só o artigo e a
   *    cor. Dizer de qual fábrica vem o pano é entregar ao cliente o caminho
   *    para comprar direto.
   *  · A TENTATIVA também não. "3ª tentativa" na caixa conta a quem recebe
   *    quantas vezes a peça voltou — informação nossa, de dentro de casa.
   *
   * As duas continuam no sistema (ficha, histórico, lista de pilotos): o que
   * mudou foi o que SAI impresso.
   */
  private zplEtiqueta(d: Record<string, string | number>): string {
    const s = (v: string | number, max = 34) => String(v).replace(/[\^~]/g, ' ').slice(0, max);
    const qr = JSON.stringify({
      piloto: d.codigo, cliente: d.cliente, produto: d.produto, artigo: d.artigo,
      cor: d.cor, prazo: d.prazoRetorno, versao: '2',
    }).replace(/[\^~]/g, ' ');
    return [
      '^XA', '^CI28', '^PW800', '^LL400',
      '^CF0,26', '^FO18,14^FDGRUPO CHERKESIAN - PECA PILOTO^FS',
      '^CF0,40', `^FO18,46^FD${s(d.codigo, 20)}^FS`,
      '^CF0,26',
      `^FO18,96^FDCliente: ${s(d.cliente)}^FS`,
      // Nome da peça numa fonte um pouco menor: é a linha mais longa da etiqueta
      // e não pode avançar sobre o QR, que começa em x=600.
      '^CF0,24', `^FO18,128^FD${s(d.produto, 44)}^FS`, '^CF0,26',
      `^FO18,160^FDTecido: ${s(d.artigo, 30)}^FS`,
      `^FO18,192^FDCor: ${s(d.cor, 18)}   Tam: ${s(d.tamanho, 8)}^FS`,
      `^FO18,224^FDEnvio: ${s(d.envio, 12)}  Retorno ate: ${s(d.prazoRetorno, 12)}^FS`,
      // QR à direita, acima do código de barras
      `^FO600,96^BQN,2,4^FDLA,${qr}^FS`,
      `^FO18,262^BY2^BCN,80,Y,N,N^FD${s(d.codigo, 20)}^FS`,
      '^XZ',
    ].join('\n');
  }

  private async gerarCodigo(): Promise<string> {
    const existentes = await this.prisma.piloto.findMany({ select: { codigo: true } });
    return proximoSequencial('PIL', existentes.map((p) => p.codigo), { pad: 4, separador: '-' });
  }
}
