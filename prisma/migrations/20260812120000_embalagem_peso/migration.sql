-- Embalagens (caixa/fardo) + peso/embalagem no produto
CREATE TABLE "Embalagem" (
  "id" SERIAL NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "tipo" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "pesoVazio" DECIMAL(10,3) NOT NULL DEFAULT 0,
  "comprimento" INTEGER,
  "largura" INTEGER,
  "altura" INTEGER,
  "capacidade" INTEGER,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Embalagem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Produto" ADD COLUMN "pesoUnitario" DECIMAL(10,3);
ALTER TABLE "Produto" ADD COLUMN "pesoPorTamanho" JSONB;
ALTER TABLE "Produto" ADD COLUMN "caixaId" INTEGER;
ALTER TABLE "Produto" ADD COLUMN "pecasPorCaixa" INTEGER;
ALTER TABLE "Produto" ADD COLUMN "fardoId" INTEGER;
ALTER TABLE "Produto" ADD COLUMN "pecasPorFardo" INTEGER;
