-- Filiais / CNPJs do grupo (matriz + filiais) — emitentes de NF-e independentes
CREATE TABLE "Filial" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "nome" TEXT NOT NULL,
  "matriz" BOOLEAN NOT NULL DEFAULT false,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "cnpj" TEXT,
  "inscricaoEstadual" TEXT,
  "crt" INTEGER DEFAULT 3,
  "nomeFantasia" TEXT,
  "logradouro" TEXT,
  "numeroEndereco" TEXT,
  "complemento" TEXT,
  "bairro" TEXT,
  "municipio" TEXT,
  "codMunicipio" TEXT,
  "uf" TEXT,
  "cep" TEXT,
  "telefone" TEXT,
  "nfeSerie" TEXT NOT NULL DEFAULT '1',
  "nfeProximoNumero" INTEGER NOT NULL DEFAULT 1,
  "focusToken" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "Filial" ADD CONSTRAINT "Filial_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Pedido" ADD COLUMN "filialId" INTEGER;
ALTER TABLE "OP" ADD COLUMN "filialId" INTEGER;
ALTER TABLE "NotaFiscal" ADD COLUMN "filialId" INTEGER;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OP" ADD CONSTRAINT "OP_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cria a Matriz a partir dos dados fiscais atuais de cada Empresa
INSERT INTO "Filial" ("empresaId","nome","matriz","cnpj","inscricaoEstadual","crt","nomeFantasia","logradouro","numeroEndereco","complemento","bairro","municipio","codMunicipio","uf","cep","telefone","nfeSerie","nfeProximoNumero")
SELECT "id",'Matriz',true,"cnpj","inscricaoEstadual","crt","nomeFantasia","logradouro","numeroEndereco","complemento","bairro","municipio","codMunicipio","uf","cep","telefone","nfeSerie","nfeProximoNumero" FROM "Empresa";

-- Vincula pedidos existentes à Matriz da sua empresa
UPDATE "Pedido" p SET "filialId" = (SELECT f."id" FROM "Filial" f WHERE f."empresaId" = p."empresaId" AND f."matriz" = true ORDER BY f."id" LIMIT 1);
