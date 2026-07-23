-- Notas de entrada (NF de compra recebida) + itens.

CREATE TABLE "NotaEntrada" (
  "id"             SERIAL   NOT NULL,
  "empresaId"      INTEGER  NOT NULL,
  "fornecedorId"   INTEGER,
  "numero"         TEXT     NOT NULL,
  "serie"          TEXT,
  "chave"          TEXT,
  "cnpjEmitente"   TEXT,
  "nomeEmitente"   TEXT,
  "emitidaEm"      TIMESTAMP(3),
  "valor"          DECIMAL(12,2) NOT NULL,
  "status"         TEXT     NOT NULL DEFAULT 'registrada',
  "origem"         TEXT     NOT NULL DEFAULT 'manual',
  "lancadaEstoque" BOOLEAN  NOT NULL DEFAULT false,
  "contaPagarId"   INTEGER,
  "obs"            TEXT,
  "criadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPor"      TEXT,
  CONSTRAINT "NotaEntrada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotaEntrada_chave_key" ON "NotaEntrada"("chave");
CREATE INDEX "NotaEntrada_empresaId_idx" ON "NotaEntrada"("empresaId");

ALTER TABLE "NotaEntrada"
  ADD CONSTRAINT "NotaEntrada_fornecedorId_fkey"
  FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NotaEntradaItem" (
  "id"            SERIAL   NOT NULL,
  "notaEntradaId" INTEGER  NOT NULL,
  "materialId"    INTEGER,
  "descricao"     TEXT     NOT NULL,
  "ncm"           TEXT,
  "quantidade"    DECIMAL(12,3) NOT NULL,
  "unidade"       TEXT     NOT NULL DEFAULT 'un',
  "valorUnit"     DECIMAL(12,4) NOT NULL,
  CONSTRAINT "NotaEntradaItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotaEntradaItem_notaEntradaId_idx" ON "NotaEntradaItem"("notaEntradaId");

ALTER TABLE "NotaEntradaItem"
  ADD CONSTRAINT "NotaEntradaItem_notaEntradaId_fkey"
  FOREIGN KEY ("notaEntradaId") REFERENCES "NotaEntrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
