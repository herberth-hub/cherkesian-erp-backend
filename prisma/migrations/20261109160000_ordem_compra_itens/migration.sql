-- VARIOS ITENS NUMA ORDEM DE COMPRA.
-- A OC nascia com um item so, entao comprar duas cores do mesmo ziper virava
-- duas ordens — dois documentos para o mesmo fornecedor, na mesma compra.
-- Com itens, os campos da OC viram o RESUMO (descricao, quantidade e valor
-- TOTAIS) e cada linha fica aqui. OC sem item nenhum continua sendo a ordem de
-- item unico de sempre: nada muda para as 60 ordens ja existentes.
CREATE TABLE IF NOT EXISTS "OrdemCompraItem" (
  "id"                  SERIAL PRIMARY KEY,
  "ordemCompraId"       INTEGER NOT NULL,
  "materialId"          INTEGER,
  "produtoId"           INTEGER,
  "descricao"           TEXT NOT NULL,
  "codigoFornecedor"    TEXT,
  "descricaoFornecedor" TEXT,
  "grade"               JSONB,
  "quantidade"          DECIMAL(12,3) NOT NULL,
  "unidade"             TEXT NOT NULL,
  "valorUnit"           DECIMAL(12,4) NOT NULL,
  "valor"               DECIMAL(12,2) NOT NULL,
  "ordem"               INTEGER NOT NULL DEFAULT 0
);

-- Apagar a ordem leva os itens junto; material/produto apagado so desvincula.
ALTER TABLE "OrdemCompraItem" DROP CONSTRAINT IF EXISTS "OrdemCompraItem_ordemCompraId_fkey";
ALTER TABLE "OrdemCompraItem" ADD CONSTRAINT "OrdemCompraItem_ordemCompraId_fkey"
  FOREIGN KEY ("ordemCompraId") REFERENCES "OrdemCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrdemCompraItem" DROP CONSTRAINT IF EXISTS "OrdemCompraItem_materialId_fkey";
ALTER TABLE "OrdemCompraItem" ADD CONSTRAINT "OrdemCompraItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrdemCompraItem" DROP CONSTRAINT IF EXISTS "OrdemCompraItem_produtoId_fkey";
ALTER TABLE "OrdemCompraItem" ADD CONSTRAINT "OrdemCompraItem_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OrdemCompraItem_ordemCompraId_idx" ON "OrdemCompraItem"("ordemCompraId");
CREATE INDEX IF NOT EXISTS "OrdemCompraItem_materialId_idx" ON "OrdemCompraItem"("materialId");
