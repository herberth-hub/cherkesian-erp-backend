-- Conjunto/kit: componentes que a OP explode (camisa, calça...)
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "componentes" JSONB;
