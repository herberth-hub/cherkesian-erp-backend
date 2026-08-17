-- Contas bancárias estruturadas por empresa/filial (várias por CNPJ)
CREATE TABLE IF NOT EXISTS "ContaBancaria" (
  "id"        SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "filialId"  INTEGER NOT NULL,
  "banco"     TEXT NOT NULL,
  "agencia"   TEXT,
  "conta"     TEXT,
  "tipo"      TEXT NOT NULL DEFAULT 'corrente',
  "pixChave"  TEXT,
  "apelido"   TEXT,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  "ativa"     BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContaBancaria_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ContaBancaria_empresaId_idx" ON "ContaBancaria"("empresaId");
CREATE INDEX IF NOT EXISTS "ContaBancaria_filialId_idx" ON "ContaBancaria"("filialId");
