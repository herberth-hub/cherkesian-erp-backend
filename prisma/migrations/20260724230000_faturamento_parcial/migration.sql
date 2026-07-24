-- Faturamento/expedição parcial
ALTER TABLE "PedidoItem" ADD COLUMN IF NOT EXISTS "quantidadeExpedida" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Expedicao" ADD COLUMN IF NOT EXISTS "parcial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Expedicao" ADD COLUMN IF NOT EXISTS "itens" JSONB;

