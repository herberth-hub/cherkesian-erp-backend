-- COMODATO: peca que fica na loja do cliente para ele vender e pagar sob venda.
-- Continua sendo nosso estoque, mas fora do nosso armazem (status 'comodato').
ALTER TABLE "UnidadeEstoque" ADD COLUMN IF NOT EXISTS "comodatoClienteId" INTEGER;
ALTER TABLE "UnidadeEstoque" ADD COLUMN IF NOT EXISTS "comodatoEm" TIMESTAMP(3);
ALTER TABLE "UnidadeEstoque" ADD COLUMN IF NOT EXISTS "comodatoPor" TEXT;
CREATE INDEX IF NOT EXISTS "UnidadeEstoque_empresaId_comodatoClienteId_idx"
  ON "UnidadeEstoque"("empresaId", "comodatoClienteId");
