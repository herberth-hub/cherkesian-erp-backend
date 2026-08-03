-- Banco/conta de onde saiu o pagamento (registrado na baixa)
ALTER TABLE "ContaPagar" ADD COLUMN "bancoPagto" TEXT;
