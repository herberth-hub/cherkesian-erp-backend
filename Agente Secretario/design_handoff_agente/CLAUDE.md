# Instruções para o Claude Code — Agente Secretário Cherkesian

Você vai construir o **Agente Secretário** do Grupo Cherkesian. Leia `README.md`,
`SYSTEM_PROMPT.md`, `tools.json` e `ROTINA.md` antes de começar.

## Objetivo

Um serviço que orquestra a **Claude API com tool use** para agir como secretário
executivo: lê e-mails/agenda, opera o ERP e prepara tarefas financeiras — sempre
com aprovação humana. Ele NÃO acessa o banco direto: usa a API REST do ERP
(já implantada no Render, base `/api/v1`) e conectores externos.

## Stack sugerida

- **Node.js + TypeScript** (mesmo ecossistema do backend do ERP).
- SDK oficial da Anthropic (`@anthropic-ai/sdk`) para as chamadas com `tools`.
- Conectores:
  - **Gmail + Google Calendar** via Google APIs (OAuth2, escopo mínimo:
    `gmail.readonly` + `gmail.send`, `calendar.events`). Conta Workspace
    `@hcqualitycorp.com.br`.
  - **ERP Cherkesian**: cliente HTTP autenticado (JWT do usuário `agente`) que
    chama as rotas `/api/v1/...`.
  - **OFX/CSV**: parser de extrato (ex.: `ofx-js` / parser CSV) a partir de upload.
- **Agendador**: cron (node-cron) ou os agendamentos do Claude Console, conforme ROTINA.md.
- **Fila de aprovações**: uma tabela `aprovacoes` (pendente/aprovada/recusada) +
  canal de notificação (e-mail/WhatsApp/painel). Ações amarelas/vermelhas ficam
  pendentes até o Herberth decidir.

## Requisitos NÃO-NEGOCIÁVEIS

1. **Human-in-the-loop:** toda tool de nível `amarelo`/`vermelho` (ver `_nivel`
   em tools.json) só efetiva com `confirmar: true`, e esse `true` só pode vir de
   uma aprovação real do Herberth — nunca preenchido pelo modelo por conta própria.
2. **Financeiro:** `baixar_titulo` e `fechamento_caixa` exigem confirmação
   reforçada (repetir o valor). O agente **não** movimenta conta bancária.
3. **Auditoria:** toda ação chama o ERP como usuário `agente`; a API já registra
   no log. Não burle isso.
4. **Escopo mínimo** nos OAuth e segredos em variáveis de ambiente (nunca no código).
5. **Idempotência** nas ações de escrita (evitar duplicar pagamento/pedido em retry).

## Passos

1. Criar o serviço, configurar SDK Anthropic e o `system` = conteúdo de SYSTEM_PROMPT.md.
2. Registrar as ferramentas de `tools.json`; implementar cada handler como wrapper
   da API do ERP ou do conector correspondente.
3. Implementar o loop de tool use (modelo pede tool → executa → devolve resultado →
   repete até resposta final). Para tools amarelas/vermelhas, em vez de executar,
   criar uma **aprovação pendente** e notificar; efetivar quando aprovada.
4. Conectar Gmail + Calendar (OAuth) e testar leitura (Fase 1).
5. Implementar os agendamentos de ROTINA.md.
6. Testar cada fase (leitura → redação → ERP → financeiro) antes de avançar.

## Fases de liberação

- **Fase 1 — Leitura:** briefings, consultas ao ERP, resumo de e-mails/agenda.
- **Fase 2 — Redação:** rascunhos de e-mail + agendamento (com aprovação).
- **Fase 3 — ERP ativo:** documentos, NF-e ao cliente, pedido de compra.
- **Fase 4 — Financeiro:** importar OFX/CSV, conciliar, fechamento de caixa.
- **Fase 5 — Rotina:** briefings automáticos e janelas financeiras agendadas.

Rode a Fase 1 por alguns dias antes de habilitar ações. Suba o poder do agente
conforme a confiança aumenta.
