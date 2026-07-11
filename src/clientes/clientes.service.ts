import { Injectable, NotFoundException } from '@nestjs/common';
import { Cliente } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(empresaId: number): Promise<Cliente[]> {
    return this.prisma.cliente.findMany({
      where: { empresaId },
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: number, empresaId: number): Promise<Cliente> {
    const cliente = await this.prisma.cliente.findUnique({ where: { id } });
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
        cnpjCpf: dto.cnpjCpf,
        contato: dto.contato,
        telefone: dto.telefone,
        email: dto.email,
        cidadeUf: dto.cidadeUf,
        segmento: dto.segmento,
        clienteNovo: dto.clienteNovo ?? true,
        obs: dto.obs,
        ...this.dadosFiscais(dto),
      },
    });
  }

  async update(id: number, dto: UpdateClienteDto, empresaId: number): Promise<Cliente> {
    await this.findOne(id, empresaId);
    return this.prisma.cliente.update({
      where: { id },
      data: {
        nome: dto.nome,
        fantasia: dto.fantasia,
        cnpjCpf: dto.cnpjCpf,
        contato: dto.contato,
        telefone: dto.telefone,
        email: dto.email,
        cidadeUf: dto.cidadeUf,
        segmento: dto.segmento,
        clienteNovo: dto.clienteNovo,
        obs: dto.obs,
        ...this.dadosFiscais(dto),
      },
    });
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
