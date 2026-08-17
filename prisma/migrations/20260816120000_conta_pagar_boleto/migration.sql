-- Boleto anexado ao título a pagar (arquivo em base64 + nome original)
ALTER TABLE "ContaPagar" ADD COLUMN IF NOT EXISTS "boleto" TEXT;
ALTER TABLE "ContaPagar" ADD COLUMN IF NOT EXISTS "boletoNome" TEXT;
