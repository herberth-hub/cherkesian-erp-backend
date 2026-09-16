import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContasReceberService } from '../financeiro/contas-receber.service';
import {
  CedenteSantander, TituloRemessa, codigoBarrasELinha, gerarRemessaSantander240, lerRetornoSantander240,
  LIQUIDACOES, BAIXAS, REJEICOES, dvNossoNumeroSantander,
} from './cnab/santander240';
import { gerarBoletoPdf } from './boleto-pdf';

const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/**
 * Integração bancária — cobrança (contas a receber) via CNAB 240.
 * Fluxo: selecionar títulos → gerar remessa (reserva nosso número, monta o .REM) →
 * usuário sobe o arquivo no banco → sobe o .RET aqui → baixa automática dos pagos.
 * Só o Santander (033) está implementado; a config da conta bancária traz os dados
 * do convênio — nada é inventado.
 */
@Injectable()
export class BancosService {
  private readonly logger = new Logger(BancosService.name);
  constructor(private readonly prisma: PrismaService, private readonly receber: ContasReceberService) {}

  /** Contas bancárias com integração configurada (p/ o select da tela). */
  async contas(empresaId: number) {
    const contas = await this.prisma.contaBancaria.findMany({
      where: { empresaId, ativa: true },
      include: { filial: { select: { id: true, nome: true, cnpj: true } } },
      orderBy: [{ filialId: 'asc' }, { principal: 'desc' }],
    });
    return contas.map((c) => ({
      id: c.id, filial: c.filial, banco: c.banco, codigoBanco: c.codigoBanco, agencia: c.agencia, conta: c.conta, apelido: c.apelido,
      integracao: c.integracao, cnabVersao: c.cnabVersao, carteira: c.carteira, convenio: c.convenio,
      pronta: this.faltando(c).length === 0, faltando: this.faltando(c),
      proximoNossoNumero: c.proximoNossoNumero, remessaSeq: c.remessaSeq,
    }));
  }

  /** O que falta na conta para gerar remessa Santander 240. */
  private faltando(c: { integracao: string; codigoBanco: string | null; agencia: string | null; conta: string | null; convenio: string | null; codigoTransmissao?: string | null; carteira: string | null; filial?: { cnpj: string | null } }) {
    const f: string[] = [];
    if (c.integracao !== 'cnab') f.push('integração = CNAB');
    if (dig(c.codigoBanco) !== '033') f.push('código do banco 033 (Santander)');
    if (!dig(c.agencia)) f.push('agência');
    if (!dig(c.conta)) f.push('conta');
    if (!dig(c.convenio)) f.push('código do cedente (convênio)');
    // O código de transmissão é cedido pelo banco (H7815, Nota 3) — não dá para deduzir.
    if (!dig(c.codigoTransmissao)) f.push('código de transmissão (fornecido pelo banco)');
    if (!dig(c.carteira)) f.push('carteira');
    if (c.filial && !dig(c.filial.cnpj)) f.push('CNPJ da empresa');
    return f;
  }

  private async contaPronta(contaBancariaId: number, empresaId: number) {
    const c = await this.prisma.contaBancaria.findFirst({ where: { id: contaBancariaId, empresaId }, include: { filial: true } });
    if (!c) throw new NotFoundException('Conta bancária não encontrada.');
    const faltas = this.faltando(c);
    if (faltas.length) throw new BadRequestException(`Conta ${c.banco} sem dados p/ remessa: ${faltas.join(', ')}. Preencha em Empresas › Contas bancárias.`);
    return c;
  }

  private cedente(c: Awaited<ReturnType<BancosService['contaPronta']>>): CedenteSantander {
    return {
      cnpj: dig(c.cedenteDocumento || c.filial.cnpj), nome: c.cedenteNome || c.filial.nomeFantasia || c.filial.nome,
      agencia: dig(c.agencia), agenciaDv: c.agenciaDv, conta: dig(c.conta), contaDv: c.contaDv,
      codigoCedente: dig(c.convenio), codigoTransmissao: c.codigoTransmissao, carteira: dig(c.carteira),
      jurosMensal: c.jurosMensal != null ? Number(c.jurosMensal) : null, multaPercent: c.multaPercent != null ? Number(c.multaPercent) : null,
      diasProtesto: c.diasBaixaProtesto,
    };
  }

  /**
   * Gera a remessa de cobrança: reserva o nosso número de cada título, monta o arquivo
   * CNAB 240 e grava boletos (status "remessa") + a remessa. Tudo em uma transação
   * curta (os dados já vêm lidos de fora — ver [neon-p2028]).
   */
  async gerarRemessa(empresaId: number, usuario: string, contaBancariaId: number, ids: number[]) {
    const conta = await this.contaPronta(contaBancariaId, empresaId);
    const ced = this.cedente(conta);
    const titulos = await this.prisma.contaReceber.findMany({
      where: { id: { in: ids }, empresaId },
      include: { boletos: { where: { status: { in: ['gerado', 'remessa', 'registrado'] } }, select: { id: true, status: true, nossoNumero: true } } },
      orderBy: { vencimento: 'asc' },
    });
    if (titulos.length !== ids.length) throw new BadRequestException('Algum título selecionado não existe nesta empresa.');
    // ContaReceber guarda só o clienteId (sem relação): busca os pagadores de uma vez.
    const clientes = new Map(
      (await this.prisma.cliente.findMany({ where: { id: { in: [...new Set(titulos.map((t) => t.clienteId))] } } })).map((c) => [c.id, c]),
    );
    const erros: string[] = [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    for (const t of titulos) {
      const saldo = t.valor.minus(t.pago);
      const c = clientes.get(t.clienteId);
      const ref = `${t.documento || '#' + t.id} (${c?.nome ?? 'cliente #' + t.clienteId})`;
      if (!c) { erros.push(`${ref}: cliente não encontrado`); continue; }
      if (saldo.lessThanOrEqualTo(0)) erros.push(`${ref}: já quitado`);
      if (t.boletos.length) erros.push(`${ref}: já tem boleto ${t.boletos[0].status} (nosso nº ${t.boletos[0].nossoNumero})`);
      if (new Date(t.vencimento) < hoje) erros.push(`${ref}: vencimento no passado — ajuste a data antes de registrar`);
      const faltas: string[] = [];
      if (!(dig(c.cnpjCpf).length === 11 || dig(c.cnpjCpf).length === 14)) faltas.push('CPF/CNPJ');
      if (!c.logradouro) faltas.push('endereço');
      if (!c.municipio) faltas.push('cidade');
      if (!c.uf) faltas.push('UF');
      if (dig(c.cep).length !== 8) faltas.push('CEP');
      if (faltas.length) erros.push(`${ref}: cadastro do cliente sem ${faltas.join(', ')}`);
    }
    if (erros.length) throw new BadRequestException('Não foi possível gerar a remessa:\n' + erros.join('\n'));

    const nsa = conta.remessaSeq + 1;
    let proximo = conta.proximoNossoNumero;
    const agora = new Date();
    const linhas: TituloRemessa[] = [];
    const boletosData: Prisma.BoletoCreateManyInput[] = [];
    for (const t of titulos) {
      const nn = String(proximo++).padStart(12, '0');
      const saldo = Number(t.valor.minus(t.pago));
      const venc = new Date(t.vencimento);
      const seu = (t.documento ? `${t.documento}` : `TIT${t.id}`).slice(0, 15);
      const c = clientes.get(t.clienteId)!;
      linhas.push({
        nossoNumero: nn, seuNumero: seu, valor: saldo, vencimento: venc, emissao: agora,
        sacado: {
          tipo: dig(c.cnpjCpf).length === 11 ? 'CPF' : 'CNPJ', documento: dig(c.cnpjCpf), nome: c.nome,
          endereco: [c.logradouro, c.numeroEndereco].filter(Boolean).join(', '), bairro: c.bairro || '', cep: dig(c.cep), cidade: c.municipio || '', uf: c.uf || '',
        },
      });
      const cb = codigoBarrasELinha(ced, nn, saldo, venc);
      boletosData.push({
        empresaId, contaBancariaId: conta.id, contaReceberId: t.id, nossoNumero: nn, nossoNumeroDv: cb.nossoNumeroDv, seuNumero: seu,
        valor: new Prisma.Decimal(saldo.toFixed(2)), vencimento: venc, status: 'remessa', linhaDigitavel: cb.linhaDigitavel, codigoBarras: cb.codigoBarras, criadoPor: usuario,
      });
    }
    const arq = gerarRemessaSantander240(ced, linhas, nsa, agora);
    const valorTotal = linhas.reduce((s, l) => s + l.valor, 0);

    const remessa = await this.prisma.$transaction(async (tx) => {
      const r = await tx.remessaBancaria.create({
        data: { empresaId, contaBancariaId: conta.id, tipo: 'cobranca', layout: '240', sequencial: nsa, nomeArquivo: arq.nomeArquivo, conteudo: arq.conteudo, qtdTitulos: linhas.length, valorTotal: new Prisma.Decimal(valorTotal.toFixed(2)), geradaPor: usuario },
      });
      await tx.boleto.createMany({ data: boletosData.map((b) => ({ ...b, remessaId: r.id })) });
      await tx.contaBancaria.update({ where: { id: conta.id }, data: { remessaSeq: nsa, proximoNossoNumero: proximo } });
      return r;
    }, { timeout: 20000, maxWait: 10000 });
    this.logger.log(`Remessa ${remessa.nomeArquivo} (NSA ${nsa}) gerada: ${linhas.length} título(s), R$ ${valorTotal.toFixed(2)} — ${usuario}`);
    return { id: remessa.id, nomeArquivo: remessa.nomeArquivo, sequencial: nsa, qtdTitulos: linhas.length, valorTotal, boletos: boletosData.map((b) => ({ contaReceberId: b.contaReceberId, nossoNumero: `${b.nossoNumero}-${b.nossoNumeroDv}`, linhaDigitavel: b.linhaDigitavel })) };
  }

  async remessas(empresaId: number, contaBancariaId?: number) {
    return this.prisma.remessaBancaria.findMany({
      where: { empresaId, ...(contaBancariaId ? { contaBancariaId } : {}) },
      select: { id: true, contaBancariaId: true, tipo: true, layout: true, sequencial: true, nomeArquivo: true, qtdTitulos: true, valorTotal: true, status: true, geradaEm: true, geradaPor: true, enviadaEm: true, contaBancaria: { select: { banco: true, agencia: true, conta: true, filial: { select: { nome: true } } } } },
      orderBy: { id: 'desc' }, take: 100,
    });
  }

  async arquivoRemessa(id: number, empresaId: number) {
    const r = await this.prisma.remessaBancaria.findFirst({ where: { id, empresaId } });
    if (!r) throw new NotFoundException('Remessa não encontrada.');
    return { nomeArquivo: r.nomeArquivo, conteudo: r.conteudo };
  }

  async marcarEnviada(id: number, empresaId: number) {
    const r = await this.prisma.remessaBancaria.findFirst({ where: { id, empresaId } });
    if (!r) throw new NotFoundException('Remessa não encontrada.');
    return this.prisma.remessaBancaria.update({ where: { id }, data: { status: 'enviada', enviadaEm: new Date() } });
  }

  /**
   * Processa o arquivo de RETORNO: confirma registros, dá BAIXA AUTOMÁTICA nos liquidados
   * (via ContasReceberService.baixar — mesma regra da baixa manual, inclusive comissão),
   * marca baixas/rejeições. Idempotente por boleto: título já pago não é baixado de novo.
   */
  async processarRetorno(empresaId: number, usuario: string, contaBancariaId: number, nomeArquivo: string, conteudo: string) {
    const conta = await this.prisma.contaBancaria.findFirst({ where: { id: contaBancariaId, empresaId } });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada.');
    let lido;
    try { lido = lerRetornoSantander240(conteudo); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (lido.banco !== '033') throw new BadRequestException(`O arquivo é do banco ${lido.banco}, não do Santander (033).`);

    const resumo: Array<Record<string, unknown>> = [];
    let baixados = 0;
    const retorno = await this.prisma.retornoBancario.create({
      data: { empresaId, contaBancariaId, nomeArquivo, conteudo, processadoPor: usuario, qtdRegistros: lido.ocorrencias.length },
    });
    for (const o of lido.ocorrencias) {
      const boleto = await this.prisma.boleto.findFirst({ where: { contaBancariaId, nossoNumero: o.nossoNumero }, include: { contaReceber: true } });
      const item: Record<string, unknown> = { nossoNumero: `${o.nossoNumero}-${o.nossoNumeroDv}`, seuNumero: o.seuNumero, codigo: o.codigo, descricao: o.descricao, motivos: o.motivos, valorTitulo: o.valorTitulo, valorPago: o.valorPago, tarifa: o.tarifa, data: o.dataOcorrencia, credito: o.dataCredito };
      if (!boleto) { item.resultado = 'boleto não encontrado neste ERP'; resumo.push(item); continue; }
      item.contaReceberId = boleto.contaReceberId;
      const desc = `${o.codigo} ${o.descricao}${o.motivos.length ? ' (' + o.motivos.join(',') + ')' : ''}`;
      const base: Prisma.BoletoUpdateInput = { ocorrencia: desc, retorno: { connect: { id: retorno.id } } };
      try {
        if (LIQUIDACOES.has(o.codigo)) {
          if (boleto.status === 'pago') { item.resultado = 'já estava pago (ignorado)'; }
          else {
            const t = boleto.contaReceber;
            const saldo = Number(t.valor.minus(t.pago));
            const recebido = o.valorPago > 0 ? o.valorPago : o.valorTitulo;
            const baixa = Math.min(recebido, saldo);
            const juros = Math.max(0, recebido - saldo);
            if (baixa > 0) await this.receber.baixar(t.id, empresaId, Number(baixa.toFixed(2)), Number(juros.toFixed(2)));
            await this.prisma.boleto.update({ where: { id: boleto.id }, data: { ...base, status: 'pago', valorPago: new Prisma.Decimal(recebido.toFixed(2)), pagoEm: o.dataCredito || o.dataOcorrencia || new Date() } });
            baixados++;
            item.resultado = `BAIXADO: R$ ${baixa.toFixed(2)}${juros > 0 ? ' + juros/multa R$ ' + juros.toFixed(2) : ''}${o.tarifa > 0 ? ' (tarifa R$ ' + o.tarifa.toFixed(2) + ')' : ''}`;
          }
        } else if (o.codigo === '02') {
          await this.prisma.boleto.update({ where: { id: boleto.id }, data: { ...base, status: boleto.status === 'pago' ? 'pago' : 'registrado' } });
          item.resultado = 'registrado no banco';
        } else if (BAIXAS.has(o.codigo)) {
          await this.prisma.boleto.update({ where: { id: boleto.id }, data: { ...base, status: boleto.status === 'pago' ? 'pago' : 'baixado' } });
          item.resultado = 'baixado no banco (sem pagamento)';
        } else if (REJEICOES.has(o.codigo)) {
          await this.prisma.boleto.update({ where: { id: boleto.id }, data: { ...base, status: 'rejeitado', motivoRejeicao: o.motivos.join(',') || null } });
          item.resultado = 'REJEITADO — corrija e gere nova remessa';
        } else {
          await this.prisma.boleto.update({ where: { id: boleto.id }, data: base });
          item.resultado = 'ocorrência registrada';
        }
      } catch (e) { item.resultado = 'ERRO: ' + (e as Error).message; }
      resumo.push(item);
    }
    await this.prisma.retornoBancario.update({ where: { id: retorno.id }, data: { qtdBaixados: baixados, resumo: resumo as unknown as Prisma.InputJsonValue } });
    this.logger.log(`Retorno ${nomeArquivo}: ${lido.ocorrencias.length} ocorrência(s), ${baixados} baixa(s) — ${usuario}`);
    return { id: retorno.id, qtdRegistros: lido.ocorrencias.length, qtdBaixados: baixados, nsa: lido.nsa, dataGeracao: lido.dataGeracao, itens: resumo };
  }

  async retornos(empresaId: number, contaBancariaId?: number) {
    return this.prisma.retornoBancario.findMany({
      where: { empresaId, ...(contaBancariaId ? { contaBancariaId } : {}) },
      select: { id: true, contaBancariaId: true, nomeArquivo: true, processadoEm: true, processadoPor: true, qtdRegistros: true, qtdBaixados: true, resumo: true },
      orderBy: { id: 'desc' }, take: 50,
    });
  }

  /** Boleto vigente por título (p/ a lista de contas a receber). */
  async boletosPorTitulo(empresaId: number, ids: number[]) {
    const bs = await this.prisma.boleto.findMany({
      where: { empresaId, contaReceberId: { in: ids } },
      select: { id: true, contaReceberId: true, nossoNumero: true, nossoNumeroDv: true, status: true, linhaDigitavel: true, remessaId: true, ocorrencia: true, pagoEm: true },
      orderBy: { id: 'desc' },
    });
    const out: Record<number, (typeof bs)[number]> = {};
    for (const b of bs) if (!out[b.contaReceberId]) out[b.contaReceberId] = b; // o mais recente
    return out;
  }

  /** PDF do boleto do título (recibo + ficha de compensação com código de barras). */
  async boletoPdf(contaReceberId: number, empresaId: number) {
    const b = await this.prisma.boleto.findFirst({
      where: { empresaId, contaReceberId, status: { in: ['gerado', 'remessa', 'registrado', 'pago'] } },
      orderBy: { id: 'desc' },
      include: { contaReceber: true, contaBancaria: { include: { filial: true } } },
    });
    if (!b) throw new NotFoundException('Este título ainda não tem boleto — gere a remessa primeiro.');
    const cli = await this.prisma.cliente.findUnique({ where: { id: b.contaReceber.clienteId } });
    if (!cli) throw new NotFoundException('Cliente (pagador) do título não encontrado.');
    const c = b.contaBancaria, f = c.filial;
    const instr = [
      c.instrucaoCaixa || '',
      c.jurosMensal && Number(c.jurosMensal) > 0 ? `Após o vencimento cobrar juros de ${Number(c.jurosMensal).toFixed(2)}% ao mês.` : '',
      c.multaPercent && Number(c.multaPercent) > 0 ? `Após o vencimento cobrar multa de ${Number(c.multaPercent).toFixed(2)}%.` : '',
      c.diasBaixaProtesto ? `Protestar após ${c.diasBaixaProtesto} dias do vencimento.` : '',
    ].filter(Boolean);
    const pdf = await gerarBoletoPdf({
      banco: { codigo: '033', nome: 'Santander' },
      beneficiario: {
        nome: c.cedenteNome || f.nomeFantasia || f.nome, cnpj: dig(c.cedenteDocumento || f.cnpj),
        endereco: [f.logradouro, f.numeroEndereco, f.bairro, f.municipio && f.uf ? `${f.municipio}/${f.uf}` : '', f.cep].filter(Boolean).join(', '),
        agenciaConta: `${c.agencia}${c.agenciaDv ? '-' + c.agenciaDv : ''} / ${c.conta}${c.contaDv ? '-' + c.contaDv : ''}`, codigoCedente: c.convenio || '',
      },
      pagador: { nome: cli.nome, documento: dig(cli.cnpjCpf), endereco: [cli.logradouro, cli.numeroEndereco, cli.bairro, cli.municipio && cli.uf ? `${cli.municipio}/${cli.uf}` : '', cli.cep].filter(Boolean).join(', ') },
      nossoNumero: `${b.nossoNumero}-${b.nossoNumeroDv || dvNossoNumeroSantander(b.nossoNumero)}`, seuNumero: b.seuNumero || String(b.contaReceberId),
      carteira: c.carteira || '', especie: 'DM', aceite: 'N', dataDocumento: b.criadoEm, dataProcessamento: new Date(), vencimento: b.vencimento,
      valor: Number(b.valor), linhaDigitavel: b.linhaDigitavel || '', codigoBarras: b.codigoBarras || '', instrucoes: instr,
    });
    return { content: pdf, filename: `boleto-${b.nossoNumero}.pdf`, contentType: 'application/pdf' };
  }
}
