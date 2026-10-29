# Workflow — Cotação e proposta

**Donos:** Vendedor (solicitação completa) · Gerente (conferência) · Diretor (preço formado / margem) · Humano (envio)

## 1. Solicitação de cotação completa (vendedor)
Requisitos: qualificação completa (ver `qualificacao.md`), logotipo/referências solicitados, produto
identificado no cadastro (`listar produto`). Etapa → `cotacao_solicitada`.

## 2. Montagem da proposta
- Com produto de **preço autorizado**: o vendedor pode montar
  `registrar proposta --json '{"oportunidadeId":"OPO-...","itens":[{"produtoId":"PRD-...","quantidade":300}],"premissasCusto":{"impostosPercent":null,"comissaoPercent":null,"freteTotal":null},"condicoesPagamento":null,"validadeAte":"AAAA-MM-DD","prazoEntrega":{"dias":null,"confirmadoOperacao":false}}'`
  (sem `precoUnitario`, a CLI usa o preço autorizado; com preço menor, calcula o desconto).
- **Sem preço autorizado**: a CLI recusa para vendedor/gerente (`PRECO_NAO_AUTORIZADO`). Escale:
  vendedor → gerente → diretor, que forma o preço com `margem` e cria a proposta.

## 3. Avaliação
`proposta avaliar --id PRO-...` → margem (calculada/provisória/não calculável) com memória de cálculo,
desconto, alçada exigida e pendências (prazo não confirmado, validade, condições, justificativa de desconto).

## 4. Aprovação
`aprovacao solicitar --proposta PRO-...` → se a alçada for do próprio agente, ele decide
(`aprovacao decidir --id APR-... --decisao aprovada --justificativa "..."`); se não, escala via
solicitação até o nível exigido (ver `delegacao_e_escalonamento.md`).

## 5. Envio
Só o responsável humano envia a proposta e registra: `atualizar proposta --id PRO-... --json '{"status":"enviada"}' --agente humano`.

## Conteúdo obrigatório da proposta
Preço unitário · quantidade · valor total · premissas de custo · margem (quando calculável) ·
condições de pagamento · prazo "sujeito à confirmação operacional" · validade · alçada de aprovação.
