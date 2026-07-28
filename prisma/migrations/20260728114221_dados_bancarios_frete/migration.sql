-- Dados bancários da filial (proposta) e condição de frete do pedido
ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "dadosBancarios" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "frete" TEXT;
