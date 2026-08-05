-- Dados fiscais do fornecedor/facção (NF-e de remessa para industrialização)
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "faccao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "inscricaoEstadual" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "indicadorIE" INTEGER;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "logradouro" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "numeroEndereco" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "bairro" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "municipio" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "codMunicipio" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "uf" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "cep" TEXT;
