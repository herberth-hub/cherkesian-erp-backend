-- Cadastro de transportadoras (dados do quadro TRANSPORTADOR do DANFE)
CREATE TABLE IF NOT EXISTS "Transportadora" (
  "id"                SERIAL PRIMARY KEY,
  "empresaId"         INTEGER NOT NULL,
  "nome"              TEXT NOT NULL,
  "cnpjCpf"           TEXT,
  "inscricaoEstadual" TEXT,
  "telefone"          TEXT,
  "logradouro"        TEXT,
  "numeroEndereco"    TEXT,
  "bairro"            TEXT,
  "municipio"         TEXT,
  "uf"                TEXT,
  "cep"               TEXT,
  "placaVeiculo"      TEXT,
  "ufVeiculo"         TEXT,
  "rntc"              TEXT,
  "ativa"             BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Transportadora_empresaId_idx" ON "Transportadora"("empresaId");
