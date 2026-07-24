-- Dupla conferência + despacho na expedição
ALTER TABLE "Expedicao" ADD COLUMN "pecasConferidas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Expedicao" ADD COLUMN "conferenciaStatus" TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE "Expedicao" ADD COLUMN "conferidos" JSONB;
ALTER TABLE "Expedicao" ADD COLUMN "conferidoPor" TEXT;
ALTER TABLE "Expedicao" ADD COLUMN "conferidoEm" TIMESTAMP(3);
ALTER TABLE "Expedicao" ADD COLUMN "despachadoPor" TEXT;
ALTER TABLE "Expedicao" ADD COLUMN "dataSaida" TIMESTAMP(3);
