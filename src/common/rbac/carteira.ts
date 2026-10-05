import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../auth/auth.types';

/**
 * CARTEIRA DO VENDEDOR — quem é cliente de quem.
 *
 * O perfil `vendedor` só pode ver o que é da carteira dele: clientes, pedidos,
 * anomalias, dashboard. Até out/2026 o escopo existia só em Pedidos e olhava
 * `Pedido.vendedorId` — campo que está VAZIO nos dados reais. Resultado: a
 * vendedora não via nenhum pedido na tela de Pedidos e via a empresa inteira no
 * dashboard, nas anomalias e no cadastro de clientes.
 *
 * Na prática a carteira é gravada por NOME, em três lugares:
 *   • `Cliente.representante`            (é o vínculo principal — 10 clientes dela)
 *   • `Contrato.vendedor`
 *   • `Pedido.comissaoRepresentante`
 * `Pedido.vendedorId` continua valendo quando preenchido; é o caminho novo.
 */

/** Normaliza nome p/ comparar: sem acento, sem espaço nas pontas, maiúsculo. */
const norm = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

export const ehVendedor = (user: AuthUser): boolean => user.acesso === 'vendedor';

/** Ids dos clientes da carteira do vendedor. Vazio = carteira vazia (vê nada). */
export async function clientesDaCarteira(prisma: PrismaService, user: AuthUser): Promise<number[]> {
  const alvo = norm(user.nome);
  if (!alvo) return [];
  const [cls, cts, peds] = await Promise.all([
    prisma.cliente.findMany({ where: { empresaId: user.empresaId }, select: { id: true, representante: true } }),
    prisma.contrato.findMany({ where: { empresaId: user.empresaId }, select: { clienteId: true, vendedor: true } }),
    prisma.pedido.findMany({ where: { empresaId: user.empresaId }, select: { clienteId: true, comissaoRepresentante: true, vendedorId: true } }),
  ]);
  const ids = new Set<number>();
  for (const c of cls) if (norm(c.representante) === alvo) ids.add(c.id);
  for (const c of cts) if (norm(c.vendedor) === alvo) ids.add(c.clienteId);
  for (const p of peds) if (p.vendedorId === user.sub || norm(p.comissaoRepresentante) === alvo) ids.add(p.clienteId);
  return [...ids];
}

/**
 * Escopo pronto p/ usar nos serviços. Para quem não é vendedor devolve
 * `{ limitado: false }` e nada muda — nenhum outro perfil é afetado.
 */
export async function escopoCarteira(
  prisma: PrismaService,
  user: AuthUser,
): Promise<{ limitado: boolean; clienteIds: number[] }> {
  if (!ehVendedor(user)) return { limitado: false, clienteIds: [] };
  return { limitado: true, clienteIds: await clientesDaCarteira(prisma, user) };
}
