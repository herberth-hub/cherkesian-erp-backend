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

  /** Ficha/extrato do cliente: orçamentos, pedidos e NFs (quantidades + valores). */
  async resumo(id: number, empresaId: number) {
    const cliente = await this.findOne(id, empresaId);
    const pedidos = await this.prisma.pedido.findMany({
      where: { empresaId, clienteId: id },
      select: { id: true, numero: true, etapa: true, status: true, valorTotal: true, data: true },
      orderBy: { id: 'desc' },
    });
    const orc = pedidos.filter((p) => p.etapa === 'orcamento');
    const ped = pedidos.filter((p) => p.etapa !== 'orcamento');
    const somaP = (arr: typeof pedidos) => Number(arr.reduce((s, p) => s + Number(p.valorTotal), 0).toFixed(2));

    const pedidoIds = pedidos.map((p) => p.id);
    const exps = pedidoIds.length
      ? await this.prisma.expedicao.findMany({ where: { pedidoId: { in: pedidoIds } }, select: { id: true } })
      : [];
    const expIds = exps.map((e) => e.id);
    const notas = pedidoIds.length
      ? await this.prisma.notaFiscal.findMany({
          where: { empresaId, OR: [{ pedidoId: { in: pedidoIds } }, ...(expIds.length ? [{ expedicaoId: { in: expIds } }] : [])] },
          select: { id: true, numero: true, serie: true, status: true, valor: true, cfop: true, chave: true, tipo: true, provedor: true, emitidaEm: true },
          orderBy: { id: 'desc' },
        })
      : [];
    const notasValidas = notas.filter((n) => ['autorizada', 'simulada', 'pendente'].includes(n.status));

    // Faturamento por mês (últimos 12), a partir das NFs válidas.
    const porMes = new Map<string, number>();
    for (const n of notasValidas) {
      const d = new Date(n.emitidaEm);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(n.valor));
    }
    const faturamentoMensal = [...porMes.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([mes, valor]) => ({ mes, valor: Number(valor.toFixed(2)) }));

    return {
      cliente: { id: cliente.id, nome: cliente.fantasia || cliente.nome, razao: cliente.nome },
      orcamentos: { qtd: orc.length, valor: somaP(orc) },
      pedidos: { qtd: ped.length, valor: somaP(ped) },
      nfs: {
        qtd: notas.length,
        validas: notasValidas.length,
        valor: Number(notasValidas.reduce((s, n) => s + Number(n.valor), 0).toFixed(2)),
      },
      faturamentoMensal,
      listaPedidos: pedidos.map((p) => ({ id: p.id, numero: p.numero, etapa: p.etapa, status: p.status, valor: Number(p.valorTotal), data: p.data })),
      listaNfs: notas.map((n) => ({ id: n.id, numero: n.numero, serie: n.serie, status: n.status, valor: Number(n.valor), cfop: n.cfop, chave: n.chave, tipo: n.tipo, provedor: n.provedor, emitidaEm: n.emitidaEm })),
    };
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
