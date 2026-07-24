-- Reforma Tributária (IBS/CBS) — parâmetros por empresa/filial
ALTER TABLE "Filial"
  ADD COLUMN IF NOT EXISTS "reformaAtiva" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "cbsAliquota" DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS "ibsUfAliquota" DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS "ibsMunAliquota" DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS "ibsCbsCst" TEXT DEFAULT '000',
  ADD COLUMN IF NOT EXISTS "ibsCbsClassTrib" TEXT DEFAULT '000001';

-- Alíquotas do período de transição 2026: CBS 0,9% e IBS 0,1% (UF).
UPDATE "Filial" SET "cbsAliquota" = 0.9 WHERE "cbsAliquota" IS NULL;
UPDATE "Filial" SET "ibsUfAliquota" = 0.1 WHERE "ibsUfAliquota" IS NULL;
UPDATE "Filial" SET "ibsMunAliquota" = 0 WHERE "ibsMunAliquota" IS NULL;
