-- Ordem de compra do cliente (nº do pedido de compra / PO) no pedido e na NF-e.
ALTER TABLE "Pedido" ADD COLUMN "ordemCompraCliente" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "ordemCompraCliente" TEXT;
