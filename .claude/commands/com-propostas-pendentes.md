---
description: Revisa propostas pendentes (sem resposta, a vencer, aguardando aprovação).
argument-hint: "[demo]"
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
1. Acione **hc-gerente-comercial**: "Revise `pipeline propostas-pendentes` e `aprovacao listar --status pendente`.
   Programe follow-ups (rascunhos para o humano enviar), decida aprovações na sua alçada e escale as demais ao diretor."
2. Se houver escalonamento ao diretor, acione **hc-diretor-comercial** com os IDs (SOL/APR).
3. Apresente propostas, ações e decisões pendentes.
