# Grandes contas — grupos, matrizes, filiais e compradores

Objetivo: enxergar **ecossistemas corporativos**. Um grupo grande compra uniformes e EPIs por vários
caminhos: o departamento central de compras, cada unidade, ou os dois. A HC Quality se posiciona como
fornecedora corporativa, regional ou local conforme a estrutura de compras encontrada.

## Estrutura no CRM

```
GRUPO ECONÔMICO (GRP)            registrar grupo
└── EMPRESA (EMP)                registrar empresa      controladora | subsidiária | coligada
    ├── MATRIZ (UNI, tipo matriz)  registrar unidade    CNPJ ordem 0001
    ├── FILIAL / FÁBRICA / CD ...  registrar unidade    CNPJ ordem ≠ 0001
    └── ...
COMPRADORES (CMP)                registrar comprador    nível corporativo (grupo) ou local (unidade)
```

- Cada registro tem identificador próprio e vínculo com a conta principal (`grupoId`, `empresaId`).
- A raiz do CNPJ (8 primeiros dígitos) liga a unidade à empresa; a CLI completa ou recusa vínculos errados.
- Duplicidade: grupo pelo nome; empresa pela raiz do CNPJ ou razão social; unidade pelo CNPJ, pelo nome+cidade no grupo
  ou pelo endereço+CEP; comprador pelo e-mail ou nome no grupo.
- Oportunidades, atividades, propostas e pedidos se ligam ao grupo e à unidade (`grupoId`, `unidadeId`, `canal`).
  Pedidos contam para o grupo pelo `clienteId` vinculado ao grupo, à empresa ou à unidade.

## Critério da conta principal

Grupo ou empresa com **pelo menos 1.000 colaboradores**, classificado pela evidência (`conta elegibilidade`):
`elegivel` (comprovado), `elegivel_estimado` (estimativa), `pendente_evidencia`, `abaixo_do_porte`, `sem_dado`.

## Funcionários por abrangência

Três números distintos, cada um com evidência, fonte e data: **grupo** (global), **Brasil** (grupo ou empresa)
e **unidade** (local). Nunca somados entre si; a CLI recusa uma unidade com o mesmo número (ou mais) que o grupo.

## Potencial (estimativa)

`conta potencial --unidade` calcula peças/ano por categoria (administrativo, operacional, industrial,
hospitalar, EPI) a partir dos funcionários locais e das premissas de `config/premissas_contas.json`
(peças por pessoa/ano, perfil de mão de obra por tipo de unidade, % que usa EPI, ticket médio).
Sem funcionários locais = não calculável. Sem ticket médio = só peças (valor em R$ não calculável).

`conta consolidado --grupo` soma **sem dupla contagem**: categorias compradas centralmente entram pelo canal
corporativo (potencial corporativo informado, ou a soma das unidades nessas categorias), as demais pela soma
das unidades. Nunca os dois para a mesma compra.

## Estratégias de entrada

| Modelo de compra | Estratégia |
| --- | --- |
| Centralizada | **A — corporativa**: homologar a HC Quality no departamento central (diretor de compras/suprimentos, procurement, homologação). Unidades só com o responsável corporativo alinhado. |
| Descentralizada | **B — por unidade**: oportunidades por instalação, relacionamento com gestores locais (facilities, segurança do trabalho, operações). |
| Híbrida | A para as categorias centrais (`categoriasCentralizadas`) e B para o que cada unidade contrata. |

## Distribuição comercial (gerente)

- `conta atribuir --grupo GRP --responsavel AGT` — vendedor do grupo.
- `conta atribuir --grupo GRP --como corporativo --responsavel AGT` — responsável pela conta estratégica corporativa.
- `conta atribuir --unidade UNI --responsavel AGT` — vendedor de uma unidade.
- Transferência de oportunidade: `atualizar oportunidade --id ... --json '{"responsavelId":"AGT-..."}'` (gerente ou acima).
- Tudo fica no histórico (`historico`) e nas atividades do grupo/unidade.

## Antes de abordar (obrigatório)

`conta abordagem --unidade UNI-...` mostra negociações corporativas e locais em andamento. A CLI bloqueia:
nova oportunidade numa unidade que já tem negociação aberta; oportunidade local em grupo de compra centralizada
com negociação corporativa de outro responsável; segunda negociação corporativa no mesmo grupo.

## Compradores

Corporativos: diretor de compras/suprimentos, gerente corporativo de suprimentos, procurement, compras estratégicas,
comprador corporativo, homologação de fornecedores. Locais: compras da unidade, administrativo, facilities,
segurança do trabalho, operações, responsável por uniformes e EPIs.
`confirmacao: evidenciada` exige `evidenciaFuncao` (o que mostra que a pessoa exerce a função); só o cargo = `presumida_pelo_cargo`.
