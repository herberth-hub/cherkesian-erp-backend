# Precificação e rentabilidade

## Fórmulas (implementadas em `src/precificacao.js`)

```
Receita bruta        = preço unitário × quantidade
Impostos             = receita bruta × alíquota sobre a venda (%)
Receita líquida      = receita bruta − impostos
Custos variáveis     = custo variável unitário × quantidade
                     + comissão (% sobre a receita bruta)
                     + frete assumido pela empresa
                     + outros custos variáveis atribuíveis à venda
Margem de contribuição (R$) = receita líquida − custos variáveis
Margem de contribuição (%)  = margem de contribuição ÷ receita líquida × 100
Markup (multiplicador)      = preço unitário ÷ custo variável unitário
```

**Margem não é markup.** Exemplo verificável (coberto por teste automatizado):

| Entrada | Valor |
| --- | --- |
| Preço | R$ 50,00 · 100 peças |
| Custo variável unitário | R$ 20,00 |
| Impostos | 10% |
| Comissão | 5% sobre a receita bruta |
| Frete assumido | R$ 100,00 |

Receita bruta 5.000,00 · impostos 500,00 · receita líquida 4.500,00 · custos variáveis
2.000,00 + 250,00 + 100,00 = 2.350,00 · **MC = 2.150,00 · MC% = 47,78%** · markup = 2,5×.
A conta ingênua "(50 − 20) ÷ 50 = 60%" ignora impostos, comissão e frete e **superestima** a margem.

## Status da margem

| Status | Quando | Efeito |
| --- | --- | --- |
| `calculada` | preço, quantidade, custo, impostos, comissão, frete e outros informados | valor confiável |
| `provisoria` | faltou comissão, frete, outros ou um componente de custo (assumido 0, declarado) | alçada mínima gerente; relatar como provisória |
| `nao_calculavel` | faltou preço, quantidade, custo variável ou impostos | alçada mínima diretor; não informar margem |

## Custo variável unitário

Ordem de prioridade: componentes informados no item → custo informado no item → componentes do
produto → `custoVariavelUnitario` do produto (no ERP: `Produto.custo`, custo direto). Componentes
típicos para confecção: tecido (consumo × preço do metro), aviamentos, corte, costura/facção,
bordado/silk/DTF, acabamento, embalagem e etiqueta. Componente `null` torna a margem provisória.

## Checklist industrial antes de formar preço (diretor)

Quantidade e grade · tecido/composição/gramatura · consumo de tecido e aviamentos · modelagem e
complexidade · aplicações (bordado, silk, DTF) · embalagem/etiquetagem · capacidade e prazo
(corte, costura, acabamento, expedição) · prazo de matéria-prima e oficinas externas · frete ·
impostos (CNPJ emissor/filial) · comissão · condições de pagamento · necessidade de piloto/amostra ·
risco de alteração de especificação.

## Comandos

- `margem --preco 50 --qtd 100 --custo 20 --impostos 10 --comissao 5 --frete 100 [--preco-tabela 55]` — cálculo avulso com memória de cálculo e alçada.
- `proposta avaliar --id PRO-xxxx` — avalia a proposta com produtos e política e grava o resultado.
