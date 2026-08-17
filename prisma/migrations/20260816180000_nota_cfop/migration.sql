-- CFOP(s) e natureza da operação na NotaFiscal (identificação p/ contabilidade)
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "cfop" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN IF NOT EXISTS "natureza" TEXT;
