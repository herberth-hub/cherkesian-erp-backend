-- O que a faccao cobra para costurar UMA peca deste produto.
-- IF NOT EXISTS: a migracao roda no start do servico em producao e o deploy
-- pode repetir.
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "custoFaccao" DECIMAL(12,2);
