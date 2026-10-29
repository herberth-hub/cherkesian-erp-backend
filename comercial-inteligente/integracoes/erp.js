'use strict';

/**
 * Integração SOMENTE LEITURA com a API REST do Cherkesian ERP (/api/v1),
 * o backend deste mesmo repositório. Rotas usadas (conferidas nos controllers):
 *   POST /auth/login       → accessToken
 *   GET  /clientes         → src/clientes/clientes.controller.ts
 *   GET  /crm/leads        → src/crm/crm.controller.ts
 *   GET  /pedidos          → src/pedidos/pedidos.controller.ts
 *   GET  /produtos         → src/produtos/produtos.controller.ts
 *
 * Nada é escrito no ERP. Credenciais vêm só de variáveis de ambiente:
 *   ERP_API_URL (ex.: https://<host>/api/v1), ERP_USUARIO, ERP_SENHA
 * Use um usuário de perfil "comercial" (menor privilégio que cobre essas rotas).
 *
 * As funções de mapeamento são puras e testadas; a chamada HTTP depende de
 * credenciais e NÃO foi exercitada contra o ERP em produção nesta implementação.
 */

const SEGMENTO_POR_TEXTO = [
  [/hospital|clinic|saude|saúde|laborat|medic/i, 'saude'],
  [/lavanderia/i, 'lavanderia'],
  [/industria|indústria|gas|gás|energia|logistic|manufat|metal|quimic/i, 'industria'],
  [/limpeza|conserva|facilit|terceiriz/i, 'facilities'],
  [/constru|manuten|engenharia/i, 'construcao'],
  [/distribu|revend|atacad/i, 'distribuidores'],
  [/prefeitura|munic|estado|public|públic|governo|secretaria|autarquia/i, 'publico'],
  [/servi|varejo|rede|loja|restaurante|hotel/i, 'servicos'],
];

function segmentoDe(texto) {
  if (!texto) return 'outro';
  const achado = SEGMENTO_POR_TEXTO.find(([re]) => re.test(texto));
  return achado ? achado[1] : 'outro';
}

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const dataISO = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const ETAPA_ERP = {
  novo: 'lead_identificado',
  contato: 'contato_realizado',
  qualificado: 'lead_qualificado',
  proposta: 'proposta_enviada',
  negociacao: 'negociacao',
  ganho: 'pedido_ganho',
  perdido: 'pedido_perdido',
};

const STATUS_PEDIDO_ERP = {
  orcamento: null, // orçamento não é pedido confirmado: não importa
  aprovado: 'recebido',
  cancelado: 'cancelado',
  concluido: 'faturado',
  expedicao: 'pronto',
  parcial: 'expedido',
  estoque: 'pronto',
};

function mapearCliente(c) {
  const cnpj = soDigitos(c.cnpjCpf);
  return {
    erpId: `cliente:${c.id}`,
    razaoSocial: c.nome,
    nomeFantasia: c.fantasia || null,
    cnpj: cnpj.length === 14 ? cnpj : null,
    segmento: segmentoDe(c.segmento || c.nome),
    status: c.clienteNovo ? 'prospect' : 'ativo',
    cidadeUf: c.cidadeUf || (c.municipio && c.uf ? `${c.municipio}/${c.uf}` : null),
    obs: c.segmento ? `Segmento no ERP: ${c.segmento}` : null,
  };
}

function mapearLead(l) {
  const cnpj = soDigitos(l.cnpjCpf);
  return {
    erpId: `lead:${l.id}`,
    empresa: l.empresa || l.nome,
    cnpj: cnpj.length === 14 ? cnpj : null,
    segmento: segmentoDe(`${l.empresa || ''} ${l.obs || ''}`),
    fonte: l.origem || 'ERP (CRM)',
    status: l.etapa === 'perdido' ? 'descartado' : l.etapa === 'ganho' ? 'convertido' : l.etapa === 'novo' ? 'novo' : 'qualificado',
    cidadeUf: l.cidadeUf || null,
    motivoDescarte: l.perdaMotivo || null,
  };
}

/** Oportunidade derivada de um lead do ERP. responsavelId é resolvido pelo chamador (mapa vendedorId→AGT). */
function mapearOportunidade(l, { leadId, responsavelId }) {
  return {
    erpId: `oportunidade:${l.id}`,
    titulo: `Uniformes — ${l.empresa || l.nome}`,
    leadId,
    clienteId: null,
    responsavelId,
    etapa: ETAPA_ERP[l.etapa] || 'lead_identificado',
    valorEstimado: num(l.valorEstimado),
    ultimoContatoEm: dataISO(l.atualizadoEm),
    proximoPasso: l.proximaAcao || null,
    proximoPassoEm: dataISO(l.proximaAcaoEm),
    qualificacao: {
      quantidadePecas: l.qtdColaboradores && l.trocasUniforme ? l.qtdColaboradores * l.trocasUniforme : null,
      frequenciaReposicao: l.frequenciaCompra || null,
    },
    motivoPerda: l.perdaMotivo || null,
  };
}

/** Pedido do ERP → pedido confirmado. Orçamentos são ignorados (retorna null). */
function mapearPedido(p, { clienteId }) {
  const etapa = p.etapa || 'orcamento';
  const status = etapa in STATUS_PEDIDO_ERP ? STATUS_PEDIDO_ERP[etapa] : 'em_producao';
  if (!status) return null;
  return {
    erpId: `pedido:${p.id}`,
    clienteId,
    numeroErp: p.numero,
    evidencia: `Pedido ${p.numero} registrado no ERP (etapa ${etapa})`,
    data: dataISO(p.data),
    valorTotal: Number(p.valorTotal),
    status,
    prazoEntrega: dataISO(p.prazoEntrega),
    // O ERP não expõe a data de faturamento nesta rota: fica null e o relatório usa a data do pedido (premissa).
    faturadoEm: null,
  };
}

const CATEGORIA_POR_TEXTO = [
  [/polo|camiseta/i, 'camiseta_polo'],
  [/camisa/i, 'camisa_social'],
  [/calca|calça/i, 'calca'],
  [/jaleco/i, 'jaleco'],
  [/avental/i, 'avental'],
  [/privativ|scrub/i, 'privativo_hospitalar'],
  [/macac/i, 'macacao'],
];

function mapearProduto(p) {
  const texto = `${p.categoria || ''} ${p.descricao || ''}`;
  const cat = CATEGORIA_POR_TEXTO.find(([re]) => re.test(texto));
  return {
    erpId: `produto:${p.id}`,
    descricao: p.descricao,
    categoria: cat ? cat[1] : 'outro',
    codigoErp: p.codigo,
    precoAutorizado: num(p.precoBase),
    precoFonte: p.precoBase != null ? 'ERP — Produto.precoBase (preço de venda padrão)' : null,
    custoVariavelUnitario: num(p.custo),
    custoFonte: p.custo != null ? 'ERP — Produto.custo (custo direto unitário)' : null,
    certificacoes: [],
    ativo: true,
  };
}

/** Cliente HTTP mínimo, só GET. */
class ErpLeitura {
  constructor({ url = process.env.ERP_API_URL, usuario = process.env.ERP_USUARIO, senha = process.env.ERP_SENHA, fetchImpl = globalThis.fetch } = {}) {
    const faltando = [!url && 'ERP_API_URL', !usuario && 'ERP_USUARIO', !senha && 'ERP_SENHA'].filter(Boolean);
    if (faltando.length) {
      const e = new Error(`Integração com o ERP não configurada: defina ${faltando.join(', ')} no ambiente.`);
      e.codigo = 'ERP_NAO_CONFIGURADO';
      throw e;
    }
    this.url = url.replace(/\/$/, '');
    this.usuario = usuario;
    this.senha = senha;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async login() {
    const r = await this.fetch(`${this.url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: this.usuario, senha: this.senha }) });
    if (!r.ok) throw new Error(`Login no ERP falhou (HTTP ${r.status}).`);
    const d = await r.json();
    if (!d.accessToken) throw new Error('Login no ERP não retornou accessToken.');
    this.token = d.accessToken;
  }

  async get(caminho) {
    if (!this.token) await this.login();
    const r = await this.fetch(`${this.url}${caminho}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`ERP GET ${caminho} → HTTP ${r.status}.`);
    return r.json();
  }
}

/**
 * Importa um recurso do ERP para a base: cria o que não existe e atualiza o que já
 * foi importado (casando por erpId). Retorna um resumo; registros inválidos são
 * relatados, não inventados nem corrigidos à força.
 */
async function importar(base, recurso, { cliente, responsavelPadraoId } = {}) {
  const erp = cliente || new ErpLeitura();
  const resumo = { recurso, criados: 0, atualizados: 0, ignorados: 0, erros: [] };
  const porErpId = (ent, erpId) => base.listar(ent).find((r) => r.erpId === erpId);
  const gravar = (ent, dados) => {
    try {
      const existente = porErpId(ent, dados.erpId);
      if (existente) {
        base.atualizar(ent, existente.id, dados, 'humano', { acao: 'importar' });
        resumo.atualizados++;
        return existente.id;
      }
      const novo = base.criar(ent, { ...dados, origem: 'erp' }, 'humano', { origem: 'erp' });
      resumo.criados++;
      return novo.id;
    } catch (e) {
      resumo.erros.push(`${dados.erpId}: ${e.message}`);
      return null;
    }
  };

  if (recurso === 'clientes') {
    for (const c of await erp.get('/clientes')) gravar('cliente', mapearCliente(c));
  } else if (recurso === 'produtos') {
    for (const p of await erp.get('/produtos')) gravar('produto', mapearProduto(p));
  } else if (recurso === 'pedidos') {
    for (const p of await erp.get('/pedidos')) {
      const cli = porErpId('cliente', `cliente:${p.clienteId}`);
      if (!cli) {
        resumo.erros.push(`pedido:${p.id}: cliente ${p.clienteId} não importado (rode "erp importar --recurso clientes" antes).`);
        continue;
      }
      const dados = mapearPedido(p, { clienteId: cli.id });
      if (!dados) resumo.ignorados++;
      else gravar('pedido', dados);
    }
  } else if (recurso === 'leads') {
    if (!responsavelPadraoId) throw new Error('Informe --responsavel AGT-xxxx para as oportunidades importadas dos leads.');
    for (const l of await erp.get('/crm/leads')) {
      const leadId = gravar('lead', mapearLead(l));
      if (leadId) gravar('oportunidade', mapearOportunidade(l, { leadId, responsavelId: responsavelPadraoId }));
    }
  } else {
    throw new Error('Recurso inválido: clientes | produtos | pedidos | leads.');
  }
  return resumo;
}

module.exports = { ErpLeitura, importar, mapearCliente, mapearLead, mapearOportunidade, mapearPedido, mapearProduto, segmentoDe };
