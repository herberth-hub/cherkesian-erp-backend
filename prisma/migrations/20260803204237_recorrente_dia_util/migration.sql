-- Modo de cálculo por dia útil (VT/VR): valorDia × dias úteis do mês
ALTER TABLE "ContaRecorrente" ADD COLUMN "tipoCalculo" TEXT NOT NULL DEFAULT 'fixo';
ALTER TABLE "ContaRecorrente" ADD COLUMN "valorDia" DECIMAL(12,2);
