-- Consulta de crédito do cliente + override de liberação pelo admin.

ALTER TABLE "Cliente"
  ADD COLUMN "creditoLiberado"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "creditoLiberadoPor" TEXT,
  ADD COLUMN "creditoLiberadoEm"  TIMESTAMP(3);

CREATE TABLE "ConsultaCredito" (
  "id"            SERIAL   NOT NULL,
  "empresaId"     INTEGER  NOT NULL,
  "clienteId"     INTEGER  NOT NULL,
  "documento"     TEXT,
  "fonte"         TEXT     NOT NULL,
  "situacao"      TEXT     NOT NULL,
  "score"         INTEGER,
  "resumo"        TEXT     NOT NULL,
  "detalhe"       JSONB,
  "consultadoPor" TEXT,
  "consultadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultaCredito_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultaCredito_clienteId_idx" ON "ConsultaCredito"("clienteId");

ALTER TABLE "ConsultaCredito"
  ADD CONSTRAINT "ConsultaCredito_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
