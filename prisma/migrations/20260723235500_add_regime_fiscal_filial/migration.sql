-- Parâmetros tributários por empresa/CNPJ
ALTER TABLE "Filial" ADD COLUMN "regimeTributario" TEXT NOT NULL DEFAULT 'lucro_presumido';
ALTER TABLE "Filial" ADD COLUMN "icmsInterno" DECIMAL(5,2);
ALTER TABLE "Filial" ADD COLUMN "icmsCstPadrao" TEXT DEFAULT '00';
ALTER TABLE "Filial" ADD COLUMN "pisAliquota" DECIMAL(6,4);
ALTER TABLE "Filial" ADD COLUMN "cofinsAliquota" DECIMAL(6,4);
ALTER TABLE "Filial" ADD COLUMN "pisCofinsCst" TEXT DEFAULT '01';
ALTER TABLE "Filial" ADD COLUMN "csosn" TEXT;
