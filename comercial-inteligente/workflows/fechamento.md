# Workflow — Fechamento e passagem para operação

**Donos:** Vendedor (dados completos) · Gerente (conferência) · Humano (pedido no ERP)

## Ganho
1. Cliente aceita (evidência: e-mail, OC, pedido de compra) → vendedor registra
   `atualizar proposta --id PRO-... --json '{"status":"aceita","respondidaEm":"AAAA-MM-DD"}'`.
2. Oportunidade → `pedido_ganho` com `fechadoEm`.
3. Checklist para o pedido: razão social/CNPJ e dados fiscais, endereço de entrega, grade por tamanho e
   cor, personalização e arte aprovada, condições de pagamento, prazo **confirmado pelo PCP**, piloto
   (obrigatório para cliente novo no ERP), número da OC do cliente.
4. O **pedido é lançado no ERP pelo humano** (módulo `pedidos`) e chega a esta base por
   `erp importar --recurso pedidos` ou `registrar pedido` (humano, com `evidencia`).
5. Agentes não confirmam pedido, prazo ou entrega ao cliente.

## Perda
Oportunidade → `pedido_perdido` com `fechadoEm`, `motivoPerda` e `concorrenteInformado` (só o que o
cliente informou). Definir `proximoPasso` de recontato quando fizer sentido.
