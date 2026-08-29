import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFuncionarioDto, FeriasDto, PontoBatchDto, PontoItemDto, UpdateFuncionarioDto } from './dto/rh.dto';

@Injectable()
export class RhService {
  constructor(private readonly prisma: PrismaService) {}

  private parseData(s?: string): Date | null {
    if (!s) return null;
    const t = s.trim();
    // aceita AAAA-MM-DD e DD/MM/AAAA
    let iso = t;
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00.000Z` : iso);
    return isNaN(d.getTime()) ? null : d;
  }

  /** "HH:MM" -> minutos do dia (aceita "8:00", "08:00", "0800"). */
  private minutos(hhmm?: string): number | null {
    if (!hhmm) return null;
    const t = hhmm.trim();
    if (!t) return null;
    let m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) { const c = /^(\d{2})(\d{2})$/.exec(t); if (c) m = [t, c[1], c[2]] as unknown as RegExpExecArray; }
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** Calcula horas trabalhadas e extras a partir dos batimentos e da jornada diária. */
  private calcularHoras(
    p: { entrada?: string | null; saidaAlmoco?: string | null; voltaAlmoco?: string | null; saida?: string | null },
    jornadaDiaria: number,
  ): { horasTrabalhadas: number | null; horasExtras: number | null } {
    const ent = this.minutos(p.entrada ?? undefined);
    const sai = this.minutos(p.saida ?? undefined);
    if (ent == null || sai == null || sai <= ent) return { horasTrabalhadas: null, horasExtras: null };
    let trabalho = sai - ent;
    const sa = this.minutos(p.saidaAlmoco ?? undefined);
    const va = this.minutos(p.voltaAlmoco ?? undefined);
    if (sa != null && va != null && va > sa) trabalho -= va - sa;
    const horas = Math.max(0, trabalho) / 60;
    const extras = Math.max(0, horas - (jornadaDiaria || 0));
    return { horasTrabalhadas: Number(horas.toFixed(2)), horasExtras: Number(extras.toFixed(2)) };
  }

  // ===== Funcionários =====
  listar(empresaId: number) {
    return this.prisma.funcionario.findMany({
      where: { empresaId },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      include: { _count: { select: { pontos: true, ferias: true } } },
    });
  }

  async obter(id: number, empresaId: number) {
    const f = await this.prisma.funcionario.findUnique({
      where: { id },
      include: { ferias: { orderBy: { inicio: 'desc' } } },
    });
    if (!f || f.empresaId !== empresaId) throw new NotFoundException(`Funcionário ${id} não encontrado.`);
    return f;
  }

  async criar(dto: CreateFuncionarioDto, empresaId: number) {
    return this.prisma.funcionario.create({ data: this.dadosFuncionario(dto, empresaId) });
  }

  async atualizar(id: number, dto: UpdateFuncionarioDto, empresaId: number) {
    await this.obter(id, empresaId);
    return this.prisma.funcionario.update({ where: { id }, data: this.dadosFuncionario(dto, empresaId, true) });
  }

  private dadosFuncionario(dto: CreateFuncionarioDto, empresaId: number, parcial = false) {
    const d: Prisma.FuncionarioUncheckedCreateInput = {
      empresaId,
      nome: dto.nome?.trim(),
      cpf: dto.cpf?.trim() || null,
      cargo: dto.cargo?.trim() || null,
      setor: dto.setor?.trim() || null,
      admissao: this.parseData(dto.admissao),
      demissao: this.parseData(dto.demissao),
      salario: dto.salario != null ? new Prisma.Decimal(dto.salario) : null,
      jornadaDiaria: dto.jornadaDiaria != null ? new Prisma.Decimal(dto.jornadaDiaria) : new Prisma.Decimal(8),
      diasSemana: dto.diasSemana ?? 5,
      valeTransporte: dto.valeTransporte != null ? new Prisma.Decimal(dto.valeTransporte) : null,
      banco: dto.banco?.trim() || null,
      pixChave: dto.pixChave?.trim() || null,
      ativo: dto.ativo ?? true,
      obs: dto.obs?.trim() || null,
    };
    if (parcial) {
      // Em update, não sobrescreve jornada/dias/ativo com default quando não vieram.
      if (dto.jornadaDiaria == null) delete (d as Record<string, unknown>).jornadaDiaria;
      if (dto.diasSemana == null) delete (d as Record<string, unknown>).diasSemana;
      if (dto.ativo == null) delete (d as Record<string, unknown>).ativo;
      delete (d as Record<string, unknown>).empresaId;
    }
    return d;
  }

  async remover(id: number, empresaId: number) {
    await this.obter(id, empresaId);
    await this.prisma.funcionario.delete({ where: { id } });
    return { ok: true };
  }

  // ===== Ponto =====
  async pontosDoMes(funcionarioId: number, empresaId: number, mes?: string) {
    await this.obter(funcionarioId, empresaId);
    const where: Prisma.PontoRegistroWhereInput = { funcionarioId };
    const range = this.rangeMes(mes);
    if (range) where.data = { gte: range.ini, lt: range.fim };
    return this.prisma.pontoRegistro.findMany({ where, orderBy: { data: 'asc' } });
  }

  private rangeMes(mes?: string): { ini: Date; fim: Date } | null {
    if (!mes) return null;
    const m = /^(\d{4})-(\d{2})$/.exec(mes.trim());
    if (!m) return null;
    const ano = Number(m[1]), mm = Number(m[2]) - 1;
    return { ini: new Date(Date.UTC(ano, mm, 1)), fim: new Date(Date.UTC(ano, mm + 1, 1)) };
  }

  /** Salva/atualiza um registro de ponto (por funcionário + data). */
  async salvarPonto(item: PontoItemDto, empresaId: number) {
    const func = await this.resolverFuncionario(item, empresaId);
    const data = this.parseData(item.data);
    if (!data) throw new BadRequestException(`Data inválida: ${item.data}`);
    const jornada = Number(func.jornadaDiaria ?? 8);
    const horas = item.falta ? { horasTrabalhadas: 0, horasExtras: 0 } : this.calcularHoras(item, jornada);
    const existente = await this.prisma.pontoRegistro.findFirst({ where: { funcionarioId: func.id, data } });
    const payload = {
      entrada: item.entrada?.trim() || null,
      saidaAlmoco: item.saidaAlmoco?.trim() || null,
      voltaAlmoco: item.voltaAlmoco?.trim() || null,
      saida: item.saida?.trim() || null,
      falta: !!item.falta,
      horasTrabalhadas: horas.horasTrabalhadas != null ? new Prisma.Decimal(horas.horasTrabalhadas) : null,
      horasExtras: horas.horasExtras != null ? new Prisma.Decimal(horas.horasExtras) : null,
      obs: item.obs?.trim() || null,
    };
    if (existente) return this.prisma.pontoRegistro.update({ where: { id: existente.id }, data: payload });
    return this.prisma.pontoRegistro.create({ data: { funcionarioId: func.id, data, ...payload } });
  }

  /** Upload em lote (ex.: CSV do relógio de ponto). Casa por funcionarioId, CPF ou nome. */
  async importarPontos(dto: PontoBatchDto, empresaId: number) {
    const registros = dto.registros || [];
    let ok = 0;
    const erros: string[] = [];
    for (let i = 0; i < registros.length; i++) {
      try {
        await this.salvarPonto(registros[i], empresaId);
        ok++;
      } catch (e) {
        erros.push(`Linha ${i + 1}: ${(e as Error).message}`);
      }
    }
    return { total: registros.length, importados: ok, erros };
  }

  private async resolverFuncionario(item: PontoItemDto, empresaId: number) {
    if (item.funcionarioId) return this.obter(item.funcionarioId, empresaId);
    const cpf = item.cpf?.replace(/\D/g, '');
    if (cpf) {
      const f = await this.prisma.funcionario.findFirst({ where: { empresaId, cpf: { contains: cpf } } });
      if (f) return f;
    }
    if (item.nome) {
      const f = await this.prisma.funcionario.findFirst({ where: { empresaId, nome: { equals: item.nome.trim(), mode: 'insensitive' } } });
      if (f) return f;
    }
    throw new BadRequestException(`Funcionário não encontrado (${item.nome || item.cpf || item.funcionarioId || '?'}).`);
  }

  async removerPonto(id: number, empresaId: number) {
    const p = await this.prisma.pontoRegistro.findUnique({ where: { id }, include: { funcionario: true } });
    if (!p || p.funcionario.empresaId !== empresaId) throw new NotFoundException('Registro não encontrado.');
    await this.prisma.pontoRegistro.delete({ where: { id } });
    return { ok: true };
  }

  // ===== Resumo mensal (folha para a contabilidade) =====
  async resumoMes(empresaId: number, mes: string) {
    const range = this.rangeMes(mes);
    if (!range) throw new BadRequestException('Informe o mês no formato AAAA-MM.');
    const funcs = await this.prisma.funcionario.findMany({ where: { empresaId }, orderBy: { nome: 'asc' } });
    const pontos = await this.prisma.pontoRegistro.findMany({
      where: { funcionarioId: { in: funcs.map((f) => f.id) }, data: { gte: range.ini, lt: range.fim } },
    });
    const porFunc = new Map<number, { horas: number; extras: number; dias: number; faltas: number }>();
    for (const p of pontos) {
      const a = porFunc.get(p.funcionarioId) ?? { horas: 0, extras: 0, dias: 0, faltas: 0 };
      a.horas += Number(p.horasTrabalhadas ?? 0);
      a.extras += Number(p.horasExtras ?? 0);
      if (p.falta) a.faltas += 1; else a.dias += 1;
      porFunc.set(p.funcionarioId, a);
    }
    const linhas = funcs.map((f) => {
      const a = porFunc.get(f.id) ?? { horas: 0, extras: 0, dias: 0, faltas: 0 };
      const jornada = Number(f.jornadaDiaria ?? 8);
      const cargaMensal = Math.round(jornada * (f.diasSemana ?? 5) * (52 / 12)); // ~horas/mês
      const salario = Number(f.salario ?? 0);
      const valorHora = cargaMensal > 0 ? salario / cargaMensal : 0;
      const valorExtras = valorHora * 1.5 * a.extras; // hora extra a 50%
      return {
        funcionarioId: f.id,
        nome: f.nome,
        cpf: f.cpf,
        cargo: f.cargo,
        salario: Number(salario.toFixed(2)),
        cargaMensal,
        diasTrabalhados: a.dias,
        faltas: a.faltas,
        horasTrabalhadas: Number(a.horas.toFixed(2)),
        horasExtras: Number(a.extras.toFixed(2)),
        valorHora: Number(valorHora.toFixed(2)),
        valorHoraExtra: Number((valorHora * 1.5).toFixed(2)),
        valorExtras: Number(valorExtras.toFixed(2)),
        totalComExtras: Number((salario + valorExtras).toFixed(2)),
      };
    });
    const totais = {
      funcionarios: linhas.length,
      horasTrabalhadas: Number(linhas.reduce((s, l) => s + l.horasTrabalhadas, 0).toFixed(2)),
      horasExtras: Number(linhas.reduce((s, l) => s + l.horasExtras, 0).toFixed(2)),
      valorExtras: Number(linhas.reduce((s, l) => s + l.valorExtras, 0).toFixed(2)),
      folha: Number(linhas.reduce((s, l) => s + l.totalComExtras, 0).toFixed(2)),
    };
    return { mes, linhas, totais };
  }

  // ===== Férias / afastamentos =====
  async listarFerias(empresaId: number, funcionarioId?: number) {
    const where: Prisma.FeriasWhereInput = { funcionario: { empresaId } };
    if (funcionarioId) where.funcionarioId = funcionarioId;
    return this.prisma.ferias.findMany({ where, orderBy: { inicio: 'desc' }, include: { funcionario: { select: { nome: true } } } });
  }

  async criarFerias(dto: FeriasDto, empresaId: number) {
    await this.obter(dto.funcionarioId, empresaId);
    const ini = this.parseData(dto.inicio), fim = this.parseData(dto.fim);
    if (!ini || !fim || fim < ini) throw new BadRequestException('Período de férias inválido.');
    const dias = Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1;
    return this.prisma.ferias.create({
      data: { funcionarioId: dto.funcionarioId, inicio: ini, fim, dias, tipo: dto.tipo || 'ferias', status: dto.status || 'agendada', obs: dto.obs?.trim() || null },
    });
  }

  async removerFerias(id: number, empresaId: number) {
    const fe = await this.prisma.ferias.findUnique({ where: { id }, include: { funcionario: true } });
    if (!fe || fe.funcionario.empresaId !== empresaId) throw new NotFoundException('Registro não encontrado.');
    await this.prisma.ferias.delete({ where: { id } });
    return { ok: true };
  }
}
