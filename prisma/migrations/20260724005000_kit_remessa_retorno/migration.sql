-- NF de remessa/retorno no kit (trava por NF de retorno)
ALTER TABLE "Kit" ADD COLUMN "remessaNfNumero" TEXT;
ALTER TABLE "Kit" ADD COLUMN "retornoNfNumero" TEXT;
