-- Juros/multa por atraso na baixa dos titulos
ALTER TABLE "ContaReceber" ADD COLUMN IF NOT EXISTS "juros" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ContaPagar" ADD COLUMN IF NOT EXISTS "juros" DECIMAL(12,2) NOT NULL DEFAULT 0;
