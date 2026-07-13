# Agente Secretário Cherkesian — Serviço (Fase 1: leitura)

Serviço Node.js/TypeScript que orquestra a **Claude API (tool use)** para agir como
secretário executivo do Grupo Cherkesian. Ele **não acessa o banco** — usa a API REST
do ERP (`/api/v1`) e o Google Workspace (Gmail + Calendar).

Esta é a **Fase 1 — somente leitura**: briefings, consultas ao ERP e resumo de
e-mails/agenda. Nenhuma ação de escrita (enviar e-mail, gerar NF-e, pagar) é executada.

## Ferramentas ativas na Fase 1 (nível 🟢 verde)

| Tool | O que faz |
|---|---|
| `erp_consultar` | Lê qualquer módulo do ERP (dashboard, vendas, produção, estoque, compras, expedição, financeiro, clientes, fornecedores, produtos, materiais, comissões, nfe, logs) |
| `ler_emails` | Lista/resume e-mails (Gmail, somente leitura) |
| `ler_agenda` | Lê eventos do Google Calendar |

As tools de escrita (🟡/🔴) do `tools.json` entram nas Fases 2–4.

## Instalação

```bash
cd "Agente Secretario/service"
npm install
cp .env.example .env      # preencha as variáveis
```

### Pré-requisitos

1. **Claude API:** defina `ANTHROPIC_API_KEY` no `.env`.
2. **Usuário do ERP:** crie no ERP um usuário **`agente`** (perfil **total**) — assim
   toda leitura fica auditada como `agente`. Defina `ERP_USER`/`ERP_SENHA`.
3. **Google (opcional nesta fase):** para ativar `ler_emails`/`ler_agenda`, crie
   credenciais OAuth no Google Cloud (APIs Gmail + Calendar), preencha
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` e rode:
   ```bash
   npm run auth:google
   ```
   Abra o link, autorize com a conta `contato@hcqualitycorp.com.br`. O token fica
   em `token.google.json` (fora do git). Sem isso, os briefings rodam só com o ERP.

## Uso

```bash
npm run briefing                       # briefing da manhã (dashboard + vencimentos + agenda/e-mails)
npm run agente -- "quanto tenho a receber vencido?"
npm run agente -- "quais materiais estão abaixo do mínimo?"
npm run typecheck                      # checagem de tipos
```

## Próximas fases

- **Fase 2 — Redação:** rascunhos de e-mail + agendamento (com aprovação).
- **Fase 3 — ERP ativo:** documentos, NF-e ao cliente, pedido de compra.
- **Fase 4 — Financeiro:** importar OFX/CSV, conciliar, fechamento de caixa.
- **Fase 5 — Rotina:** agendamentos (ver `../design_handoff_agente/ROTINA.md`).

Toda ação amarela/vermelha exigirá **aprovação humana** (fila de aprovações) antes de
efetivar — o agente sempre PREPARA e PROPÕE; quem AUTORIZA é o Herberth.
