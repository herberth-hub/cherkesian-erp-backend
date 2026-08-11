-- Pedido de bonificação: sem conta a receber; NF em remessa de bonificação.
ALTER TABLE "Pedido" ADD COLUMN "bonificacao" BOOLEAN NOT NULL DEFAULT false;
