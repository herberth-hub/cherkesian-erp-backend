-- Data em que o dinheiro saiu/entrou. O titulo guardava quanto foi pago, mas
-- nao em que dia: no extrato do banco nao havia como casar o lancamento com o
-- titulo. Nulo nos titulos ja baixados antes desta migracao — ninguem sabe a
-- data deles, e inventar seria pior do que deixar em branco.
ALTER TABLE "ContaPagar"   ADD COLUMN IF NOT EXISTS "pagoEm" TIMESTAMP(3);
ALTER TABLE "ContaReceber" ADD COLUMN IF NOT EXISTS "pagoEm" TIMESTAMP(3);
