-- Trava por NF de retorno: fecha a remessa quando a industrialização volta.
ALTER TABLE "NotaFiscal" ADD COLUMN "retornoNf" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "retornadaEm" TIMESTAMP(3);
