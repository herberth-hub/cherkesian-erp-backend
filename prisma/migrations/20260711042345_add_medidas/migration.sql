-- CreateTable
CREATE TABLE "Medida" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "colaborador" TEXT NOT NULL,
    "cargo" TEXT,
    "tamanho" TEXT NOT NULL,
    "torax" DECIMAL(6,2),
    "cintura" DECIMAL(6,2),
    "quadril" DECIMAL(6,2),
    "altura" DECIMAL(6,2),
    "obs" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medida_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Medida" ADD CONSTRAINT "Medida_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
