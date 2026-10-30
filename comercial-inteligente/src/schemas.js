'use strict';

/**
 * Definição dos schemas das entidades do CRM comercial.
 * Os arquivos ../schemas/*.schema.json são GERADOS daqui (`npm run schemas`)
 * e um teste garante que estão sincronizados.
 */

const { ETAPAS, SEGMENTOS, CATEGORIAS_PRODUTO, STATUS_TAREFA, TIPOS_UNIDADE, CATEGORIAS_POTENCIAL, EVIDENCIAS } = require('./dominio');

const PAPEIS = ['ceo', 'diretor', 'gerente', 'vendedor', 'hunter', 'humano'];

const id = (prefixo) => ({ type: 'string', pattern: `^${prefixo}-\\d{4,}$` });
const ref = (prefixo) => ({ type: ['string', 'null'], pattern: `^${prefixo}-\\d{4,}$` });
const texto = { type: 'string', minLength: 1 };
const textoOpc = { type: ['string', 'null'] };
const data = { type: ['string', 'null'], format: 'date' };
const dataHora = { type: 'string', format: 'date-time' };
const dinheiro = { type: ['number', 'null'], minimum: 0 };
const percentual = { type: ['number', 'null'], minimum: 0, maximum: 100 };
const cnpj = { type: ['string', 'null'], pattern: '^\\d{14}$' };
/** Um número com a qualidade da evidência, a fonte e a data da pesquisa (ex.: colaboradores). */
const medida = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    valor: { type: ['integer', 'null'], minimum: 0 },
    evidencia: { enum: EVIDENCIAS },
    fonte: textoOpc,
    dataPesquisa: data,
  },
  required: ['valor', 'evidencia'],
};
const fontes = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { descricao: texto, url: textoOpc, dataPesquisa: data },
    required: ['descricao'],
  },
};

/** Campos de controle comuns a todos os registros. */
const base = (prefixo) => ({
  id: id(prefixo),
  ficticio: { type: 'boolean' },
  origem: { enum: ['manual', 'erp', 'demo', 'agente'] },
  erpId: { type: ['string', 'null'] },
  criadoEm: dataHora,
  atualizadoEm: dataHora,
  criadoPor: { enum: PAPEIS },
});
const REQ_BASE = ['id', 'ficticio', 'criadoEm'];

const entidade = (titulo, prefixo, props, required, extra = {}) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `hc-quality/comercial/${titulo}.schema.json`,
  title: titulo,
  'x-prefixo': prefixo,
  type: 'object',
  additionalProperties: false,
  properties: { ...base(prefixo), ...props },
  required: [...REQ_BASE, ...required],
  ...extra,
});

const SCHEMAS = {
  cliente: entidade(
    'cliente',
    'CLI',
    {
      razaoSocial: texto,
      nomeFantasia: textoOpc,
      cnpj: { type: ['string', 'null'], pattern: '^\\d{14}$' },
      segmento: { enum: SEGMENTOS },
      status: { enum: ['prospect', 'ativo', 'inativo'] },
      cidadeUf: textoOpc,
      responsavelId: ref('AGT'),
      estrategico: { type: 'boolean' },
      ultimaCompraEm: data,
      obs: textoOpc,
    },
    ['razaoSocial', 'segmento', 'status'],
  ),

  contato: entidade(
    'contato',
    'CON',
    {
      clienteId: id('CLI'),
      nome: texto,
      cargo: textoOpc,
      area: { enum: ['compras', 'suprimentos', 'rh', 'facilities', 'operacoes', 'diretoria', 'outra', null] },
      papelDecisao: { enum: ['decisor', 'influenciador', 'comprador', 'usuario', 'desconhecido'] },
      email: { type: ['string', 'null'], pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      telefone: textoOpc,
    },
    ['clienteId', 'nome'],
  ),

  lead: entidade(
    'lead',
    'LEA',
    {
      empresa: texto,
      cnpj: { type: ['string', 'null'], pattern: '^\\d{14}$' },
      segmento: { enum: SEGMENTOS },
      fonte: texto,
      status: { enum: ['novo', 'qualificado', 'descartado', 'convertido'] },
      responsavelId: ref('AGT'),
      cidadeUf: textoOpc,
      motivoDescarte: textoOpc,
      oportunidadeId: ref('OPO'),
    },
    ['empresa', 'segmento', 'fonte', 'status'],
  ),

  oportunidade: entidade(
    'oportunidade',
    'OPO',
    {
      titulo: texto,
      clienteId: ref('CLI'),
      leadId: ref('LEA'),
      responsavelId: id('AGT'),
      segmento: { enum: SEGMENTOS },
      etapa: { enum: ETAPAS },
      valorEstimado: dinheiro,
      ultimoContatoEm: data,
      proximoPasso: textoOpc,
      proximoPassoEm: data,
      previsaoFechamentoEm: data,
      fechadoEm: data,
      estrategica: { type: 'boolean' },
      qualificacao: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quantidadePecas: { type: ['integer', 'null'], minimum: 1 },
          tipoUniforme: textoOpc,
          tecido: textoOpc,
          grade: textoOpc,
          frequenciaReposicao: textoOpc,
          personalizacao: textoOpc,
          prazoPretendido: data,
          localEntrega: textoOpc,
          faixaOrcamento: textoOpc,
          processoDecisao: textoOpc,
          exigeAmostra: { type: ['boolean', 'null'] },
        },
      },
      motivoPerda: textoOpc,
      concorrenteInformado: textoOpc,
      grupoId: ref('GRP'),
      unidadeId: ref('UNI'),
      canal: { enum: ['corporativo', 'local', null] },
    },
    ['titulo', 'responsavelId', 'etapa', 'valorEstimado', 'ultimoContatoEm', 'proximoPasso', 'proximoPassoEm'],
    { anyOf: [{ properties: { clienteId: id('CLI') }, required: ['clienteId'] }, { properties: { leadId: id('LEA') }, required: ['leadId'] }] },
  ),

  atividade: entidade(
    'atividade',
    'ATV',
    {
      oportunidadeId: ref('OPO'),
      clienteId: ref('CLI'),
      responsavelId: id('AGT'),
      tipo: { enum: ['ligacao', 'email', 'reuniao', 'visita', 'whatsapp', 'nota', 'proposta'] },
      data: { type: 'string', format: 'date' },
      resumo: texto,
      resultado: { enum: ['contato_realizado', 'sem_resposta', 'resposta_recebida', 'proposta_enviada', 'fechamento', 'perda', 'nota', null] },
      grupoId: ref('GRP'),
      unidadeId: ref('UNI'),
      compradorId: ref('CMP'),
    },
    ['responsavelId', 'tipo', 'data', 'resumo'],
  ),

  proposta: entidade(
    'proposta',
    'PRO',
    {
      oportunidadeId: id('OPO'),
      itens: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            produtoId: ref('PRD'),
            descricao: texto,
            quantidade: { type: 'integer', minimum: 1 },
            precoUnitario: { type: 'number', minimum: 0 },
            custoVariavelUnitario: dinheiro,
            componentesCusto: { type: 'object' },
          },
          required: ['descricao', 'quantidade', 'precoUnitario'],
        },
      },
      premissasCusto: {
        type: 'object',
        additionalProperties: false,
        properties: {
          impostosPercent: percentual,
          comissaoPercent: percentual,
          freteTotal: dinheiro,
          outrosCustosVariaveis: dinheiro,
          observacoes: textoOpc,
        },
      },
      condicoesPagamento: textoOpc,
      validadeAte: data,
      prazoEntrega: {
        type: 'object',
        additionalProperties: false,
        properties: { dias: { type: ['integer', 'null'], minimum: 1 }, confirmadoOperacao: { type: 'boolean' } },
        required: ['confirmadoOperacao'],
      },
      status: { enum: ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada', 'aceita', 'recusada', 'expirada'] },
      avaliacao: { type: ['object', 'null'] },
      justificativaDesconto: textoOpc,
      enviadaEm: data,
      respondidaEm: data,
    },
    ['oportunidadeId', 'itens', 'status', 'prazoEntrega'],
  ),

  pedido: entidade(
    'pedido',
    'PED',
    {
      clienteId: id('CLI'),
      propostaId: ref('PRO'),
      oportunidadeId: ref('OPO'),
      responsavelId: ref('AGT'),
      numeroErp: textoOpc,
      evidencia: texto,
      data: { type: 'string', format: 'date' },
      valorTotal: { type: 'number', minimum: 0 },
      status: { enum: ['recebido', 'em_producao', 'pronto', 'expedido', 'faturado', 'cancelado'] },
      prazoEntrega: data,
      faturadoEm: data,
    },
    ['clienteId', 'evidencia', 'data', 'valorTotal', 'status'],
  ),

  produto: entidade(
    'produto',
    'PRD',
    {
      descricao: texto,
      categoria: { enum: CATEGORIAS_PRODUTO },
      codigoErp: textoOpc,
      precoAutorizado: dinheiro,
      precoFonte: textoOpc,
      custoVariavelUnitario: dinheiro,
      custoFonte: textoOpc,
      componentesCusto: { type: 'object' },
      certificacoes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tipo: texto,
            numero: textoOpc,
            documento: textoOpc,
            validadoDocumento: { type: 'boolean' },
            validadeAte: data,
          },
          required: ['tipo', 'validadoDocumento'],
        },
      },
      ativo: { type: 'boolean' },
    },
    ['descricao', 'categoria', 'precoAutorizado', 'custoVariavelUnitario'],
  ),

  meta: entidade(
    'meta',
    'MET',
    {
      periodo: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
      nivel: { enum: ['empresa', 'diretor', 'gerente', 'vendedor', 'segmento'] },
      responsavelId: ref('AGT'),
      segmento: { enum: [...SEGMENTOS, null] },
      faturamento: { type: 'number', minimum: 0 },
      margemMinimaPercent: percentual,
      novosClientes: { type: ['integer', 'null'], minimum: 0 },
      metaPaiId: ref('MET'),
      definidaPor: { enum: PAPEIS },
      status: { enum: ['proposta', 'aprovada', 'revogada'] },
    },
    ['periodo', 'nivel', 'faturamento', 'definidaPor', 'status'],
  ),

  agente: entidade(
    'agente',
    'AGT',
    {
      nome: texto,
      papel: { enum: PAPEIS },
      tipo: { enum: ['agente_ia', 'humano'] },
      superiorId: ref('AGT'),
      email: textoOpc,
      ativo: { type: 'boolean' },
    },
    ['nome', 'papel', 'tipo', 'ativo'],
  ),

  aprovacao: entidade(
    'aprovacao',
    'APR',
    {
      objetoTipo: { enum: ['proposta', 'meta', 'excecao'] },
      objetoId: texto,
      solicitadoPor: { enum: PAPEIS },
      alcadaNecessaria: { enum: PAPEIS },
      motivos: { type: 'array', items: { type: 'string' } },
      status: { enum: ['pendente', 'aprovada', 'recusada'] },
      decididoPor: { enum: [...PAPEIS, null] },
      decididoEm: { type: ['string', 'null'] },
      justificativa: textoOpc,
    },
    ['objetoTipo', 'objetoId', 'solicitadoPor', 'alcadaNecessaria', 'motivos', 'status'],
  ),

  historico: entidade(
    'historico',
    'HIS',
    {
      entidade: texto,
      registroId: texto,
      acao: { enum: ['criar', 'atualizar', 'importar', 'decidir'] },
      agente: { enum: [...PAPEIS, 'sistema'] },
      antes: { type: ['object', 'null'] },
      depois: { type: ['object', 'null'] },
    },
    ['entidade', 'registroId', 'acao', 'agente'],
  ),

  solicitacao: entidade(
    'solicitacao',
    'SOL',
    {
      solicitante: { enum: PAPEIS },
      responsavel: { enum: PAPEIS },
      fluxo: { enum: ['delegacao', 'escalonamento'] },
      raizId: id('SOL'),
      origemId: ref('SOL'),
      profundidade: { type: 'integer', minimum: 0 },
      referencia: textoOpc,
      objetivo: texto,
      dadosDisponiveis: textoOpc,
      informacoesFaltantes: { type: 'array', items: { type: 'string' } },
      prazo: { type: 'string', format: 'date' },
      resultadoEsperado: texto,
      status: { enum: STATUS_TAREFA },
      respostas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tipo: { enum: ['decisao', 'pedido_informacao', 'informacao', 'escalonamento', 'conclusao'] },
            por: { enum: PAPEIS },
            em: dataHora,
            texto: texto,
            escalonadaPara: ref('SOL'),
          },
          required: ['tipo', 'por', 'em', 'texto'],
        },
      },
      decisao: textoOpc,
    },
    ['solicitante', 'responsavel', 'fluxo', 'raizId', 'profundidade', 'objetivo', 'prazo', 'resultadoEsperado', 'status', 'respostas', 'informacoesFaltantes'],
  ),

  tarefa: entidade(
    'tarefa',
    'TAR',
    {
      titulo: texto,
      atribuidaPor: { enum: PAPEIS },
      responsavel: { enum: PAPEIS },
      responsavelId: ref('AGT'),
      solicitacaoId: ref('SOL'),
      referencia: textoOpc,
      prazo: { type: 'string', format: 'date' },
      status: { enum: STATUS_TAREFA },
      condicaoConclusao: texto,
      ultimaEvidencia: textoOpc,
      verificacao: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { verificadoPor: { enum: PAPEIS }, evidencia: texto, em: dataHora },
        required: ['verificadoPor', 'evidencia', 'em'],
      },
    },
    ['titulo', 'atribuidaPor', 'responsavel', 'prazo', 'status', 'condicaoConclusao'],
  ),

  // ---------------------------------------------------------------- grandes contas
  grupo: entidade(
    'grupo',
    'GRP',
    {
      nome: texto,
      controladora: textoOpc,
      segmentos: { type: 'array', items: { enum: SEGMENTOS } },
      presencaGeografica: textoOpc,
      colaboradoresGrupo: medida,
      colaboradoresBrasil: medida,
      modeloCompra: { enum: ['centralizada', 'descentralizada', 'hibrida', 'desconhecido'] },
      modeloCompraEvidencia: textoOpc,
      categoriasCentralizadas: { type: 'array', items: { enum: CATEGORIAS_POTENCIAL } },
      potencialCorporativo: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { pecasAno: { type: ['integer', 'null'], minimum: 0 }, valorAno: dinheiro, premissa: texto },
        required: ['premissa'],
      },
      responsavelId: ref('AGT'),
      responsavelCorporativoId: ref('AGT'),
      estrategico: { type: 'boolean' },
      status: { enum: ['mapeando', 'mapeado', 'em_abordagem', 'homologado', 'cliente', 'descartado'] },
      clienteId: ref('CLI'),
      fontes,
      obs: textoOpc,
    },
    ['nome', 'modeloCompra', 'status'],
  ),

  empresa: entidade(
    'empresa',
    'EMP',
    {
      grupoId: id('GRP'),
      razaoSocial: texto,
      nomeFantasia: textoOpc,
      cnpjMatriz: cnpj,
      papelNoGrupo: { enum: ['controladora', 'subsidiaria', 'coligada', 'desconhecido'] },
      colaboradoresBrasil: medida,
      clienteId: ref('CLI'),
      fontes,
    },
    ['grupoId', 'razaoSocial', 'papelNoGrupo'],
  ),

  unidade: entidade(
    'unidade',
    'UNI',
    {
      grupoId: id('GRP'),
      empresaId: ref('EMP'),
      nome: texto,
      tipo: { enum: TIPOS_UNIDADE },
      cnpj,
      endereco: textoOpc,
      cidade: texto,
      uf: { type: ['string', 'null'], pattern: '^[A-Z]{2}$' },
      cep: { type: ['string', 'null'], pattern: '^\\d{8}$' },
      telefone: textoOpc,
      funcionariosLocais: medida,
      perfilMaoDeObra: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: Object.fromEntries(CATEGORIAS_POTENCIAL.filter((c) => c !== 'epi').map((c) => [c, percentual])),
      },
      usaEpi: { type: ['boolean', 'null'] },
      reposicaoPeriodica: { type: ['boolean', 'null'] },
      potencialContrato: { enum: ['alto', 'medio', 'baixo', 'desconhecido'] },
      responsavelId: ref('AGT'),
      status: { enum: ['nao_explorada', 'em_pesquisa', 'em_abordagem', 'negociacao', 'cliente', 'descartada'] },
      clienteId: ref('CLI'),
      fontes,
      dataPesquisa: data,
    },
    ['grupoId', 'nome', 'tipo', 'cidade', 'status'],
  ),

  comprador: entidade(
    'comprador',
    'CMP',
    {
      grupoId: id('GRP'),
      unidadeId: ref('UNI'),
      nivel: { enum: ['corporativo', 'local'] },
      nome: texto,
      cargo: textoOpc,
      funcao: {
        enum: [
          'diretor_compras', 'diretor_suprimentos', 'gerente_suprimentos', 'gerente_procurement', 'coordenador_compras', 'comprador',
          'homologacao_fornecedores', 'gerente_compras_unidade', 'coordenador_administrativo', 'gerente_facilities',
          'seguranca_trabalho', 'coordenador_operacoes', 'responsavel_uniformes_epi', 'outra',
        ],
      },
      papelNaCompra: { enum: ['decide', 'influencia', 'solicita', 'especifica', 'administra', 'desconhecido'] },
      confirmacao: { enum: ['evidenciada', 'presumida_pelo_cargo'] },
      evidenciaFuncao: textoOpc,
      email: { type: ['string', 'null'], pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      telefone: textoOpc,
      perfilPublico: textoOpc,
      fontes,
      dataPesquisa: data,
    },
    ['grupoId', 'nivel', 'nome', 'confirmacao'],
  ),
};

const ENTIDADES = Object.keys(SCHEMAS);
const PREFIXOS = Object.fromEntries(ENTIDADES.map((e) => [e, SCHEMAS[e]['x-prefixo']]));
const COLECOES = {
  cliente: 'clientes',
  contato: 'contatos',
  lead: 'leads',
  oportunidade: 'oportunidades',
  atividade: 'atividades',
  proposta: 'propostas',
  pedido: 'pedidos',
  produto: 'produtos',
  meta: 'metas',
  agente: 'agentes',
  aprovacao: 'aprovacoes',
  historico: 'historico',
  solicitacao: 'solicitacoes',
  tarefa: 'tarefas',
  grupo: 'grupos',
  empresa: 'empresas',
  unidade: 'unidades',
  comprador: 'compradores',
};

module.exports = { SCHEMAS, ENTIDADES, PREFIXOS, COLECOES, PAPEIS };
