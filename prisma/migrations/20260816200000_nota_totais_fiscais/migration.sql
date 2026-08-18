-- Totais fiscais lidos do XML autorizado (relatório da contabilidade)
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "valorProdutos" DECIMAL(12,2);
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "baseIcms" DECIMAL(12,2);
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "valorIcms" DECIMAL(12,2);
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "valorPis" DECIMAL(12,2);
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "valorCofins" DECIMAL(12,2);
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "valorIpi" DECIMAL(12,2);
