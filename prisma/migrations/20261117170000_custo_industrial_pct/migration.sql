-- Percentual de custo industrial escolhido a mao. NULL = usar o rateio.
-- IF NOT EXISTS: a migracao roda no start do servico e o deploy pode repetir.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "custoIndustrialPct" DECIMAL(6,2);
