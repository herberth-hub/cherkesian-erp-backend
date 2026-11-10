-- Kit passa a ser o PACOTE que vai para uma oficina (vários tamanhos), e não mais
-- um kit por tamanho. `grade` = peças por tamanho; null = kit de um tamanho só.
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "grade" JSONB;

-- Kit absorvido na unificação aponta para o sobrevivente (a etiqueta antiga ainda acha).
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "unificadoEmId" INTEGER;

CREATE INDEX IF NOT EXISTS "Kit_unificadoEmId_idx" ON "Kit"("unificadoEmId");
