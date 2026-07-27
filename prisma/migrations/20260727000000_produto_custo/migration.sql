-- Custo unitário do produto (revenda: preço de compra; produção: custo direto)
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "custo" DECIMAL(12,2);
