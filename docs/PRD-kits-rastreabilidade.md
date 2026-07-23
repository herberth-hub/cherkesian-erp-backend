# PRD — Módulo de Kits de Corte, Expedição para Facção e Rastreabilidade

> **Escopo: MULTI-EMPRESA.** Vale para todas as empresas cadastradas no ERP (tudo com `empresaId`).
> Status: planejado (task #83). Implementar em fase dedicada, Clean Architecture, transações, idempotência.

## Objetivo
Eliminar a etiquetagem manual peça a peça. Controle por **KIT** = conjunto completo de peças de **um único tamanho**.
Rastreabilidade completa do **lote do tecido** (NF de compra do fornecedor) até o retorno da facção.

## Fluxo
Recebimento tecido → Cadastro do lote → Enfesto → Ordem de Corte → Separação por tamanho → Montagem dos Kits → Caixas plásticas identificadas → Impressão Zebra → Expedição p/ facção → Retorno → Conferência → Produção final.

## KIT
- ID único `KIT-AAAAMMDD-NNNNNN` (sem duplicidade). 1 tamanho por kit. 1 lote por kit (lotes diferentes ⇒ kits independentes).
- Caixa plástica pertence a UM pedido; contém vários kits (um por tamanho).
- Campos: ID, pedido, cliente, modelo, variante, cor, tamanho, qtd jogos, qtd total peças, OP, OC, enfesto, mesa de corte, operador, data/hora corte, facção destino, caixa, status, lote tecido, código tecido, descrição tecido, cor tecido, fornecedor tecido, nº NF compra tecido, data recebimento tecido.

## Etiqueta Zebra (ZPL, ~100x70mm)
Logo, KIT+ID, pedido, cliente, modelo, cor, tamanho, jogos, peças, lote, enfesto, ordem corte, destino, **QR Code grande** (JSON compacto: kit,pedido,cliente,modelo,cor,tam,jogos,pecas,lote,enfesto,oc,versao) + **Code128** do ID abaixo. Chave de leitura = campo `kit`.

## Máquina de estados
CRIADO → EM CORTE → AGUARDANDO EXPEDIÇÃO → EM FACÇÃO → RETORNADO → EM CONFERÊNCIA → FINALIZADO.

## Expedição / Retorno (por leitura de QR/Code128, IDEMPOTENTE)
- Expedição: localiza kit, valida status, registra data/hora/usuário/facção/transportador/obs → EM FACÇÃO.
- Retorno: bipa de novo → RETORNADO (data/hora/usuário/qtd/facção/obs). Se já retornado, exibir aviso e NÃO movimentar.

## Integração fiscal (remessa)
- Se existe NF de remessa vinculada ao pedido: associar ao kit, **não** duplicar movimentação/estoque/saída.
- Sem remessa: permitir emissão / registrar retorno interno. Nunca duplicar entrada/estoque.

## Regras
Nunca: 2 kits mesmo ID; retorno sem saída; saída/retorno duplicado; kit sem lote/pedido/tamanho; kit sem facção quando expedido; kit com lotes ou tamanhos diferentes; alterar lote após expedição sem permissão admin.
Alteração de lote: registra lote anterior/novo, usuário, motivo, data/hora (só autorizados).

## Auditoria
Todo evento gera histórico: data, hora, usuário, evento, pedido, kit, facção, IP.

## Dashboard (indicadores)
Kits aguardando expedição / na facção / retornados hoje / atrasados; por facção/cliente/pedido/modelo/tamanho/lote; tempo médio em facção / de corte / até conferência; produção por período.

## Busca
Por: nº KIT, pedido, cliente, modelo, variante, cor, tamanho, facção, code128, QR, NF remessa, enfesto, OC, OP, lote, código tecido, fornecedor. Consulta por lote mostra todos pedidos/clientes/kits/facções/situação/datas/qtds.

## Serviços (Clean Architecture)
Kit, QRCode, Barcode, ZebraPrint, LabelTemplate, Faccao, Expedicao, Recebimento, RemessaFiscal, LoteTecido, Enfesto, OrdemCorte, Historico, Dashboard, Status, Auditoria.

## Integrações automáticas em cada movimentação
Produção, PCP, Estoque, Estoque em Terceiros, Fiscal, Financeiro (quando aplicável), Histórico, Dashboard, Pedidos, Rastreabilidade.
