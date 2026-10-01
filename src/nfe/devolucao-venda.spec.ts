/**
 * NF de entrada de DEVOLUÇÃO DE VENDA (anulação).
 *
 * Nasceu da NF 1/002778 (Consigaz, set/2026): saiu para o CNPJ da matriz de
 * Paulínia em vez da unidade de Barueri. Passou das 24h, então não cabia
 * cancelamento, e CC-e não troca destinatário.
 */
import { NfeService } from './nfe.service';

const CHAVE = '35260945704956000102550010000027781872361850';

const NOTA_OK = {
  id: 179,
  empresaId: 1,
  filialId: 3,
  pedidoId: 193,
  numero: '1/002778',
  tipo: 'venda',
  status: 'autorizada',
  chave: 'NFe' + CHAVE,
  valor: 550.06,
  payloadJson: {
    uf_destinatario: 'SP',
    nome_destinatario: 'CONSIGAZ-DISTRIBUIDORA DE GAS LTDA',
    cnpj_destinatario: '01597589000110',
    inscricao_estadual_destinatario: '513032959117',
    municipio_destinatario: 'PAULINIA',
    items: [{ numero_item: 1, cfop: '5101', descricao: 'Calca', valor_bruto: 461.4, icms_valor: 83.05, icms_aliquota: 18, icms_situacao_tributaria: '00', pis_valor: 6.24, cofins_valor: 28.75 }],
  },
};
const FILIAL = { id: 3, cnpj: '45704956000102', uf: 'SP', nfeSerie: '1', nfeProximoNumero: 2811, regimeTributario: 'lucro_real' };

function servico(nota: Record<string, unknown> | null, devolucaoExistente: Record<string, unknown> | null = null) {
  const prisma = {
    notaFiscal: {
      findUnique: () => Promise.resolve(nota),
      findFirst: () => Promise.resolve(devolucaoExistente),
    },
    filial: { findUnique: () => Promise.resolve(FILIAL) },
  };
  return new NfeService(prisma as never, { get: () => undefined } as never, {} as never);
}
const emitir = (s: NfeService, dto: Record<string, unknown> = {}) =>
  s.emitirDevolucaoVenda({ notaFiscalId: 179, simular: true, ...dto }, 1, 'herberth') as Promise<Record<string, unknown>>;

describe('devolução de venda (anulação)', () => {
  it('monta a entrada espelhando os tributos e só trocando o CFOP', async () => {
    const r = await emitir(servico(NOTA_OK));
    const pay = r.payloadPreview as Record<string, unknown>;
    expect(r.status).toBe('rascunho');
    expect(pay.tipo_documento).toBe(0); // ENTRADA
    expect(pay.finalidade_emissao).toBe(4); // devolução
    expect(pay.notas_referenciadas).toEqual([{ chave_nfe: CHAVE }]);
    const it = (pay.items as Array<Record<string, unknown>>)[0];
    expect(it.cfop).toBe('1202'); // virou entrada
    expect(it.icms_valor).toBe(83.05); // tributo espelhado, não recalculado
    expect(it.cofins_valor).toBe(28.75);
    expect(r.valorTotal).toBe(550.06);
    // o destinatário continua sendo quem recebeu a nota errada
    expect(pay.cnpj_destinatario).toBe('01597589000110');
  });

  it('usa 2202 quando o destinatário é de outro estado', async () => {
    const fora = { ...NOTA_OK, payloadJson: { ...NOTA_OK.payloadJson, uf_destinatario: 'MG' } };
    expect((await emitir(servico(fora))).cfop).toBe('2202');
  });

  it('respeita o CFOP informado pela contabilidade', async () => {
    expect((await emitir(servico(NOTA_OK), { cfop: '1949' })).cfop).toBe('1949');
  });

  it('recusa nota não autorizada', async () => {
    await expect(emitir(servico({ ...NOTA_OK, status: 'cancelada' }))).rejects.toThrow(/autorizada/i);
  });

  it('recusa nota que não é de venda', async () => {
    await expect(emitir(servico({ ...NOTA_OK, tipo: 'remessa' }))).rejects.toThrow(/VENDA/);
  });

  it('recusa nota sem chave de acesso', async () => {
    await expect(emitir(servico({ ...NOTA_OK, chave: null }))).rejects.toThrow(/chave de acesso/i);
  });

  it('recusa nota sem itens gravados', async () => {
    await expect(emitir(servico({ ...NOTA_OK, payloadJson: { uf_destinatario: 'SP' } }))).rejects.toThrow(/itens gravados/i);
  });

  it('não devolve duas vezes a mesma nota', async () => {
    await expect(emitir(servico(NOTA_OK, { numero: '1/002811' }))).rejects.toThrow(/já foi devolvida/i);
  });
});
