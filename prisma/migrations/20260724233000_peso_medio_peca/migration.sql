-- Peso médio por peça (kg) para peso bruto/líquido na NF
ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "pesoMedioPeca" DECIMAL(8,3);
UPDATE "Filial" SET "pesoMedioPeca" = 0.300 WHERE "pesoMedioPeca" IS NULL;
