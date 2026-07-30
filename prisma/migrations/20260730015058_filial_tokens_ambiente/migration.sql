-- Tokens Focus por ambiente (homologacao/producao) por filial
ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "focusTokenHomolog" TEXT;
ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "focusTokenProd" TEXT;
