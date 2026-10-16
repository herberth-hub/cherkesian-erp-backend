/**
 * Completar o cadastro fiscal do cliente pelo CNPJ.
 *
 * A emissão parava em "Dados fiscais incompletos para emissão real: Endereço
 * fiscal do cliente" (EXP-0017 · Condomínio Shopping Center Galleria) e a saída
 * era digitar município, UF, CEP e código IBGE à mão — onde nasce o IBGE trocado,
 * que é rejeição na SEFAZ. Agora vem da Receita.
 */
import { ClientesService } from './clientes.service';

const CNPJ = { razaoSocial: 'CONDOMINIO SHOPPING CENTER GALLERIA', nomeFantasia: 'GALLERIA', logradouro: 'R MARIA MONTEIRO', numero: '1000', bairro: 'CAMBUI', municipio: 'CAMPINAS', uf: 'SP', cep: '13025151', telefone: '1932525000', email: 'FISCAL@GALLERIA.COM.BR', situacao: 'ATIVA' };
const CEP = { cep: '13025151', logradouro: 'R MARIA MONTEIRO', bairro: 'CAMBUI', municipio: 'CAMPINAS', uf: 'SP', codMunicipio: '3509502' };

function servico(cliente: Record<string, unknown>, lookup?: { cnpj?: unknown; cep?: unknown }) {
  const gravado: { data?: Record<string, string> } = {};
  const prisma = {
    cliente: {
      findUnique: () => Promise.resolve(cliente),
      update: ({ data }: { data: Record<string, string> }) => { gravado.data = data; return Promise.resolve({ ...cliente, ...data }); },
    },
  };
  const look = {
    cnpj: () => (lookup?.cnpj === 'erro' ? Promise.reject(new Error('CNPJ não encontrado')) : Promise.resolve(lookup?.cnpj ?? CNPJ)),
    cep: () => (lookup?.cep === 'erro' ? Promise.reject(new Error('CEP fora do ar')) : Promise.resolve(lookup?.cep ?? CEP)),
  };
  return { svc: new ClientesService(prisma as never, look as never), gravado };
}

const BASE = { id: 7, empresaId: 1, nome: 'CONDOMINIO SHOPPING CENTER GALLERIA', fantasia: null, cnpjCpf: '58.123.456/0001-90', municipio: null, uf: null, cep: null, codMunicipio: null, logradouro: null, numeroEndereco: null, bairro: null, telefone: null, email: null, cidadeUf: null, inscricaoEstadual: null };

describe('completar cadastro fiscal pelo CNPJ', () => {
  it('preenche o endereço fiscal e o código IBGE, e some com o bloqueio da NF', async () => {
    const { svc, gravado } = servico({ ...BASE });
    const r = await svc.completarFiscal(7, 1);
    expect(gravado.data).toMatchObject({ municipio: 'CAMPINAS', uf: 'SP', cep: '13025151', codMunicipio: '3509502' });
    expect(r.faltam).toEqual([]);
    expect(r.preenchidos).toEqual(expect.arrayContaining(['município', 'UF', 'CEP', 'código IBGE']));
    expect(r.situacao).toBe('ATIVA');
  });

  it('NÃO sobrescreve o que já foi conferido e digitado', async () => {
    const { svc, gravado } = servico({ ...BASE, municipio: 'VALINHOS', uf: 'SP', cep: '13270000', codMunicipio: '3556206' });
    const r = await svc.completarFiscal(7, 1);
    expect(gravado.data?.municipio).toBeUndefined();
    expect(gravado.data?.codMunicipio).toBeUndefined();
    expect(r.preenchidos).not.toContain('município');
  });

  it('com sobrescrever=true, a Receita manda', async () => {
    const { svc, gravado } = servico({ ...BASE, municipio: 'VALINHOS', cep: '13270000' });
    await svc.completarFiscal(7, 1, true);
    expect(gravado.data).toMatchObject({ municipio: 'CAMPINAS', cep: '13025151' });
  });

  it('a inscrição estadual NUNCA é preenchida — IE não se inventa', async () => {
    const { svc, gravado } = servico({ ...BASE });
    const r = await svc.completarFiscal(7, 1);
    expect(gravado.data?.inscricaoEstadual).toBeUndefined();
    expect(r.avisoIe).toMatch(/inscrição estadual não vem da Receita/i);
  });

  it('cliente pessoa física (CPF) é recusado com o motivo certo', async () => {
    const { svc } = servico({ ...BASE, cnpjCpf: '123.456.789-09' });
    await expect(svc.completarFiscal(7, 1)).rejects.toThrow(/pessoa física/i);
  });

  it('cliente sem CNPJ pede o CNPJ antes', async () => {
    const { svc } = servico({ ...BASE, cnpjCpf: null });
    await expect(svc.completarFiscal(7, 1)).rejects.toThrow(/sem CNPJ cadastrado/i);
  });

  it('cliente de outra empresa não é encontrado', async () => {
    const { svc } = servico({ ...BASE, empresaId: 99 });
    await expect(svc.completarFiscal(7, 1)).rejects.toThrow(/não encontrado/i);
  });

  it('CEP fora do ar não derruba o resto — grava o que deu e avisa o que falta', async () => {
    const { svc, gravado } = servico({ ...BASE }, { cep: 'erro' });
    const r = await svc.completarFiscal(7, 1);
    expect(gravado.data).toMatchObject({ municipio: 'CAMPINAS', uf: 'SP' });
    expect(gravado.data?.codMunicipio).toBeUndefined();
    expect(r.faltam).toEqual([]); // município/UF/CEP já bastam p/ a trava da NF
  });

  it('nada a completar quando já está tudo preenchido', async () => {
    const { svc, gravado } = servico({ ...BASE, municipio: 'CAMPINAS', uf: 'SP', cep: '13025151', codMunicipio: '3509502', logradouro: 'R X', numeroEndereco: '1', bairro: 'B', telefone: 'x', email: 'a@b.c', cidadeUf: 'CAMPINAS/SP', fantasia: 'G' });
    const r = await svc.completarFiscal(7, 1);
    expect(gravado.data).toBeUndefined();
    expect(r.mensagem).toMatch(/Nada a completar/i);
  });

  it('a razão social só entra se o cadastro estiver sem nome', async () => {
    const { svc, gravado } = servico({ ...BASE, nome: 'NOME QUE O VENDEDOR DIGITOU' });
    await svc.completarFiscal(7, 1);
    expect(gravado.data?.nome).toBeUndefined();
  });
});
