import { Injectable, NotFoundException } from '@nestjs/common';
import { Empresa } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';

@Injectable()
export class EmpresaService {
  constructor(private readonly prisma: PrismaService) {}

  async get(empresaId: number): Promise<Empresa> {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return empresa;
  }

  update(empresaId: number, dto: UpdateEmpresaDto): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id: empresaId }, data: dto });
  }

  /**
   * Diagnóstico de prontidão fiscal: aponta o que falta para emitir NF-e real.
   * (Não substitui a validação da contabilidade sobre CST/CFOP/alíquotas.)
   */
  async prontidaoFiscal(empresaId: number) {
    const empresa = await this.get(empresaId);
    const pendencias: string[] = [];
    const obrig: Array<[keyof Empresa, string]> = [
      ['cnpj', 'CNPJ'],
      ['inscricaoEstadual', 'Inscrição Estadual'],
      ['logradouro', 'Logradouro'],
      ['numeroEndereco', 'Número'],
      ['bairro', 'Bairro'],
      ['municipio', 'Município'],
      ['codMunicipio', 'Código IBGE do município'],
      ['uf', 'UF'],
      ['cep', 'CEP'],
    ];
    for (const [campo, rotulo] of obrig) {
      if (!empresa[campo]) pendencias.push(`Empresa: ${rotulo}`);
    }
    const produtosSemNcm = await this.prisma.produto.count({
      where: { empresaId, OR: [{ ncm: null }, { cfop: null }] },
    });
    if (produtosSemNcm > 0) pendencias.push(`${produtosSemNcm} produto(s) sem NCM/CFOP`);

    return {
      pronto: pendencias.length === 0,
      pendencias,
      integracao: process.env.FOCUS_NFE_TOKEN
        ? `Provedor Focus NFe configurado (ambiente: ${process.env.NFE_AMBIENTE || 'homologacao'}).`
        : 'FOCUS_NFE_TOKEN não configurado — emissão em modo simulado.',
    };
  }
}
