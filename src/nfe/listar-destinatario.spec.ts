/**
 * A lista de notas precisa mostrar o DESTINATÁRIO mesmo quando a nota não tem
 * cliente cadastrado nem pedido (emissão avulsa). Sem isso a nota aparece com
 * "—" e não é achada pela busca por nome — foi o caso da 1/002812 (Consigaz).
 */
import { NfeService } from './nfe.service';

function servico(notas: Array<Record<string, unknown>>) {
  const vazio = { findMany: () => Promise.resolve([]) };
  const prisma = {
    notaFiscal: { findMany: () => Promise.resolve(notas) },
    pedido: vazio,
    expedicao: vazio,
    fornecedor: vazio,
    cliente: vazio,
  };
  return new NfeService(prisma as never, { get: () => undefined } as never, {} as never);
}

describe('listar — destinatário na lista', () => {
  it('usa o nome do destinatário avulso gravado no payload', async () => {
    const svc = servico([
      { id: 1, numero: '1/002812', tipo: 'venda', pedidoId: null, expedicaoId: null, fornecedorId: null,
        payloadJson: { nome_destinatario: 'CONSIGAZ DISTRIBUIDORA DE GAS LTDA', email_destinatario: 'x@y.com' } },
    ]);
    const [n] = (await svc.listar(1)) as Array<Record<string, unknown>>;
    expect(n.clienteNome).toBe('CONSIGAZ DISTRIBUIDORA DE GAS LTDA');
    expect(n.clienteEmail).toBe('x@y.com');
  });

  it('sem payload e sem cliente, segue sem nome (não inventa)', async () => {
    const svc = servico([
      { id: 2, numero: '1/000100', tipo: 'venda', pedidoId: null, expedicaoId: null, fornecedorId: null, payloadJson: null },
    ]);
    const [n] = (await svc.listar(1)) as Array<Record<string, unknown>>;
    expect(n.clienteNome).toBeNull();
  });

  it('nome em branco no payload não vira destinatário vazio', async () => {
    const svc = servico([
      { id: 3, numero: '1/000101', tipo: 'venda', pedidoId: null, expedicaoId: null, fornecedorId: null,
        payloadJson: { nome_destinatario: '   ' } },
    ]);
    const [n] = (await svc.listar(1)) as Array<Record<string, unknown>>;
    expect(n.clienteNome).toBeNull();
  });
});
