'use strict';

/**
 * Vocabulário do domínio comercial. Fonte única para schemas, regras e relatórios.
 */

const ETAPAS = [
  'lead_identificado',
  'lead_qualificado',
  'contato_realizado',
  'necessidade_levantada',
  'cotacao_solicitada',
  'proposta_em_preparacao',
  'proposta_enviada',
  'negociacao',
  'aguardando_decisao',
  'pedido_ganho',
  'pedido_perdido',
  'pos_venda',
];

const ETAPAS_ABERTAS = ETAPAS.slice(0, 9);

const ROTULO_ETAPA = {
  lead_identificado: '1. Lead identificado',
  lead_qualificado: '2. Lead qualificado',
  contato_realizado: '3. Contato realizado',
  necessidade_levantada: '4. Necessidade levantada',
  cotacao_solicitada: '5. Cotação solicitada',
  proposta_em_preparacao: '6. Proposta em preparação',
  proposta_enviada: '7. Proposta enviada',
  negociacao: '8. Negociação',
  aguardando_decisao: '9. Aguardando decisão',
  pedido_ganho: '10. Pedido ganho',
  pedido_perdido: '11. Pedido perdido',
  pos_venda: '12. Pós-venda e recompra',
};

const SEGMENTOS = [
  'saude',
  'lavanderia',
  'industria',
  'facilities',
  'construcao',
  'servicos',
  'distribuidores',
  'publico',
  'outro',
];

const CATEGORIAS_PRODUTO = [
  'camiseta_polo',
  'camisa_social',
  'calca',
  'jaleco',
  'avental',
  'privativo_hospitalar',
  'macacao',
  'personalizado',
  'protecao_acessorio',
  'outro',
];

/** Status de tarefas e solicitações (seção 13 do prompt mestre). */
const STATUS_TAREFA = [
  'pendente',
  'em_andamento',
  'aguardando_informacao',
  'aguardando_aprovacao',
  'concluida',
  'bloqueada',
];

/**
 * Campos de qualificação exigidos a partir da etapa "cotação solicitada":
 * sem eles não se forma preço nem prazo.
 */
const QUALIFICACAO_PARA_COTACAO = [
  'quantidadePecas',
  'tipoUniforme',
  'personalizacao',
  'prazoPretendido',
  'localEntrega',
];

/** Campos que toda oportunidade precisa ter preenchidos (seção 6 — processo comercial). */
const CAMPOS_OBRIGATORIOS_OPORTUNIDADE = [
  'responsavelId',
  'valorEstimado',
  'etapa',
  'ultimoContatoEm',
  'proximoPasso',
  'proximoPassoEm',
];

/** Grandes contas: tipos de instalação de um grupo empresarial. */
const TIPOS_UNIDADE = [
  'matriz', 'filial', 'fabrica', 'hospital', 'centro_distribuicao', 'centro_logistico', 'escritorio',
  'base_operacional', 'centro_manutencao', 'unidade_atendimento', 'laboratorio', 'operacao_terceirizada', 'outra',
];

/** Categorias de potencial por unidade (uniformes por perfil de mão de obra + EPIs). */
const CATEGORIAS_POTENCIAL = ['administrativo', 'operacional', 'industrial', 'hospitalar', 'epi'];

/** Qualidade da evidência de um número (colaboradores, por exemplo). */
const EVIDENCIAS = ['comprovado', 'estimado', 'nao_verificado'];

/** Municípios da Região Metropolitana de São Paulo (Grande São Paulo), sem acento e em minúsculas. */
const CIDADES_GRANDE_SP = [
  'aruja', 'barueri', 'biritiba-mirim', 'caieiras', 'cajamar', 'carapicuiba', 'cotia', 'diadema', 'embu das artes',
  'embu-guacu', 'ferraz de vasconcelos', 'francisco morato', 'franco da rocha', 'guararema', 'guarulhos', 'itapecerica da serra',
  'itapevi', 'itaquaquecetuba', 'jandira', 'juquitiba', 'mairipora', 'maua', 'mogi das cruzes', 'osasco', 'pirapora do bom jesus',
  'poa', 'ribeirao pires', 'rio grande da serra', 'salesopolis', 'santa isabel', 'santana de parnaiba', 'santo andre',
  'sao bernardo do campo', 'sao caetano do sul', 'sao lourenco da serra', 'sao paulo', 'suzano', 'taboao da serra', 'vargem grande paulista',
];

module.exports = {
  TIPOS_UNIDADE,
  CATEGORIAS_POTENCIAL,
  EVIDENCIAS,
  CIDADES_GRANDE_SP,
  ETAPAS,
  ETAPAS_ABERTAS,
  ROTULO_ETAPA,
  SEGMENTOS,
  CATEGORIAS_PRODUTO,
  STATUS_TAREFA,
  QUALIFICACAO_PARA_COTACAO,
  CAMPOS_OBRIGATORIOS_OPORTUNIDADE,
};
