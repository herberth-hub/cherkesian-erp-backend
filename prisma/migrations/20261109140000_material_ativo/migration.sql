-- MATERIAL INATIVO: cadastro velho ou duplicado que nao se compra mais.
-- Continua existindo (nota, receita e OC antigas apontam para ele), mas some das
-- buscas que OFERECEM material, para ninguem escolher por engano.
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "Material_empresaId_ativo_idx" ON "Material"("empresaId", "ativo");
