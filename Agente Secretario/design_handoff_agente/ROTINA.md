# Rotina do Agente — Agendamentos (cron)

Fuso: `America/Sao_Paulo`. Dias úteis (seg–sex), pulando feriados nacionais.
Cada agendamento dispara o agente com uma instrução; o agente executa a tarefa
respeitando os níveis de autorização (ver SYSTEM_PROMPT.md).

## Diário (dias úteis)

| Cron | Horário | Tarefa | Nível |
|---|---|---|---|
| `0 8 * * 1-5`  | 08:00 | Briefing da manhã (e-mails, agenda, pendências ERP, o que vence hoje) | 🟢 |
| `30 8 * * 1-5` | 08:30 | Triagem de e-mails + rascunhos de resposta | 🟡 |
| `0 9 * * 1-5`  | 09:00 | Contas a receber — cobranças/lembretes | 🟡 |
| `0 11 * * 1-5` | 11:00 | **Janela de pagamentos (principal)** — fila de contas a pagar p/ aprovação | 🔴 |
| `0 14 * * 1-5` | 14:00 | Documentos e envios (NF-e, pedido de compra) | 🟡 |
| `0 16 * * 1-5` | 16:00 | Janela de pagamentos (extra, opcional) | 🔴 |
| `30 17 * * 1-5`| 17:30 | Conciliação bancária (importar OFX/CSV) | 🟡 |
| `0 18 * * 1-5` | 18:00 | **Fechamento de caixa** — consolidar e apresentar p/ confirmação | 🔴 |
| `15 18 * * 1-5`| 18:15 | Relatório de fim de dia | 🟢 |

## Semanal / Mensal

| Cron | Quando | Tarefa |
|---|---|---|
| `30 8 * * 1`   | Seg 08:30 | Planejamento da semana |
| `0 17 * * 5`   | Sex 17:00 | Resumo semanal (faturamento, recebido × pago, inadimplência) |
| `0 9 1 * *`    | Dia 1º    | Fechamento mensal (DRE simplificada, fluxo de caixa, comissões, impostos) |
| `0 9 5,20 * *` | Dia 5 e 20| Alertas de vencimentos fiscais (DAS/Simples, INSS, FGTS) |
| `0 10 1 * *`   | Dia 1º    | Recalcular custo industrial (despesas ÷ peças) e sugerir % de precificação |

## Janela de pagamentos — passos

1. Selecionar títulos a pagar com vencimento ≤ hoje.
2. Validar valor, fornecedor, categoria, saldo disponível; sinalizar duplicidade/anomalia.
3. Apresentar a fila: total do lote + saldo resultante.
4. Aguardar aprovação (lote inteiro / ajustar / adiar). **Nunca paga sem OK.**
5. Após aprovado: registrar baixa no ERP + guardar comprovante. Auditoria.

> O agente NÃO movimenta a conta bancária (não faz PIX/TED). Ele organiza,
> valida e registra no ERP; a transferência é feita por uma pessoa; a
> conciliação das 17:30 confirma.

## Fechamento de caixa — saída esperada

```
FECHAMENTO DE CAIXA — <data>            [aguardando confirmação]
 Saldo abertura ................... R$ ...
 (+) Entradas conciliadas ......... R$ ...   (n recebimentos)
 (-) Saídas aprovadas ............. R$ ...   (n pagamentos)
 ----------------------------------------------
 Saldo fechamento ................. R$ ...
 Divergências ..................... n
```
Divergências em aberto bloqueiam o fechamento até resolução.

## Configurável pelo Herberth

- Horários das janelas.
- Limite de alçada (padrão: pagamentos > R$ 5.000 → 🔴).
- Canais de aviso: e-mail / WhatsApp / painel do ERP.
- Calendário de dias úteis e feriados.
- Botão "pausar agente" (suspende toda a rotina).
