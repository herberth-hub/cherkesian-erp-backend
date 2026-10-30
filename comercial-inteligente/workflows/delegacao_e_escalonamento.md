# Protocolo de comunicação entre agentes

Implementado em `src/protocolo.js`; registros em `solicitacoes.json` (schema `schemas/solicitacao.schema.json`).

## Campos de toda solicitação

| Campo (seção 7) | Campo no registro |
| --- | --- |
| Identificador | `id` (SOL-0001), `raizId` (demanda original), `origemId` (solicitação-mãe) |
| Agente solicitante | `solicitante` |
| Agente responsável | `responsavel` |
| Cliente/oportunidade | `referencia` (ex.: `oportunidade:OPO-0001`, `aprovacao:APR-0001`) |
| Objetivo | `objetivo` |
| Dados disponíveis | `dadosDisponiveis` |
| Informações faltantes | `informacoesFaltantes[]` |
| Prazo de resposta | `prazo` (obrigatório, não pode estar no passado) |
| Resultado esperado | `resultadoEsperado` |
| Status | `status`: pendente · em_andamento · aguardando_informacao · aguardando_aprovacao · concluida · bloqueada |
| Registro da decisão | `decisao` + `respostas[]` (quem, quando, tipo, texto) + `historico.json` |

## Fluxos

```
Delegação  (desce 1 nível):   humano → ceo → diretor → gerente → vendedor
Escalonamento (sobe 1 nível): vendedor → gerente → diretor → ceo → humano
```

Criar: `solicitacao criar --para <papel> --fluxo delegacao|escalonamento --objetivo "..." --prazo AAAA-MM-DD --resultado-esperado "..." [--ref ...] [--dados ...] [--faltantes "a;b"] [--origem SOL-...]`

## Respostas possíveis do responsável

| Tipo | Efeito |
| --- | --- |
| `decisao` | encerra (`concluida`), grava a decisão e devolve o retorno à solicitação de origem |
| `conclusao` | entrega o trabalho delegado → `aguardando_aprovacao`; **o solicitante verifica** (`solicitacao verificar --aceitar|--devolver --texto "evidência"`) |
| `pedido_informacao` | → `aguardando_informacao` + lista de faltantes; o solicitante complementa com tipo `informacao` |
| `escalonamento` | exige justificativa; cria solicitação filha para o superior direto; a original fica `aguardando_aprovacao` até a decisão voltar |

## Quando escalar (obrigatório)
Decisão acima da alçada · risco relevante de margem · prazo não validado pela operação · risco
financeiro ou contratual · cliente estratégico · conflito entre áreas · informação necessária indisponível.

## Garantias contra ciclos infinitos (verificadas por teste)
1. Delegação só ao subordinado direto; escalonamento só ao superior direto (`HIERARQUIA_*`).
2. Solicitação recebida por escalonamento **não pode ser delegada** para baixo (`CICLO_PROIBIDO`).
   Logo, todo caminho desce e depois só sobe, terminando no humano, que sempre decide.
3. Profundidade máxima 8 (`PROFUNDIDADE_EXCEDIDA`), no máximo 30 solicitações por demanda
   (`LIMITE_SOLICITACOES`) e um escalonamento aberto por solicitação (`ESCALONAMENTO_ABERTO`).
4. Só o responsável atual pode desdobrar ou responder (`NAO_RESPONSAVEL`).
5. Toda solicitação tem prazo; vencidas aparecem nos relatórios como `(VENCIDA)`.

## Aprovações comerciais
A aprovação formal de proposta é um registro próprio (`aprovacao`), com alçada calculada pela política.
A solicitação de escalonamento referencia a aprovação (`--ref aprovacao:APR-...`); quem tem a alçada
decide com `aprovacao decidir` e responde a solicitação com `--tipo decisao`.

## Tarefas
`tarefa criar` (para si ou subordinado direto) · `tarefa mover`. Executor entrega com
`aguardando_aprovacao` + evidência; só quem atribuiu (ou superior) conclui, com evidência verificada.
