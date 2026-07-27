-- Romaneio de materiais do corte (BOM x qtd) com status de conferência por bip
ALTER TABLE "OP" ADD COLUMN IF NOT EXISTS "romaneioMateriais" JSONB;
