-- Ficha técnica do produto: campos descritivos + fotos + tabela de medidas.

ALTER TABLE "Produto"
  ADD COLUMN "referencia"     TEXT,
  ADD COLUMN "marca"          TEXT,
  ADD COLUMN "linha"          TEXT,
  ADD COLUMN "grupo"          TEXT,
  ADD COLUMN "modelagem"      TEXT,
  ADD COLUMN "tecido"         TEXT,
  ADD COLUMN "composicao"     TEXT,
  ADD COLUMN "especificacoes" TEXT,
  ADD COLUMN "observacoes"    TEXT,
  ADD COLUMN "fotoModelo"     TEXT,
  ADD COLUMN "fotoModelagem"  TEXT;

CREATE TABLE "ProdutoMedida" (
  "id"         SERIAL   NOT NULL,
  "produtoId"  INTEGER  NOT NULL,
  "ordem"      INTEGER  NOT NULL DEFAULT 0,
  "descricao"  TEXT     NOT NULL,
  "tolerancia" TEXT,
  "valores"    JSONB    NOT NULL DEFAULT '{}',
  CONSTRAINT "ProdutoMedida_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProdutoMedida_produtoId_idx" ON "ProdutoMedida"("produtoId");

ALTER TABLE "ProdutoMedida"
  ADD CONSTRAINT "ProdutoMedida_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
