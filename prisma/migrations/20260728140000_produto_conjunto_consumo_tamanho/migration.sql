-- Consumo por tamanho (BOM) + campos padrão do produto acabado
ALTER TABLE "Consumo" ADD COLUMN IF NOT EXISTS "porTamanho" JSONB;
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "precoEspecial" DECIMAL(12,2);
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "tamsEspeciais" TEXT;
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "clienteGrupo" TEXT;
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "clienteId" INTEGER;
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "setor" TEXT;
