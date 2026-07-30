-- Cor escolhida no pedido, propagada para a OP (corte/costura/kits)
ALTER TABLE "OP" ADD COLUMN IF NOT EXISTS "cor" TEXT;
