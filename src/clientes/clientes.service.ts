import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cliente } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number) {
    return this.prisma.cliente.findMany({
      where: { empresaId },
      orderBy: { id: 'asc' },
      include: {
        consultasCredito: { orderBy: { consultadoEm: 'desc' }, take: 1 },
        unidades: { orderBy: { nome: 'asc' } },
      },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Cliente> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id }, include: { unidades: { orderBy: { nome: 'asc' } } } });
    if (!cliente || cliente.empresaId !== empresaId) {
      throw new NotFoundException(`Cliente ${id} não encontrado.`);
    }
    return cliente;
  }

  create(dto: CreateClienteDto, empresaId: number): Promise<Cliente> {
    return this.prisma.cliente.create({
      data: {
        empresaId,
        nome: dto.nome,
        fantasia: dto.fantasia,
        grupo: dto.grupo,
        cnpjCpf: dto.cnpjCpf,
        contato: dto.contato,
        telefone: dto.telefone,
        email: dto.email,
        cidadeUf: dto.cidadeUf,
        segmento: dto.segmento,
        clienteNovo: dto.clienteNovo ?? true,
        obs: dto.obs,
        ...this.dadosFiscais(dto),
        ...(dto.unidades ? { unidades: { create: dto.unidades.map((u) => this.dadosUnidade(u)) } } : {}),
      },
      include: { unidades: { orderBy: { nome: 'asc' } } },
    });
  }

  async update(id: number, dto: UpdateClienteDto, empresaId: number): Promise<Cliente> {
    await this.findOne(id, empresaId);
    // unidades: quando enviadas, substituem a lista inteira (apaga e recria).
    const trocaUnidades = Array.isArray(dto.unidades);
    return this.prisma.cliente.update({
      where: { id },
      data: {
        nome: dto.nome,
        fantasia: dto.fantasia,
        grupo: dto.grupo,
        cnpjCpf: dto.cnpjCpf,
        contato: dto.contato,
        telefone: dto.telefone,
        email: dto.email,
        cidadeUf: dto.cidadeUf,
        segmento: dto.segmento,
        clienteNovo: dto.clienteNovo,
        obs: dto.obs,
        ...this.dadosFiscais(dto),
        ...(trocaUnidades ? { unidades: { deleteMany: {}, create: (dto.unidades ?? []).map((u) => this.dadosUnidade(u)) } } : {}),
      },
      include: { unidades: { orderBy: { nome: 'asc' } } },
    });
  }

  /** Campos de uma unidade/filial do cliente. */
  private dadosUnidade(u: NonNullable<CreateClienteDto['unidades']>[number]) {
    return {
      nome: u.nome,
      cnpjCpf: u.cnpjCpf,
      email: u.email,
      inscricaoEstadual: u.inscricaoEstadual,
      indicadorIE: u.indicadorIE,
      logradouro: u.logradouro,
      numeroEndereco: u.numeroEndereco,
      bairro: u.bairro,
      municipio: u.municipio,
      codMunicipio: u.codMunicipio,
      uf: u.uf,
      cep: u.cep,
    };
  }

  async remove(id: number, empresaId: number): Promise<{ removido: true; id: number }> {
    await this.findOne(id, empresaId);
    const [pedidos, titulos, medidas] = await Promise.all([
      this.prisma.pedido.count({ where: { clienteId: id } }),
      this.prisma.contaReceber.count({ where: { clienteId: id } }),
      this.prisma.medida.count({ where: { clienteId: id } }),
    ]);
    const b: string[] = [];
    if (pedidos) b.push(`${pedidos} pedido(s)`);
    if (titulos) b.push(`${titulos} título(s) a receber`);
    if (medidas) b.push(`${medidas} ficha(s) de medidas`);
    if (b.length) throw new ConflictException(`Não é possível excluir: cliente vinculado a ${b.join(', ')}.`);
    await this.prisma.cliente.delete({ where: { id } });
    return { removido: true, id };
  }

  /** Campos fiscais do destinatário presentes no DTO. */
  private dadosFiscais(dto: CreateClienteDto | UpdateClienteDto) {
    return {
      inscricaoEstadual: dto.inscricaoEstadual,
      indicadorIE: dto.indicadorIE,
      logradouro: dto.logradouro,
      numeroEndereco: dto.numeroEndereco,
      bairro: dto.bairro,
      municipio: dto.municipio,
      codMunicipio: dto.codMunicipio,
      uf: dto.uf,
      cep: dto.cep,
    };
  }
}
