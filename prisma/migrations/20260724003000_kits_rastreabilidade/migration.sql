-- Rastreabilidade / Kits de Corte
CREATE TABLE "LoteTecido" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "codigoLote" TEXT NOT NULL,
  "materialId" INTEGER,
  "codigoTecido" TEXT,
  "descricaoTecido" TEXT,
  "corTecido" TEXT,
  "fornecedorId" INTEGER,
  "fornecedorNome" TEXT,
  "nfCompra" TEXT,
  "dataRecebimento" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPor" TEXT
);
CREATE UNIQUE INDEX "LoteTecido_empresaId_codigoLote_key" ON "LoteTecido"("empresaId", "codigoLote");

CREATE TABLE "Kit" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "codigo" TEXT NOT NULL,
  "pedidoId" INTEGER,
  "opId" INTEGER,
  "loteTecidoId" INTEGER,
  "clienteNome" TEXT,
  "modelo" TEXT,
  "variante" TEXT,
  "cor" TEXT,
  "tamanho" TEXT NOT NULL,
  "jogos" INTEGER NOT NULL DEFAULT 0,
  "pecasTotal" INTEGER NOT NULL DEFAULT 0,
  "ordemProducao" TEXT,
  "ordemCorte" TEXT,
  "enfesto" TEXT,
  "mesaCorte" TEXT,
  "operadorCorte" TEXT,
  "dataCorte" TIMESTAMP(3),
  "faccaoId" INTEGER,
  "faccaoNome" TEXT,
  "caixa" TEXT,
  "transportador" TEXT,
  "remessaNfId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'aguardando_expedicao',
  "expedidoEm" TIMESTAMP(3),
  "expedidoPor" TEXT,
  "retornadoEm" TIMESTAMP(3),
  "retornadoPor" TEXT,
  "qtdRetornada" INTEGER,
  "obs" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPor" TEXT
);
CREATE UNIQUE INDEX "Kit_codigo_key" ON "Kit"("codigo");
CREATE INDEX "Kit_empresaId_status_idx" ON "Kit"("empresaId", "status");
CREATE INDEX "Kit_loteTecidoId_idx" ON "Kit"("loteTecidoId");

CREATE TABLE "KitEvento" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "kitId" INTEGER NOT NULL,
  "evento" TEXT NOT NULL,
  "detalhe" TEXT,
  "usuario" TEXT,
  "ip" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitEvento_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "Kit"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KitEvento_kitId_idx" ON "KitEvento"("kitId");

ALTER TABLE "Kit" ADD CONSTRAINT "Kit_loteTecidoId_fkey" FOREIGN KEY ("loteTecidoId") REFERENCES "LoteTecido"("id") ON DELETE SET NULL ON UPDATE CASCADE;
