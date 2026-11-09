-- Setores da producao que o usuario pode MOVIMENTAR na OP.
-- Vazio = sem limite (como todo mundo sempre trabalhou): a trava e opt-in,
-- o administrador marca pessoa por pessoa. Por isso o default e um array vazio
-- e nenhum usuario existente muda de comportamento com esta migracao.
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "setoresOp" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
