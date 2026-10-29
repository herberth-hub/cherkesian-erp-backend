# Política comercial

A política **efetiva** é o arquivo JSON lido pela CLI (`politica mostrar`):

1. `data/producao/politica_comercial.json` — definida pelo responsável humano (fora do git);
2. senão `config/politica_comercial.json` — **modelo não configurado** (todos os valores `null`).

Enquanto `configurado` for `false`, **toda proposta exige decisão do responsável humano**. Os agentes
podem propor valores, mas não alteram a política (nenhum comando da CLI escreve esse arquivo).

## Campos

| Campo | Significado |
| --- | --- |
| `margemMinimaPercent` | Margem de contribuição mínima. Abaixo dela, só o humano decide — nunca há aprovação automática. |
| `premissasPadrao.impostosPercent` / `comissaoPercent` | Usadas quando a proposta não informa as próprias. `null` = não configurado (margem não calculável sem impostos). |
| `validadePropostaDias` | Validade padrão de proposta. |
| `alcadas.<papel>.descontoMaxPercent` | Desconto máximo sobre o preço autorizado que o papel pode aprovar. |
| `alcadas.<papel>.margemMinimaPercent` | Margem mínima para o papel aprovar. |
| `alcadas.<papel>.valorMaximoProposta` | Valor total máximo que o papel aprova (`null` = sem limite de valor). |

Alçada `null` (desconto ou margem) = o papel **não** aprova nada; sobe para o próximo nível.

## Regras de alçada (implementadas em `src/precificacao.js → determinarAlcada`)

1. Política não configurada → **humano**.
2. Margem calculada abaixo da mínima global → **humano**.
3. Margem não calculável (custo ou impostos ausentes) → mínimo **diretor**.
4. Margem provisória (comissão, frete ou componente de custo ausente) → mínimo **gerente**.
5. Item sem preço autorizado (preço formado) → mínimo **diretor**.
6. Cliente ou oportunidade estratégica → mínimo **diretor**.
7. Menor papel cujo limite comporta desconto, margem e valor; se nenhum comporta → **humano**.

A alçada é recalculada no momento da decisão (`aprovacao decidir`); se custos ou política mudaram, a
exigência pode subir.

## Condições comerciais

- Preço: somente `precoAutorizado` do produto ou preço formado pelo diretor/humano com margem calculada.
- Desconto: sempre com justificativa registrada (`justificativaDesconto`); desconto sem justificativa aparece como pendência.
- Prazo de entrega: sempre "sujeito à confirmação operacional" até `prazoEntrega.confirmadoOperacao = true` (confirmado pelo PCP via humano).
- Condições de pagamento e crédito: propostas pelo comercial, **concedidas** pelo financeiro/humano (o ERP possui consulta de crédito).
- Validade: obrigatória; proposta vencida não é renegociada sem nova avaliação.
- Alteração de especificação após aprovação: nova proposta (revisão), nova avaliação de margem e prazo.

## Proibições

- Preço baseado só no concorrente; promessa de certificação sem documento; prazo sem confirmação;
  pedido sem evidência; comunicação externa enviada por agente; desconto "para fechar" fora da alçada.
