-- Contas recorrentes (aluguel, luz, água, internet...) + vínculo no título gerado
ALTER TABLE "ContaPagar" ADD COLUMN "recorrenteId" INTEGER;

CREATE TABLE "ContaRecorrente" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "filialId" INTEGER,
  "fornecedorId" INTEGER,
  "categoria" TEXT NOT NULL,
  "descricao" TEXT,
  "valor" DECIMAL(12,2) NOT NULL,
  "diaVencimento" INTEGER NOT NULL,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
