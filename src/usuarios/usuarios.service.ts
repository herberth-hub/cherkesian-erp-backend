import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Acesso, Prisma, Usuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

const SALT_ROUNDS = 10;

/** Usuário sem o hash da senha — nunca devolvemos `senhaHash` na API. */
export type UsuarioPublico = Omit<Usuario, 'senhaHash'>;

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number): Promise<UsuarioPublico[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { empresaId },
      orderBy: { id: 'asc' },
    });
    return usuarios.map(this.semSenha);
  }

  async findOne(id: number, empresaId: number): Promise<UsuarioPublico> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario || usuario.empresaId !== empresaId) {
      throw new NotFoundException(`Usuário ${id} não encontrado.`);
    }
    return this.semSenha(usuario);
  }

  async create(dto: CreateUsuarioDto, empresaId: number): Promise<UsuarioPublico> {
    const clienteId = await this.resolverClienteId(dto.acesso, dto.clienteId, empresaId);
    const senhaHash = await bcrypt.hash(dto.senha, SALT_ROUNDS);
    try {
      const usuario = await this.prisma.usuario.create({
        data: {
          empresaId,
          nome: dto.nome,
          usuario: dto.usuario,
          senhaHash,
          acesso: dto.acesso,
          clienteId,
          cargo: dto.cargo,
          setor: dto.setor,
          horarioInicio: dto.horarioInicio,
          horarioFim: dto.horarioFim,
          ativo: dto.ativo ?? true,
        },
      });
      return this.semSenha(usuario);
    } catch (err) {
      throw this.tratarErroUnico(err, dto.usuario);
    }
  }

  /**
   * Regras do vínculo cliente↔login:
   * - acesso=cliente EXIGE um clienteId válido da mesma empresa.
   * - qualquer outro perfil zera o vínculo (não faz sentido fora do portal).
   */
  private async resolverClienteId(
    acesso: Acesso,
    clienteId: number | undefined,
    empresaId: number,
  ): Promise<number | null> {
    if (acesso !== 'cliente') return null;
    if (!clienteId) {
      throw new BadRequestException('Selecione o cliente para o acesso do portal.');
    }
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { id: true },
    });
    if (!cliente) {
      throw new BadRequestException('Cliente inválido para esta empresa.');
    }
    return cliente.id;
  }

  async update(id: number, dto: UpdateUsuarioDto, empresaId: number): Promise<UsuarioPublico> {
    const atual = await this.findOne(id, empresaId); // garante existência + escopo da empresa

    const data: Prisma.UsuarioUpdateInput = {
      nome: dto.nome,
      usuario: dto.usuario,
      acesso: dto.acesso,
      cargo: dto.cargo,
      setor: dto.setor,
      horarioInicio: dto.horarioInicio,
      horarioFim: dto.horarioFim,
      ativo: dto.ativo,
    };
    // Recalcula o vínculo do portal quando o perfil ou o cliente mudam.
    if (dto.acesso !== undefined || dto.clienteId !== undefined) {
      const acessoEfetivo = (dto.acesso ?? atual.acesso) as Acesso;
      const clienteEfetivo = dto.clienteId ?? atual.clienteId ?? undefined;
      data.clienteId = await this.resolverClienteId(acessoEfetivo, clienteEfetivo, empresaId);
    }
    if (dto.senha) {
      data.senhaHash = await bcrypt.hash(dto.senha, SALT_ROUNDS);
    }

    try {
      const usuario = await this.prisma.usuario.update({ where: { id }, data });
      return this.semSenha(usuario);
    } catch (err) {
      throw this.tratarErroUnico(err, dto.usuario);
    }
  }

  /** Desbloqueia a conta e zera o contador de tentativas (ação do admin). */
  async desbloquear(id: number, empresaId: number): Promise<UsuarioPublico> {
    await this.findOne(id, empresaId);
    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: { bloqueado: false, tentativasFalhas: 0, bloqueadoEm: null },
    });
    return this.semSenha(usuario);
  }

  /** Exclusão lógica: desativa o usuário (preserva histórico/auditoria). */
  async remove(id: number, empresaId: number): Promise<UsuarioPublico> {
    await this.findOne(id, empresaId);
    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: { ativo: false },
    });
    return this.semSenha(usuario);
  }

  private semSenha(usuario: Usuario): UsuarioPublico {
    const { senhaHash: _omit, ...resto } = usuario;
    void _omit;
    return resto;
  }

  private tratarErroUnico(err: unknown, usuario?: string): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(`Já existe um usuário com o login "${usuario}".`);
    }
    return err as Error;
  }
}
