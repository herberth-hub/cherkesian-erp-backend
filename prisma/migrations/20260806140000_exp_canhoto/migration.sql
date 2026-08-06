-- Canhoto assinado da NF (foto arquivada) na expedição
ALTER TABLE "Expedicao" ADD COLUMN IF NOT EXISTS "canhotoImg" TEXT;
ALTER TABLE "Expedicao" ADD COLUMN IF NOT EXISTS "canhotoEm" TIMESTAMP(3);
