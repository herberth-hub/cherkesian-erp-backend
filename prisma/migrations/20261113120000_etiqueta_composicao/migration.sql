-- Obrigacao de imprimir a etiqueta de composicao, por OP e tamanho.
-- IF NOT EXISTS em tudo: a migracao roda no start do servico em producao e
-- precisa ser idempotente (o deploy pode repetir).

CREATE TABLE IF NOT EXISTS "EtiquetaComposicao" (
  "id"          SERIAL PRIMARY KEY,
  "empresaId"   INTEGER NOT NULL,
  "opId"        INTEGER NOT NULL,
  "tamanho"     TEXT NOT NULL,
  "devidas"     INTEGER NOT NULL DEFAULT 0,
  "impressas"   INTEGER NOT NULL DEFAULT 0,
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "impressaEm"  TIMESTAMP(3),
  "impressaPor" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "EtiquetaComposicao_opId_tamanho_key"
  ON "EtiquetaComposicao" ("opId", "tamanho");

CREATE INDEX IF NOT EXISTS "EtiquetaComposicao_empresaId_opId_idx"
  ON "EtiquetaComposicao" ("empresaId", "opId");

-- A OP apagada leva a obrigacao junto: etiqueta de ordem que nao existe mais
-- nao e pendencia de ninguem.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EtiquetaComposicao_opId_fkey'
  ) THEN
    ALTER TABLE "EtiquetaComposicao"
      ADD CONSTRAINT "EtiquetaComposicao_opId_fkey"
      FOREIGN KEY ("opId") REFERENCES "OP"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
