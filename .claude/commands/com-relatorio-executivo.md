---
description: Gera o relatório executivo do CEO (diretor → CEO).
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
1. Acione **hc-diretor-comercial**: "Gere `relatorio diretor` e sua análise (formato reports/diretor.md). Liste decisões que precisam do CEO."
2. Acione **hc-ceo** com o resumo do diretor: "Gere `relatorio ceo` e a análise executiva (reports/ceo.md): resumo,
   riscos, decisões necessárias com alternativas e impactos (estimativas rotuladas) e plano de ação."
3. Entregue ao usuário o relatório do CEO e a lista de decisões pendentes do responsável humano.
