-- Parcial por tamanho: qtd expedida por tamanho
ALTER TABLE "PedidoItem" ADD COLUMN IF NOT EXISTS "gradeExpedida" JSONB;
