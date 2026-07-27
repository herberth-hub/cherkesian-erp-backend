-- CNPJ destinatário (filial) que recebeu a mercadoria na NF de entrada
ALTER TABLE "NotaEntrada" ADD COLUMN IF NOT EXISTS "filialId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "NotaEntrada" ADD CONSTRAINT "NotaEntrada_filialId_fkey"
    FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
