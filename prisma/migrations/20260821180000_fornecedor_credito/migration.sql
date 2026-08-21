-- Crédito que o fornecedor concede a nos (compra a prazo)
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "limiteCredito" DECIMAL(12,2);
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "condicaoPagamento" TEXT;
