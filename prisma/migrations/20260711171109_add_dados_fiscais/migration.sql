-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "codMunicipio" TEXT,
ADD COLUMN     "indicadorIE" INTEGER,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "municipio" TEXT,
ADD COLUMN     "numeroEndereco" TEXT,
ADD COLUMN     "uf" TEXT;

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "codMunicipio" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "crt" INTEGER DEFAULT 3,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "municipio" TEXT,
ADD COLUMN     "nfeProximoNumero" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nfeSerie" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "numeroEndereco" TEXT,
ADD COLUMN     "telefone" TEXT,
ADD COLUMN     "uf" TEXT;

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "cest" TEXT,
ADD COLUMN     "cfop" TEXT,
ADD COLUMN     "cofinsCst" TEXT DEFAULT '01',
ADD COLUMN     "icmsAliquota" DECIMAL(5,2),
ADD COLUMN     "icmsCst" TEXT,
ADD COLUMN     "ncm" TEXT,
ADD COLUMN     "origem" INTEGER DEFAULT 0,
ADD COLUMN     "pisCst" TEXT DEFAULT '01',
ADD COLUMN     "unidadeComercial" TEXT DEFAULT 'UN';
