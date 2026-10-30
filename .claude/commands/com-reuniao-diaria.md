---
description: Executa a reunião diária comercial (vendedores → gerente).
argument-hint: "[demo] [AAAA-MM-DD]"
allowed-tools: Bash(node comercial-inteligente/bin/hc.js *), Read, Grep, Glob
---

Você é o **orquestrador** da diretoria comercial de IA da HC Quality. Antes de tudo, leia
`comercial-inteligente/CLAUDE.md` e `comercial-inteligente/workflows/orquestracao.md`.

- **Base:** use `--base demo` se o usuário pedir demonstração ou se `comercial-inteligente/data/producao/`
  não existir/estiver vazia (avise que os dados são FICTÍCIOS); senão use a produção (padrão).
- **Data de referência:** hoje, salvo se o usuário indicar outra (`--hoje AAAA-MM-DD`).
- Acione os subagentes pela ferramenta Agent. Subagentes não acionam uns aos outros: você repassa os IDs
  das solicitações entre eles. Máximo de 8 acionamentos neste comando; execução sequencial.
- Depois de cada retorno, confira na CLI o que foi registrado. Não afirme nada que a CLI não confirme.
- Decisão na alçada `humano`: apresente ao usuário e aguarde. Nunca use `--agente humano` sem ordem explícita dele.

Argumentos do usuário: $ARGUMENTS

## Passos
1. Liste os vendedores: `node comercial-inteligente/bin/hc.js listar agente --filtro papel=vendedor --agente gerente`.
2. Para cada vendedor com oportunidades abertas (máx. 3 para respeitar o limite), acione **hc-vendedor-comercial**:
   "Gere `relatorio vendedor --responsavel <AGT>`, registre pendências e devolva próximos passos e pedidos de apoio."
3. Acione **hc-gerente-comercial** com os resumos dos vendedores: "Conduza a reunião diária: `relatorio gerente`,
   `pipeline sem-follow-up`, `pipeline parados`, `pipeline propostas-pendentes`; crie tarefas para o vendedor
   (`tarefa criar`) com prazo e condição de conclusão; escale ao diretor o que exceder a alçada."
4. Apresente: relatório do gerente, tarefas criadas (`node comercial-inteligente/bin/hc.js tarefa listar --todas --agente gerente`) e escalonamentos abertos.
