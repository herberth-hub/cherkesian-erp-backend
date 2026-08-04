-- Empresa proprietária + documento de origem em Contas a Receber (import + separação HC/Yerevan)
ALTER TABLE "ContaReceber" ADD COLUMN "filialId" INTEGER;
ALTER TABLE "ContaReceber" ADD COLUMN "documento" TEXT;
