-- EXTRATO BANCARIO ESPELHADO: o que o banco diz que houve, lado a lado com os
-- titulos do ERP. A unique (contaBancariaId, fitid) e a trava anti-duplicata:
-- reimportar o mesmo extrato nao faz o dinheiro aparecer duas vezes.
CREATE TABLE IF NOT EXISTS "ExtratoImportacao" (
  "id"              SERIAL PRIMARY KEY,
  "empresaId"       INTEGER NOT NULL,
  "contaBancariaId" INTEGER NOT NULL,
  "nomeArquivo"     TEXT NOT NULL,
  "formato"         TEXT NOT NULL DEFAULT 'ofx',
  "periodoIni"      TIMESTAMP(3),
  "periodoFim"      TIMESTAMP(3),
  "saldoArquivo"    DECIMAL(14,2),
  "saldoEm"         TIMESTAMP(3),
  "qtdLidos"        INTEGER NOT NULL DEFAULT 0,
  "qtdNovos"        INTEGER NOT NULL DEFAULT 0,
  "qtdDuplicados"   INTEGER NOT NULL DEFAULT 0,
  "qtdConciliados"  INTEGER NOT NULL DEFAULT 0,
  "importadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importadoPor"    TEXT
);

CREATE TABLE IF NOT EXISTS "ExtratoLancamento" (
  "id"              SERIAL PRIMARY KEY,
  "empresaId"       INTEGER NOT NULL,
  "contaBancariaId" INTEGER NOT NULL,
  "importacaoId"    INTEGER,
  "data"            TIMESTAMP(3) NOT NULL,
  "valor"           DECIMAL(14,2) NOT NULL,
  "tipo"            TEXT NOT NULL,
  "descricao"       TEXT NOT NULL,
  "documento"       TEXT,
  "fitid"           TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'pendente',
  "contaReceberId"  INTEGER,
  "contaPagarId"    INTEGER,
  "conciliadoEm"    TIMESTAMP(3),
  "conciliadoPor"   TEXT,
  "conciliadoAuto"  BOOLEAN NOT NULL DEFAULT false,
  "ignoradoMotivo"  TEXT,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "ExtratoImportacao" ADD CONSTRAINT "ExtratoImportacao_contaBancariaId_fkey"
    FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExtratoLancamento" ADD CONSTRAINT "ExtratoLancamento_contaBancariaId_fkey"
    FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExtratoLancamento" ADD CONSTRAINT "ExtratoLancamento_importacaoId_fkey"
    FOREIGN KEY ("importacaoId") REFERENCES "ExtratoImportacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExtratoLancamento_contaBancariaId_fitid_key"
  ON "ExtratoLancamento"("contaBancariaId", "fitid");
CREATE INDEX IF NOT EXISTS "ExtratoLancamento_empresaId_status_idx"
  ON "ExtratoLancamento"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "ExtratoLancamento_contaBancariaId_data_idx"
  ON "ExtratoLancamento"("contaBancariaId", "data");
CREATE INDEX IF NOT EXISTS "ExtratoImportacao_empresaId_contaBancariaId_idx"
  ON "ExtratoImportacao"("empresaId", "contaBancariaId");
