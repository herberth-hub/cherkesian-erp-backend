-- Cor escolhida no item do pedido
ALTER TABLE "PedidoItem" ADD COLUMN IF NOT EXISTS "cor" TEXT;
