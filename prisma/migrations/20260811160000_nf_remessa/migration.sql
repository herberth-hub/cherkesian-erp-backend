-- NF de remessa p/ industrialização: distingue tipo e vincula à facção/controle.
ALTER TABLE "NotaFiscal" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'venda';
ALTER TABLE "NotaFiscal" ADD COLUMN "fornecedorId" INTEGER;
ALTER TABLE "NotaFiscal" ADD COLUMN "controleFaccao" TEXT;
