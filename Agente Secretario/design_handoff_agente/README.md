# Handoff — Agente Secretário Cherkesian

Este pacote contém tudo que o **Claude Code** (ou um desenvolvedor) precisa para
construir o **Agente Secretário do Grupo Cherkesian**: um assistente de IA que lê
e-mails, organiza a agenda, opera o ERP Cherkesian e prepara tarefas financeiras —
sempre com aprovação humana (human-in-the-loop).

## Contexto

- O **ERP Cherkesian** já existe (frontend) e o **backend** já foi implantado no
  Render (Node.js/NestJS + PostgreSQL no Neon), expondo uma API REST em
  `/api/v1`. O agente usa ESSA API como suas ferramentas — não acessa o banco
  diretamente.
- O diretor é **Herberth Cherkesian** (`contato@hcqualitycorp.com.br`,
  Google Workspace).
- Empresa: uniformes profissionais. Fluxo do negócio: orçamento → aprovação →
  (cliente novo? peça-piloto) → checagem de material (BOM × estoque) → OP /
  ordem de compra → produção → estoque por lote → expedição com rastreio.

## O que tem neste pacote

| Arquivo | Para que serve |
|---|---|
| `README.md` | Este guia |
| `SYSTEM_PROMPT.md` | O "cérebro" do agente — instruções permanentes |
| `tools.json` | Definição das ferramentas (function calling) que o agente pode chamar |
| `ROTINA.md` | Agendamentos (cron) — briefings, janelas de pagamento, fechamento |
| `CLAUDE.md` | Instruções para o Claude Code implementar |
| `Especificacao.dc.html` | Documento visual da especificação (referência) |
| `Rotina.dc.html` | Documento visual da rotina (referência) |

## Princípio central (NÃO-NEGOCIÁVEL)

**O agente PREPARA e PROPÕE; quem AUTORIZA é o Herberth.**

- 🟢 **Verde** — só leitura, executa livre (resumir e-mails, consultar ERP/agenda).
- 🟡 **Amarelo** — 1 clique de aprovação (enviar e-mail, NF-e, pedido de compra, gerar OP).
- 🔴 **Vermelho** — confirmação reforçada com valores à vista (fechamento de caixa, baixa de título).

O agente **nunca** movimenta a conta bancária nem envia comunicação externa
sozinho. Toda ação é registrada na auditoria do ERP com usuário `agente`.

## Arquitetura

```
Herberth  ──conversa/autoriza──►  Agente (Claude tool use)
                                       │  chama tools
                 ┌─────────────────────┼─────────────────────┐
              Gmail /            Google Calendar        ERP Cherkesian
              Workspace                                   (API REST)
                                                              │
                                                    Extratos OFX/CSV (upload)
```

## Como começar (ordem recomendada)

1. Ler `SYSTEM_PROMPT.md`, `tools.json` e `ROTINA.md`.
2. Implementar as ferramentas como wrappers da API do ERP (`/api/v1/...`) +
   conectores Gmail/Calendar (OAuth com escopo mínimo).
3. **Fase 1 (só leitura):** rodar briefings e consultas por alguns dias.
4. Ativar as ações amarelas (envios, documentos) com o fluxo de aprovação.
5. Ativar as ações vermelhas (financeiro) por último, com limites de alçada.

Ver `CLAUDE.md` para instruções detalhadas de implementação.
