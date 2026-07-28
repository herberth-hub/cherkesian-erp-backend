-- Flag: etiquetas de volume (rolos) já emitidas para a NF de entrada
ALTER TABLE "NotaEntrada" ADD COLUMN IF NOT EXISTS "etiquetasGeradas" BOOLEAN NOT NULL DEFAULT false;
