CREATE TABLE "UnidadeEstoque" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "codigo" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "produtoId" INTEGER,
  "materialId" INTEGER,
  "descricao" TEXT NOT NULL,
  "cor" TEXT,
  "tamanho" TEXT,
  "origem" TEXT NOT NULL DEFAULT 'entrada',
  "coluna" TEXT,
  "andar" INTEGER,
  "caixaMaster" TEXT,
  "status" TEXT NOT NULL DEFAULT 'aguardando_endereco',
  "pedidoId" INTEGER,
  "expedicaoId" INTEGER,
  "loteEntrada" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPor" TEXT,
  "saidaEm" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "UnidadeEstoque_codigo_key" ON "UnidadeEstoque"("codigo");
CREATE INDEX "UnidadeEstoque_empresaId_status_idx" ON "UnidadeEstoque"("empresaId","status");
