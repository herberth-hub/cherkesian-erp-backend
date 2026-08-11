-- Produção parcial: produz o que o estoque cobre e mantém a OC do restante.
ALTER TABLE "Pedido" ADD COLUMN "producaoParcial" BOOLEAN NOT NULL DEFAULT false;
