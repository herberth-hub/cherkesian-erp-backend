import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Piloto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePilotoDto } from './dto/create-piloto.dto';
import { UpdatePilotoDto } from './dto/update-piloto.dto';
import { proximoSequencial } from '../common/utils/codigo.util';

@Injectable()
export class PilotosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Piloto[]> {
    return this.prisma.piloto.findMany({
      where: { pedido: { empresaId } },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Piloto> {
    const piloto = await this.prisma.piloto.findUnique({
      where: { id },
      include: { pedido: { select: { empresaId: true } } },
    });
    if (!piloto || piloto.pedido.empresaId !== empresaId) {
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
      },
    });
  }

  /** Aprova a peça-piloto: libera a produção e avança o pedido para a etapa de material. */
  async aprovar(id: number, empresaId: number): Promise<Piloto> {
    const piloto = await this.findOne(id, empresaId);
    if (piloto.liberado) {
      throw new ConflictException(`Piloto ${piloto.codigo} já está liberado.`);
    }
    const [atualizado] = await this.prisma.$transaction([
      this.prisma.piloto.update({
        where: { id },
        data: { status: 'aprovada', liberado: true },
      }),
      this.prisma.pedido.updateMany({
        where: { id: piloto.pedidoId, etapa: 'piloto' },
        data: { etapa: 'material' },
      }),
    ]);
    return atualizado;
  }

  private async gerarCodigo(): Promise<string> {
    const existentes = await this.prisma.piloto.findMany({ select: { codigo: true } });
    return proximoSequencial('PIL', existentes.map((p) => p.codigo), { pad: 4, separador: '-' });
  }
}
