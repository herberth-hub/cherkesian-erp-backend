# Agente Secretário Cherkesian — Serviço (Fase 1: leitura)

Serviço Node.js/TypeScript que orquestra a **Claude API (tool use)** para agir como
secretário executivo do Grupo Cherkesian. Ele **não acessa o banco** — usa a API REST
do ERP (`/api/v1`) e o Google Workspace (Gmail + Calendar).

Fases implementadas: **1 (leitura)** e **2 (redação com aprovação humana)**.

## Ferramentas ativas (Fases 1–2)

| Tool | Nível | O que faz |
|---|---|---|
| `erp_consultar` | 🟢 | Lê qualquer módulo do ERP (dashboard, vendas, produção, estoque, compras, expedição, financeiro, clientes, fornecedores, produtos, materiais, comissões, nfe, logs) |
| `ler_emails` | 🟢 | Lista/resume e-mails (Gmail, somente leitura) |
| `ler_agenda` | 🟢 | Lê eventos do Google Calendar |
| `redigir_email` | 🟡 | **Prepara** um rascunho de e-mail — NÃO envia; vira proposta pendente |
| `agendar_reuniao` | 🟡 | **Propõe** um evento no Calendar — NÃO cria; vira proposta pendente |

As tools 🟡 **nunca executam sozinhas**: registram uma proposta na fila de aprovações.
O envio/agendamento real só acontece quando o Herberth aprova pelo CLI. As demais
ações (NF-e, pedido de compra, financeiro) entram nas Fases 3–4.

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
npm run agente -- "responda o e-mail do fornecedor X confirmando o recebimento"
npm run typecheck                      # checagem de tipos
```

### Fluxo de aprovação (Fase 2)

Quando você pede algo que gera e-mail/reunião, o agente **prepara e propõe** — nada
é enviado na hora. As propostas ficam pendentes até você decidir:

```bash
npm run aprovacoes                     # lista as propostas pendentes (mostra o e-mail/evento completo)
npm run aprovar -- <id>                # aprova e EXECUTA (envia o e-mail / cria o evento no Calendar)
npm run recusar -- <id>                # descarta a proposta
```

Enviar e-mail e criar eventos exigem o **Google conectado** (`npm run auth:google`).
A fila fica em `aprovacoes.json` (fora do git).

## Próximas fases

- **Fase 2 — Redação:** rascunhos de e-mail + agendamento (com aprovação).
- **Fase 3 — ERP ativo:** documentos, NF-e ao cliente, pedido de compra.
- **Fase 4 — Financeiro:** importar OFX/CSV, conciliar, fechamento de caixa.
- **Fase 5 — Rotina:** agendamentos (ver `../design_handoff_agente/ROTINA.md`).

Toda ação amarela/vermelha exigirá **aprovação humana** (fila de aprovações) antes de
efetivar — o agente sempre PREPARA e PROPÕE; quem AUTORIZA é o Herberth.
