# Inteligência Comercial — HC Quality (Grupo Cherkesian)

Diretoria comercial de IA com **quatro agentes hierárquicos** — CEO, Diretor Comercial, Gerente
Comercial e Vendedor/Atendente — implementados como subagentes nativos do Claude Code, com um motor
determinístico (CLI em Node.js, sem dependências) que aplica hierarquia, alçadas, permissões,
validação de dados, cálculo de margem, relatórios padronizados, histórico e log de execução.

> **Princípio central:** o CEO define a direção, o Diretor planeja, o Gerente coordena e o Vendedor executa.

## Estrutura

```
.claude/                                  (raiz do repositório)
├── agents/hc-ceo.md                      subagente nativo — CEO (nível 4)
├── agents/hc-diretor-comercial.md        subagente nativo — Diretor (nível 3)
├── agents/hc-gerente-comercial.md        subagente nativo — Gerente (nível 2)
├── agents/hc-vendedor-comercial.md       subagente nativo — Vendedor (nível 1)
├── commands/com-*.md                     13 comandos operacionais (/com-reuniao-diaria, ...)
└── settings.json                         permissões do projeto (CLI liberada, ações humanas pedem confirmação, .env negado)
                                          + hook PreToolUse --auto (2ª camada: identifica o subagente pelo agent_type)

comercial-inteligente/
├── CLAUDE.md                 regras globais: hierarquia, dados, segurança
├── agents/                   instruções completas de cada agente
├── knowledge/                empresa, produtos, segmentos (8), política comercial, precificação
├── workflows/                prospecção, qualificação, cotação, follow-up, fechamento, pós-venda,
│                             delegação e escalonamento (protocolo), orquestração
├── schemas/                  14 JSON Schemas (gerados de src/schemas.js)
├── reports/                  modelos dos relatórios (vendedor, gerente, diretor, CEO)
├── config/                   hierarquia.json · politica_comercial.json (modelo NÃO configurado) · premissas.json
├── src/                      motor: store, validador, hierarquia, permissões, protocolo, precificação,
│                             comercial (propostas/aprovações/metas), análises, relatórios, log, CLI
├── bin/hc.js                 CLI
├── bin/guard-bash.js         hook de segurança dos subagentes
├── bin/gerar-schemas.js      regenera schemas/
├── integracoes/erp.js        leitura do ERP Cherkesian (requer credenciais)
├── servico/                  serviço autônomo: agentes em paralelo, expediente, rotinas e painel visual
├── bin/servico.js            inicia o serviço (ver servico/README.md)
├── data/                     demo-seed/ (fictícia, versionada) · demo/ e producao/ (fora do git)
└── test/                     testes unitários, de segurança, estrutura e aceitação (node:test)
```

## Instalação

Requisitos: Node.js ≥ 20 (o repositório usa 20/22) e Claude Code. O motor e a CLI não têm dependências; o serviço autônomo usa o SDK oficial da Anthropic (`npm install` dentro de `comercial-inteligente/`).

```bash
cd cherkesian-erp-backend
node comercial-inteligente/bin/hc.js ajuda --agente humano      # lista comandos
node comercial-inteligente/bin/hc.js validar --agente humano --base demo
cd comercial-inteligente && npm test                            # suíte completa
```

Ao abrir o Claude Code na raiz do repositório, os agentes (`/agents`) e os comandos `/com-*` ficam
disponíveis automaticamente (`.claude/agents`, `.claude/commands`).

## Uso

### Pelos comandos operacionais (recomendado)

| Comando | O que faz | Agentes acionados (em sequência) |
| --- | --- | --- |
| `/com-reuniao-diaria` | reunião diária comercial | vendedor(es) → gerente |
| `/com-relatorio-executivo` | relatório executivo | diretor → CEO |
| `/com-analisar-carteira` | carteira, concentração, inativos | diretor (→ CEO se risco estratégico) |
| `/com-planejar-prospeccao` | prospecção da semana | gerente → vendedor |
| `/com-sem-follow-up` | oportunidades sem follow-up | gerente |
| `/com-propostas-pendentes` | propostas pendentes | gerente (→ diretor) |
| `/com-avaliar-margem PRO-0002` | margem de uma cotação | diretor |
| `/com-planejar-meta 2026-11` | meta mensal | CEO → **humano aprova** → diretor → gerente → diretor (verifica) |
| `/com-recuperar-inativos` | reativação de inativos | diretor → gerente |
| `/com-novo-segmento publico` | plano para novo segmento | diretor (→ CEO) |
| `/com-pedidos-em-risco` | pedidos em risco de atraso | diretor |
| `/com-desempenho-vendedores` | desempenho por vendedor | gerente |
| `/com-reuniao-ceo` | reunião de resultados | gerente → diretor → CEO |

Acrescente `demo` aos argumentos para usar a base fictícia (ex.: `/com-relatorio-executivo demo`).

### Acionando um agente diretamente

Na conversa: *"Use o agente hc-ceo para analisar o mês na base demo"* — ou pela ferramenta Agent com
`subagent_type: hc-ceo`. Para acionar o CEO: `/com-relatorio-executivo`, `/com-planejar-meta` ou `/com-reuniao-ceo`.

### Pela CLI (humano ou orquestrador)

```bash
HC="node comercial-inteligente/bin/hc.js"
$HC relatorio ceo --agente ceo --base demo --hoje 2026-10-29
$HC pipeline sem-follow-up --agente gerente --base demo
$HC margem --preco 84 --qtd 1000 --custo 41 --impostos 9.25 --comissao 2 --frete 1200 --preco-tabela 89.9 --agente diretor --base demo
$HC proposta avaliar --id PRO-0002 --agente diretor --base demo
$HC solicitacao listar --todas --agente gerente --base demo
```

## Serviço autônomo e painel visual (fase 1)

Além do uso pelo Claude Code, os agentes rodam sozinhos como um serviço: **em paralelo**, de
**segunda a sexta das 06:30 às 22:00 (São Paulo)**, com rotinas programadas, fila automática de
solicitações e tarefas, limites de custo e um **painel ao vivo** onde você acompanha cada agente,
pausa o trabalho e toma as decisões que são suas. Sem `ANTHROPIC_API_KEY` ele roda em modo simulado
(comandos fixos, sem IA), útil para conhecer o painel. Detalhes, variáveis e implantação: `servico/README.md`.

```bash
cd comercial-inteligente && npm install && npm run servico:demo   # abre em http://localhost:3100/?token=...
```

## Como a delegação funciona

1. **Para baixo (delegação):** `solicitacao criar --fluxo delegacao --para <subordinado direto>` com
   objetivo, prazo, resultado esperado, dados disponíveis e faltantes. O subordinado responde com
   `conclusao` (o solicitante verifica e encerra), `pedido_informacao` ou `escalonamento`.
2. **Para cima (escalonamento):** `solicitacao responder --tipo escalonamento` cria a solicitação para o
   superior direto; a original aguarda; a decisão volta anexada à origem.
3. **Aprovações comerciais:** `aprovacao solicitar` calcula a alçada pela política; só quem tem alçada
   decide (`aprovacao decidir`), sempre com justificativa; alçada `humano` exige o responsável humano.
4. **Sem ciclos:** delegação desce 1 nível, escalonamento sobe 1 nível, o que subiu não desce de novo,
   profundidade ≤ 8, um escalonamento aberto por vez, 30 solicitações por demanda. Detalhes em
   `workflows/delegacao_e_escalonamento.md`.
5. **Orquestração:** subagentes do Claude Code não acionam outros subagentes. A sessão principal lê a
   fila (`solicitacao listar`) e aciona o próximo agente indicado — no máximo 8 acionamentos por comando
   (`workflows/orquestracao.md`).

## Configuração efetiva dos agentes

| Agente | Nível | Ferramentas | Restrição de Bash (hook) | Pode decidir aprovações até |
| --- | --- | --- | --- | --- |
| `hc-ceo` | 4 | Read, Grep, Glob, Bash | só `hc.js ... --agente ceo` | alçada `ceo` |
| `hc-diretor-comercial` | 3 | Read, Grep, Glob, Bash | só `hc.js ... --agente diretor` | alçada `diretor` |
| `hc-gerente-comercial` | 2 | Read, Grep, Glob, Bash | só `hc.js ... --agente gerente` | alçada `gerente` |
| `hc-vendedor-comercial` | 1 | Read, Grep, Glob, Bash | só `hc.js ... --agente vendedor` | alçada `vendedor` |

Todos negam explicitamente Write, Edit, NotebookEdit, WebFetch, WebSearch e Agent; não têm servidores
MCP (sem e-mail, WhatsApp, CRM externo ou financeiro); `maxTurns: 40`. O hook bloqueia outros programas,
`;`/`&&`/`|`, redirecionamentos, `$VAR`/`$(...)`, comandos `erp`/`demo` e `--agente` diferente do próprio papel.
Ele está em **duas camadas**: no frontmatter de cada agente (`guard-bash.js <papel>`) e em
`.claude/settings.json` (`guard-bash.js --auto`, que reconhece o subagente pelo campo `agent_type`
e não interfere na sessão principal nem em outros agentes). A terceira camada é a própria CLI, que
aplica alçada, hierarquia e permissões do papel informado.

**Pré-requisito:** o Claude Code só aplica permissões e hooks do projeto em workspace **confiável**.
Abra o Claude Code interativamente na raiz do repositório uma vez e aceite o diálogo de confiança.

**Verificação após a confiança** (recomendada): peça *"use o agente hc-vendedor-comercial e tente rodar `ls`"* —
deve voltar "Comando bloqueado: agentes comerciais só executam ...".

## O que funciona × o que depende de credenciais ou desenvolvimento

**Funciona agora (testado):** CRM em arquivos com 14 entidades e validação; deduplicação; histórico;
log com ocultação de segredos; hierarquia e protocolo de solicitações; tarefas com verificação;
precificação (margem, markup, desconto, alçada); aprovações por alçada; metas e desdobramento;
13 análises de pipeline; 4 relatórios; subagentes nativos com hook; 13 comandos; base demo fictícia.

**Depende de credenciais:** importação do ERP (`erp importar`) — código pronto e testado com cliente
simulado, exige `ERP_API_URL`, `ERP_USUARIO`, `ERP_SENHA`; não foi executada contra o ERP real.

**Depende de desenvolvimento:** inadimplência/crédito (financeiro do ERP), capacidade produtiva (PCP),
escrita no ERP, envio de e-mail/WhatsApp pelos agentes, CRM externo. Os relatórios declaram esses
itens como "dados ausentes" em vez de estimá-los.

## Limitações

- **Dentro do Claude Code a execução é sequencial** (a sessão principal aciona um agente por vez). **No serviço autônomo os agentes rodam em paralelo** (`servico/`).
- **Teste real no Claude Code (2.1.312, sessão headless desta entrega):** o subagente `hc-gerente-comercial`
  foi carregado e seguiu as instruções (recusou agir como diretor). Como o workspace não estava marcado como
  confiável, o Claude Code **ignorou** permissões e hooks do projeto (um `ls` passou e a CLI pediu aprovação).
  O bloqueio do hook foi validado como script (função e processo, nos testes), mas **não dentro do Claude Code**;
  faça a verificação acima depois de aceitar a confiança.
- **Subagente não aciona subagente** no Claude Code: a delegação é registrada na fila e roteada pela sessão principal.
- **Confirmação humana**: o sistema não consegue provar que o operador é humano. A proteção é: subagentes
  não conseguem usar `--agente humano` (hook) e, na sessão principal, comandos com `--agente humano`,
  `erp` e `demo` exigem confirmação na tela do Claude Code (regra `ask`) e, para aprovações, `--confirmar <id>`.
  Em modos de permissão que pulam confirmações (ex.: bypass), essa camada deixa de existir.
- Armazenamento em arquivos JSON: adequado a uma equipe pequena e a um processo por vez (sem bloqueio concorrente).
- Agentes não navegam na internet (menor privilégio). Habilitar `WebSearch` para o vendedor é decisão do humano.
- Probabilidades por etapa e limites de dias são premissas padrão até serem calibradas com o histórico real.

## Testes

```bash
cd comercial-inteligente && npm test
```

Cobrem: cálculos de margem (inclusive o exemplo documentado), status provisório/não calculável, alçadas,
hierarquia, delegação, escalonamento até o humano, ausência de ciclos (com teste de propriedade),
verificação de tarefas, permissões por papel, hook de segurança (como função e como processo), settings,
frontmatter dos agentes, validação/duplicidade/histórico, logs sem segredos, análises, previsão,
relatórios (seis seções; sem fabricar dados), mapeamento e importação do ERP com cliente simulado,
coerência entre documentação e CLI, e os 12 critérios de aceitação ponta a ponta pela CLI.

## Ativação em produção — o que o responsável humano precisa fornecer

1. **Política comercial** em `data/producao/politica_comercial.json` (copiar o modelo de `config/`):
   margem mínima, alçadas (desconto, margem e valor por papel), premissas de impostos e comissão, validade.
2. **Cadastro de agentes/usuários**: `registrar agente` para os 4 papéis de IA, os vendedores humanos e o responsável humano.
3. **Credenciais do ERP** (perfil `comercial`) e importação de clientes, produtos (preço base e custo), pedidos e leads.
4. **Custos completos** por produto (ou componentes: tecido, aviamentos, costura, aplicações, embalagem) e
   preços autorizados — sem eles a margem fica provisória ou não calculável.
5. **Certificações/documentos** válidos por produto (CA, laudos, normas), se houver.
6. **Meta do período** aprovada (`atualizar meta ... --json '{"status":"aprovada"}' --agente humano`).
7. Capacidade produtiva e lead times por família (enquanto não houver integração com o PCP).
8. Calibragem das premissas (`data/producao/premissas.json`) com o histórico real de conversão.

## Próximos passos recomendados

1. Configurar a política e importar os dados reais do ERP; rodar `/com-relatorio-executivo` e revisar.
2. Integrar leitura do financeiro (contas a receber/crédito) e do PCP (capacidade) — hoje "dados ausentes".
3. Migrar o armazenamento para o PostgreSQL do ERP (mesma interface de `src/store.js`) quando houver uso concorrente.
4. Agendar a reunião diária e o relatório semanal (agendamentos do Claude Code) após algumas semanas de uso assistido.
5. Calibrar probabilidades do funil com histórico de ganhos/perdas.
