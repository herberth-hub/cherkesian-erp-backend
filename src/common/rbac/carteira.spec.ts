/**
 * Carteira do vendedor. Os dados abaixo são os reais de out/2026: a carteira
 * da Sabrina vive em `Cliente.representante` ("SABRINA CAMPOS"), e
 * `Pedido.vendedorId` está VAZIO — era por isso que ela não via pedido nenhum
 * na tela de Pedidos e via a empresa inteira no dashboard e nas anomalias.
 */
import { clientesDaCarteira, ehVendedor, escopoCarteira } from './carteira';
import { AuthUser } from '../../auth/auth.types';

const SABRINA = { sub: 15, nome: 'Sabrina Campos', usuario: 'sabrina', acesso: 'vendedor', empresaId: 1 } as AuthUser;
const ADMIN = { sub: 1, nome: 'Herberth Cherkesian', usuario: 'admin', acesso: 'total', empresaId: 1 } as AuthUser;

const prismaCom = (
  clientes: Array<{ id: number; representante: string | null }>,
  contratos: Array<{ clienteId: number; vendedor: string | null }> = [],
  pedidos: Array<{ clienteId: number; comissaoRepresentante: string | null; vendedorId: number | null }> = [],
) => ({
  cliente: { findMany: () => Promise.resolve(clientes) },
  contrato: { findMany: () => Promise.resolve(contratos) },
  pedido: { findMany: () => Promise.resolve(pedidos) },
});

describe('carteira do vendedor', () => {
  it('pega os clientes pelo representante, ignorando acento e caixa', async () => {
    const prisma = prismaCom([
      { id: 10, representante: 'SABRINA CAMPOS' },
      { id: 11, representante: ' sabrina campos ' },
      { id: 12, representante: 'RITA' },
      { id: 13, representante: null },
    ]);
    const ids = await clientesDaCarteira(prisma as never, SABRINA);
    expect(ids.sort()).toEqual([10, 11]);
  });

  it('soma os clientes vindos de contrato e de comissão do pedido', async () => {
    const prisma = prismaCom(
      [{ id: 10, representante: 'SABRINA CAMPOS' }],
      [{ clienteId: 95, vendedor: 'SABRINA CAMPOS' }, { clienteId: 81, vendedor: 'HERBERTH' }],
      [{ clienteId: 30, comissaoRepresentante: 'SABRINA CAMPOS', vendedorId: null }, { clienteId: 40, comissaoRepresentante: 'RITA', vendedorId: null }],
    );
    const ids = await clientesDaCarteira(prisma as never, SABRINA);
    expect(ids.sort((a, b) => a - b)).toEqual([10, 30, 95]);
  });

  it('vendedorId continua valendo quando preenchido (caminho novo)', async () => {
    const prisma = prismaCom([], [], [{ clienteId: 77, comissaoRepresentante: null, vendedorId: 15 }]);
    await expect(clientesDaCarteira(prisma as never, SABRINA)).resolves.toEqual([77]);
  });

  it('não confunde vendedores de nomes parecidos', async () => {
    const prisma = prismaCom([
      { id: 1, representante: 'SABRINA CAMPOS' },
      { id: 2, representante: 'SABRINA CAMPOS SILVA' }, // outra pessoa
      { id: 3, representante: 'CAMPOS' },
    ]);
    await expect(clientesDaCarteira(prisma as never, SABRINA)).resolves.toEqual([1]);
  });

  it('carteira vazia devolve lista vazia — e vazio significa VER NADA, não ver tudo', async () => {
    const prisma = prismaCom([{ id: 1, representante: 'RITA' }]);
    const esc = await escopoCarteira(prisma as never, SABRINA);
    expect(esc.limitado).toBe(true);
    expect(esc.clienteIds).toEqual([]);
  });

  it('quem não é vendedor não é limitado', async () => {
    const prisma = prismaCom([{ id: 1, representante: 'SABRINA CAMPOS' }]);
    const esc = await escopoCarteira(prisma as never, ADMIN);
    expect(esc.limitado).toBe(false);
    expect(ehVendedor(ADMIN)).toBe(false);
    expect(ehVendedor(SABRINA)).toBe(true);
  });
});
