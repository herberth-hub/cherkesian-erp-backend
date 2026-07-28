-- Localização do material na prateleira (romaneio de corte)
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "localizacao" TEXT;
