-- Ambiente NF-e por filial (homologacao/producao) — sobrepoe o global
ALTER TABLE "Filial" ADD COLUMN IF NOT EXISTS "nfeAmbiente" TEXT;
