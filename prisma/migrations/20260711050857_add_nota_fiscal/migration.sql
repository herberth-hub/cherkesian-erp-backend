-- CreateEnum
CREATE TYPE "NFeStatus" AS ENUM ('pendente', 'autorizada', 'rejeitada', 'cancelada', 'simulada');

-- CreateTable
CREATE TABLE "NotaFiscal" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "expedicaoId" INTEGER,
    "pedidoId" INTEGER,
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL DEFAULT '1',
    "chave" TEXT,
    "status" "NFeStatus" NOT NULL DEFAULT 'pendente',
    "protocolo" TEXT,
    "motivo" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'simulado',
    "emitidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitidaPor" TEXT,

    CONSTRAINT "NotaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotaFiscal_numero_key" ON "NotaFiscal"("numero");
