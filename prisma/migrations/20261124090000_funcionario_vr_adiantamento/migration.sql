-- VR e adiantamento (vale do dia 20) no cadastro do funcionário — previsão dos pagamentos do dia 5 e do dia 20.
-- IF NOT EXISTS: a migracao roda no start do servico e o deploy pode repetir.
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "valeRefeicao" DECIMAL(12,2);
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "adiantamento" DECIMAL(12,2);
