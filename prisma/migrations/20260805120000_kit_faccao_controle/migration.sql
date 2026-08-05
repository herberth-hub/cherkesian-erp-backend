-- Controle automático de facção externa + lote do tecido na etiqueta
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "controleFaccao" TEXT;
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "operacaoFaccao" TEXT;
ALTER TABLE "Kit" ADD COLUMN IF NOT EXISTS "loteTecidoNf" TEXT;
