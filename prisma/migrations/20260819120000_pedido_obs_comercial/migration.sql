-- Observação COMERCIAL do pedido: sai na proposta e no pedido (PDF).
-- A coluna "obs" continua sendo a observação FISCAL (informações complementares da NF-e).
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "obsComercial" TEXT;
