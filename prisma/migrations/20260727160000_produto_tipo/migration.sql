-- Tipo do produto: producao (gera OP) ou revenda (comprado p/ revender)
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "tipo" TEXT NOT NULL DEFAULT 'producao';
