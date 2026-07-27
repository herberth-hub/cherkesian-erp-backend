-- CNPJ (filial) responsável pelo pagamento do título
ALTER TABLE "ContaPagar" ADD COLUMN IF NOT EXISTS "filialId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_filialId_fkey"
    FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
