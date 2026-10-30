# Workflow — Pós-venda e recompra

**Donos:** Vendedor (acompanhamento) · Gerente (riscos e reclamações) · Diretor (expansão)

1. **Acompanhar o pedido**: `pipeline pedidos-risco` (atraso, prazo próximo, sem prazo). Risco → gerente → diretor, que aciona PCP/expedição via humano.
2. **Entrega concluída**: oportunidade → `pos_venda`; registrar atividade de satisfação (rascunho de pesquisa para o humano enviar).
3. **Reclamação**: registrar atividade e escalar ao gerente; o ERP tem canal de anomalias (`src/anomalias`) operado pelas áreas.
4. **Recompra**: com `frequenciaReposicao` conhecida, criar oportunidade de reposição com `previsaoFechamentoEm` (não duplicar: a CLI recusa oportunidade aberta igual).
5. **Expansão de mix**: diretor analisa `pipeline carteira` e propõe novos produtos/unidades.
6. **Inativos**: `pipeline inativos` alimenta a campanha de recuperação (`/com-recuperar-inativos`).
