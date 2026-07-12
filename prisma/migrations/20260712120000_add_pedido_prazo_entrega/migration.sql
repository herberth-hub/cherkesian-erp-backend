-- Prazo de entrega ao cliente (radar anti-atraso no dashboard)
ALTER TABLE "Pedido" ADD COLUMN "prazoEntrega" TIMESTAMP(3);
