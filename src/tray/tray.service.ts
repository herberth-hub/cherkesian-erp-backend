import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TrayConta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { proximoSequencial } from '../common/utils/codigo.util';

/**
 * Integração Tray Commerce (por LOJA). A empresa pode ter várias lojas
 * (ex.: Consigaz, Copa Energia). Cada loja guarda seu consumer key/secret,
 * a URL da web_api e os tokens (access/refresh) para consultar pedidos.
 */
@Injectable()
export class TrayService {
  private readonly log = new Logger('Tray');
  constructor(private readonly prisma: PrismaService) {}

  private semSegredo(c: TrayConta) {
    return {
      id: c.id,
      apelido: c.apelido,
      apiUrl: c.apiUrl,
      configurado: !!(c.consumerKey && c.apiUrl),
      conectado: !!c.accessToken,
      temSecret: !!c.consumerSecret,
      temCode: !!c.code,
      storeId: c.storeId,
      conectadoEm: c.conectadoEm,
      tokenExpira: c.tokenExpira,
      ativa: c.ativa,
    };
  }

  async listar(empresaId: number) {
    const contas = await this.prisma.trayConta.findMany({ where: { empresaId }, orderBy: { id: 'asc' } });
    return contas.map((c) => this.semSegredo(c));
  }

  /** Cria uma nova loja ou atualiza uma existente (id). */
  async salvar(empresaId: number, dto: { id?: number; apelido?: string; consumerKey?: string; consumerSecret?: string; apiUrl?: string; code?: string }) {
    const apiUrl = (dto.apiUrl || '').trim().replace(/\/+$/, '') || undefined;
    if (dto.id) {
      const c = await this.prisma.trayConta.findUnique({ where: { id: dto.id } });
      if (!c || c.empresaId !== empresaId) throw new NotFoundException('Loja Tray não encontrada.');
      const upd = await this.prisma.trayConta.update({
        where: { id: dto.id },
        data: {
          apelido: dto.apelido?.trim() || undefined,
          consumerKey: dto.consumerKey?.trim() || undefined,
          consumerSecret: dto.consumerSecret?.trim() || undefined,
          apiUrl,
          code: dto.code?.trim() || undefined,
        },
      });
      return this.semSegredo(upd);
    }
    if (!dto.apelido?.trim()) throw new BadRequestException('Informe um nome para a loja (ex.: Consigaz).');
    const nova = await this.prisma.trayConta.create({
      data: {
        empresaId,
        apelido: dto.apelido.trim(),
        consumerKey: dto.consumerKey?.trim(),
        consumerSecret: dto.consumerSecret?.trim(),
        apiUrl,
        code: dto.code?.trim(),
      },
    });
    return this.semSegredo(nova);
  }

  async remover(empresaId: number, id: number) {
    const c = await this.prisma.trayConta.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException('Loja Tray não encontrada.');
    await this.prisma.trayConta.delete({ where: { id } });
    return { ok: true };
  }

  private async contaDaEmpresa(empresaId: number, id: number): Promise<TrayConta> {
    const c = await this.prisma.trayConta.findUnique({ where: { id } });
    if (!c || c.empresaId !== empresaId) throw new NotFoundException('Loja Tray não encontrada.');
    return c;
  }

  /** Troca o code pela 1ª dupla de tokens (autoriza a loja). */
  async conectar(empresaId: number, id: number) {
    const c = await this.contaDaEmpresa(empresaId, id);
    if (!c.consumerKey || !c.consumerSecret || !c.apiUrl || !c.code) {
      throw new BadRequestException('Preencha consumer key, secret, URL da API e o code de autorização antes de conectar.');
    }
    const body = new URLSearchParams({ consumer_key: c.consumerKey, consumer_secret: c.consumerSecret, code: c.code });
    const res = await this.trayFetch(`${c.apiUrl}/auth`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      this.log.warn(`Tray auth falhou: ${res.status} ${JSON.stringify(data)}`);
      throw new BadRequestException(`Tray: ${data?.message || data?.error || 'falha ao autorizar a loja'}.`);
    }
    const upd = await this.prisma.trayConta.update({
      where: { id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        tokenExpira: this.parseExpira(data.date_expiration_access_token),
        storeId: data.store_id ? String(data.store_id) : c.storeId,
        apiUrl: data.api_host ? String(data.api_host).replace(/\/+$/, '') : c.apiUrl,
        conectadoEm: new Date(),
      },
    });
    return this.semSegredo(upd);
  }

  async desconectar(empresaId: number, id: number) {
    await this.contaDaEmpresa(empresaId, id);
    const upd = await this.prisma.trayConta.update({
      where: { id },
      data: { accessToken: null, refreshToken: null, tokenExpira: null, conectadoEm: null },
    });
    return this.semSegredo(upd);
  }

  /** Access token válido; renova pelo refresh quando falta menos de 2 min. */
  private async tokenValido(c: TrayConta): Promise<string> {
    if (!c.accessToken) throw new BadRequestException(`Loja "${c.apelido}" não está conectada.`);
    const margem = 2 * 60 * 1000;
    if (c.tokenExpira && c.tokenExpira.getTime() - margem > Date.now()) return c.accessToken;
    if (!c.refreshToken || !c.apiUrl) return c.accessToken;
    const res = await this.trayFetch(`${c.apiUrl}/auth?refresh_token=${encodeURIComponent(c.refreshToken)}`);
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      this.log.warn(`Tray refresh falhou: ${res.status} ${JSON.stringify(data)}`);
      return c.accessToken; // segue com o atual; se estiver expirado, a chamada falha e o usuário reconecta
    }
    await this.prisma.trayConta.update({
      where: { id: c.id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? c.refreshToken,
        tokenExpira: this.parseExpira(data.date_expiration_access_token),
      },
    });
    return data.access_token;
  }

  /** Lista pedidos recentes de uma loja. */
  async buscarPedidos(empresaId: number, id: number) {
    const c = await this.contaDaEmpresa(empresaId, id);
    const token = await this.tokenValido(c);
    const url = `${c.apiUrl}/orders?access_token=${encodeURIComponent(token)}&limit=30&sort=id_desc`;
    const data: any = await this.getJson(url);
    const orders: any[] = Array.isArray(data?.Orders) ? data.Orders.map((o: any) => o.Order ?? o) : [];
    const refs = orders.map((o) => `Tray ${o.id}`);
    const jaImport = new Set(
      (await this.prisma.pedido.findMany({ where: { empresaId, ordemCompraCliente: { in: refs } }, select: { ordemCompraCliente: true } }))
        .map((p) => p.ordemCompraCliente),
    );
    return orders.map((o) => ({
      id: String(o.id),
      data: o.date || o.created,
      status: o.status || o.status_id || '—',
      comprador: o.Customer?.name || o.customer_name || o.customer || 'Cliente Tray',
      total: Number(o.total) || 0,
      importado: jaImport.has(`Tray ${o.id}`),
    }));
  }

  /** Importa um pedido da loja Tray: cria/acha o cliente e gera um Pedido de venda. */
  async importarPedido(empresaId: number, id: number, orderId: string) {
    const c = await this.contaDaEmpresa(empresaId, id);
    const token = await this.tokenValido(c);
    const data: any = await this.getJson(`${c.apiUrl}/orders/${orderId}?access_token=${encodeURIComponent(token)}`);
    const o = data?.Order ?? data;
    if (!o?.id) throw new BadRequestException('Pedido da Tray não encontrado.');
    const ref = `Tray ${o.id}`;
    const existe = await this.prisma.pedido.findFirst({ where: { empresaId, ordemCompraCliente: ref } });
    if (existe) throw new BadRequestException(`Pedido ${o.id} já foi importado (${existe.numero}).`);

    const nome = o.Customer?.name || o.customer_name || o.customer || 'Cliente Tray';
    const doc = String(o.Customer?.cpf || o.Customer?.cnpj || o.customer_cnpj || o.customer_cpf || '').replace(/\D/g, '') || undefined;
    let cliente = doc ? await this.prisma.cliente.findFirst({ where: { empresaId, cnpjCpf: { contains: doc } } }) : null;
    if (!cliente) cliente = await this.prisma.cliente.findFirst({ where: { empresaId, nome: { equals: nome, mode: 'insensitive' } } });
    if (!cliente) cliente = await this.prisma.cliente.create({ data: { empresaId, nome, cnpjCpf: doc, obs: `Importado da Tray (${c.apelido})` } });

    const produtosTray: any[] = Array.isArray(o.ProductsSold) ? o.ProductsSold.map((x: any) => x.ProductsSold ?? x)
      : Array.isArray(o.products) ? o.products : [];
    // Catálogo do ERP p/ casar o item da Tray com um produto (SKU/referência/código/nome).
    const catalogo = await this.prisma.produto.findMany({ where: { empresaId }, select: { id: true, codigo: true, referencia: true, descricao: true, cor: true } });
    const itens = produtosTray.map((it: any) => {
      const m = this.matchProduto(it, catalogo);
      return {
        produtoId: m?.id,
        descricao: String(it.name || it.product_name || m?.descricao || 'Item Tray').slice(0, 200),
        cor: m?.cor ?? undefined,
        quantidade: Math.max(1, Math.round(Number(it.quantity) || 1)),
        valorUnit: new Prisma.Decimal(Number(it.price ?? it.value ?? 0) || 0),
      };
    });
    if (!itens.length) throw new BadRequestException('Pedido da Tray sem itens.');
    const semMatch = itens.filter((i) => i.produtoId == null).length;
    const total = itens.reduce((s: Prisma.Decimal, it: any) => s.plus(it.valorUnit.mul(it.quantidade)), new Prisma.Decimal(0));

    const nums = (await this.prisma.pedido.findMany({ where: { empresaId }, select: { numero: true } })).map((p) => p.numero);
    const numero = proximoSequencial('PV', nums, { pad: 2 });
    const pedido = await this.prisma.pedido.create({
      data: {
        empresaId, numero, clienteId: cliente.id,
        valorTotal: total, status: 'Orçamento', etapa: 'orcamento',
        formaPagamento: 'À vista (Tray)',
        ordemCompraCliente: ref,
        obs: `Importado da Tray · Loja ${c.apelido} · Pedido ${o.id} · Cliente ${nome}`,
        itens: { create: itens },
      },
    });
    return { ok: true, numero: pedido.numero, cliente: cliente.nome, total: Number(total.toFixed(2)), itens: itens.length, semVinculo: semMatch };
  }

  /** Casa um item vendido na Tray com um produto do ERP (SKU/referência/código/nome). */
  private matchProduto(
    it: any,
    catalogo: Array<{ id: number; codigo: string; referencia: string | null; descricao: string; cor: string | null }>,
  ): { id: number; descricao: string; cor: string | null } | null {
    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
    // Chaves candidatas vindas da Tray (SKU/referência/código do produto).
    const refs = [it.reference, it.sku, it.ean, it.code, it.product_reference].map(norm).filter(Boolean);
    if (refs.length) {
      const porRef = catalogo.find((p) => refs.includes(norm(p.codigo)) || (p.referencia && refs.includes(norm(p.referencia))));
      if (porRef) return { id: porRef.id, descricao: porRef.descricao, cor: porRef.cor };
    }
    // Fallback pelo nome: o código do produto aparece no nome, ou descrição igual.
    const nome = norm(it.name || it.product_name);
    if (nome) {
      const porNome = catalogo.find((p) => nome.includes(norm(p.codigo)) || norm(p.descricao) === nome);
      if (porNome) return { id: porNome.id, descricao: porNome.descricao, cor: porNome.cor };
    }
    return null;
  }

  // ===== helpers =====
  private parseExpira(s?: string): Date | null {
    if (!s) return new Date(Date.now() + 6 * 3600 * 1000);
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d.getTime()) ? new Date(Date.now() + 6 * 3600 * 1000) : d;
  }
  private async getJson(url: string): Promise<any> {
    const res = await this.trayFetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new BadRequestException(`Tray: erro ${res.status} ao consultar a loja.`);
    return res.json();
  }

  // ===== Rate limit (a Tray permite 180 req/min por aplicativo) =====
  private callTimes: number[] = [];
  /** Segura a chamada quando estamos perto do teto de 180 req/min (margem 175). */
  private async rateGuard(): Promise<void> {
    const now = Date.now();
    this.callTimes = this.callTimes.filter((t) => now - t < 60_000);
    if (this.callTimes.length >= 175) {
      const espera = 60_000 - (now - this.callTimes[0]) + 60;
      this.log.warn(`Tray: teto de req/min atingido, aguardando ${espera}ms`);
      await new Promise((r) => setTimeout(r, Math.max(0, espera)));
      return this.rateGuard();
    }
    this.callTimes.push(Date.now());
  }
  /** fetch com controle de taxa — TODA chamada à Tray passa por aqui. */
  private async trayFetch(url: string, init?: RequestInit): Promise<Response> {
    await this.rateGuard();
    return fetch(url, init);
  }

  // ===== Categorias e Produtos (leitura — pontos de homologação) =====
  /** Lista as categorias da loja (homologação: ponto "Categoria"). */
  async buscarCategorias(empresaId: number, id: number) {
    const c = await this.contaDaEmpresa(empresaId, id);
    const token = await this.tokenValido(c);
    const data: any = await this.getJson(`${c.apiUrl}/categories?access_token=${encodeURIComponent(token)}&limit=50`);
    const cats: any[] = Array.isArray(data?.Categories) ? data.Categories.map((x: any) => x.Category ?? x) : [];
    return cats.map((x) => ({ id: String(x.id), nome: x.name || x.title || '—', ativo: x.has_accessories ?? x.available ?? null }));
  }

  /** Lista os produtos da loja (homologação: ponto "Produto"). */
  async buscarProdutos(empresaId: number, id: number) {
    const c = await this.contaDaEmpresa(empresaId, id);
    const token = await this.tokenValido(c);
    const data: any = await this.getJson(`${c.apiUrl}/products?access_token=${encodeURIComponent(token)}&limit=50&sort=id_desc`);
    const prods: any[] = Array.isArray(data?.Products) ? data.Products.map((x: any) => x.Product ?? x) : [];
    return prods.map((p) => ({
      id: String(p.id),
      nome: p.name || '—',
      sku: p.reference || p.ean || '',
      preco: Number(p.price) || 0,
      estoque: Number(p.stock ?? p.available_stock ?? 0),
    }));
  }
}
