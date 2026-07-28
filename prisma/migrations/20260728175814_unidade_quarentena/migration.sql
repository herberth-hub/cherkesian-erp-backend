-- Quarentena: motivo da unidade em quarentena (anomalia/estorno)
ALTER TABLE "UnidadeEstoque" ADD COLUMN IF NOT EXISTS "areaMotivo" TEXT;
