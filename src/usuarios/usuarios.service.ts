import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Acesso, Prisma, Usuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

const SALT_ROUNDS = 10;

/** Usuário sem o hash da senha — nunca devolvemos `senhaHash` na API. */
export type UsuarioPublico = Omit<Usuario, 'senhaHash'>;

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * TROCA DE SENHA pelo próprio usuário (o portal usa isto).
   *
   * Sem isto a senha que o admin definiu valia para sempre, e o comprador não
   * tinha como fortalecer a dele. Como o login do portal vale de assinatura nos
   * Logs (download de NF, pedido de reposição, com IP), senha que todo mundo
   * sabe enfraquece justamente essa prova.
   */
  async trocarPropriaSenha(id: number, senhaAtual: string, novaSenha: string) {
    const u = await this.prisma.usuario.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Usuário não encontrado.');
    const atual = String(senhaAtual ?? '');
    const nova = String(novaSenha ?? '').trim();
    if (!(await bcrypt.compare(atual, u.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    if (nova.length < 6) throw new BadRequestException('A nova senha precisa de ao menos 6 caracteres.');
    if (nova === atual) throw new BadRequestException('A nova senha tem de ser diferente da atual.');
    await this.prisma.usuario.update({ where: { id }, data: { senhaHash: await bcrypt.hash(nova, SALT_ROUNDS) } });
    await this.prisma.log.create({
      data: { usuario: u.usuario, acao: 'senha.trocada', detalhe: 'Trocada pelo próprio usuário.', entidade: 'Usuario', entidadeId: String(id) },
    }).catch(() => undefined);
    return { ok: true, mensagem: 'Senha alterada.' };
  }

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

  /**
   * Manda o acesso do PORTAL para o cliente, pelo próprio sistema.
   *
   * A senha é informada aqui e GRAVADA junto com o envio — não dá para mandar
   * uma senha e o login ficar com outra. Era o erro que acontecia ao montar o
   * e-mail à mão: login digitado errado (crystian x chrystian) ou senha que já
   * tinha sido trocada, e o cliente sem conseguir entrar.
   *
   * O portal não tem "alterar senha" nem "esqueci minha senha": a senha que sai
   * daqui vale até alguém trocar no cadastro.
   */
  async enviarAcessoPortal(
    id: number,
    empresaId: number,
    dto: { email?: string; senha: string; copiaPara?: string },
    quem: string,
    ip?: string,
  ) {
    const u = await this.findOne(id, empresaId);
    if (u.acesso !== 'cliente' || !u.clienteId) {
      throw new BadRequestException('Este usuário não é um acesso do Portal do Cliente.');
    }
    if (!u.ativo) throw new BadRequestException('Usuário inativo — ative antes de enviar o acesso.');
    const senha = String(dto?.senha ?? '').trim();
    if (senha.length < 6) throw new BadRequestException('A senha precisa de ao menos 6 caracteres.');

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: u.clienteId, empresaId },
      select: { nome: true, fantasia: true, email: true },
    });
    if (!cliente) throw new NotFoundException('Cliente do portal não encontrado.');

    const destino = (dto?.email ?? '').trim() || (cliente.email ?? '').trim();
    if (!destino) throw new BadRequestException('Informe o e-mail de destino — o cliente não tem e-mail cadastrado.');

    // Grava a senha ANTES de enviar: se a gravação falhar, nada sai, e o cliente
    // nunca recebe uma credencial que não funciona.
    await this.prisma.usuario.update({ where: { id }, data: { senhaHash: await bcrypt.hash(senha, SALT_ROUNDS) } });

    // "Portal · Chrystian · VIVARA" -> "Chrystian"
    const pessoa = String(u.nome ?? '').replace(/^portal\s*·\s*/i, '').split('·')[0].trim() || 'cliente';
    const empresaCli = cliente.fantasia || cliente.nome;
    const url = this.config.get<string>('PORTAL_URL') || 'https://portal.hcqualitycorp.com.br';

    const texto = [
      `Prezado(a) ${pessoa},`, '',
      'É com satisfação que liberamos o seu acesso ao Portal do Cliente da HC Quality.',
      '',
      `O portal dá a você autonomia e visibilidade sobre tudo o que é da ${empresaCli}, a qualquer hora, sem depender de e-mail ou telefone.`,
      '', 'ACESSO',
      `Endereço: ${url}`,
      `Usuário:  ${u.usuario}`,
      `Senha:    ${senha}`,
      '', 'O QUE VOCÊ ENCONTRA NO PORTAL', '',
      '• Estoque pronta-entrega — o que está disponível agora, por produto e tamanho.',
      '• Acompanhamento de produção — em que etapa está cada pedido e a previsão de entrega.',
      '• Catálogo — seus produtos com foto, referência e grade.',
      '• Notas fiscais — download do PDF (DANFE) e do XML.',
      '• Novo pedido — você mesmo monta e envia o pedido pelo portal.',
      '', 'SOBRE O NOVO PEDIDO',
      'O pedido enviado pelo portal chega à nossa equipe como orçamento para validação.',
      'Assim que conferimos preço, prazo e disponibilidade, ele é aprovado e você recebe a',
      'confirmação. É uma checagem rápida, que evita divergências antes da produção começar.',
      '', 'Qualquer dúvida, estou à disposição para apresentar o portal numa ligação rápida.',
      '', 'Atenciosamente,', '',
      'Herberth Cherkesian',
      'HC Quality Corporate — Professional Workwear & Health',
      'herberth@hcqualitycorp.com.br · (11) 97620-8741',
    ].join('\n');

    const r = await this.email.enviar({
      para: destino,
      cc: (dto?.copiaPara || '').trim() || undefined,
      assunto: 'Bem-vindo ao Portal do Cliente HC Quality — seu acesso está liberado',
      texto,
      remetenteNome: 'HC Quality Corporate',
    });

    // Fica no Log: quem mandou, para quem e quando. A senha NÃO entra aqui.
    await this.prisma.log.create({
      data: {
        usuario: quem, acao: 'portal.acesso.enviado',
        detalhe: `Acesso do portal enviado para ${destino} · login ${u.usuario} · ${empresaCli}`,
        entidade: 'Usuario', entidadeId: String(id), ip: ip ?? null,
      },
    }).catch(() => undefined);

    return { ...r, para: destino, login: u.usuario, cliente: empresaCli };
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
