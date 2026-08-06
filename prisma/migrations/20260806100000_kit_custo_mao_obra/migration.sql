-- Custo de mão de obra por peça a pagar ao terceiro (na OS/romaneio)
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "custoMaoObra" DECIMAL(12,2);
