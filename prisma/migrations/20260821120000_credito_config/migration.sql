-- Configuração da consulta de crédito (Serasa/parceiro) por empresa
CREATE TABLE IF NOT EXISTS "CreditoConfig" (
  "id"                SERIAL PRIMARY KEY,
  "empresaId"         INTEGER NOT NULL UNIQUE,
  "ativo"             BOOLEAN NOT NULL DEFAULT true,
  "provedor"          TEXT NOT NULL DEFAULT 'auto',
  "apiUrl"            TEXT,
  "apiToken"          TEXT,
  "authType"          TEXT NOT NULL DEFAULT 'bearer',
  "oauthTokenUrl"     TEXT,
  "oauthClientId"     TEXT,
  "oauthClientSecret" TEXT,
  "oauthScope"        TEXT,
  "scoreMin"          INTEGER NOT NULL DEFAULT 500,
  "bloqueiaPedido"    BOOLEAN NOT NULL DEFAULT true,
  "validadeDias"      INTEGER NOT NULL DEFAULT 30,
  "atualizadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoPor"     TEXT
);
