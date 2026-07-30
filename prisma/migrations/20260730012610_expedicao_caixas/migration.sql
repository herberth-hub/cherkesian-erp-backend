-- Plano de embalagem por caixa na expedicao
ALTER TABLE "Expedicao" ADD COLUMN IF NOT EXISTS "caixas" JSONB;
