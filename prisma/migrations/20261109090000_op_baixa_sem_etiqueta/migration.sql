-- BAIXA SEM ETIQUETA na ordem de producao.
-- OP que ficou aberta no sistema (producao/acabamento) mas cuja peca JA FOI
-- ENTREGUE ao cliente: etiquetar agora criaria peca no estoque que nao existe na
-- prateleira (duplicidade). A ordem fecha sem etiqueta e fica marcada como tal.
ALTER TABLE "OP" ADD COLUMN IF NOT EXISTS "baixaSemEtiqueta" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OP" ADD COLUMN IF NOT EXISTS "baixaMotivo" TEXT;
