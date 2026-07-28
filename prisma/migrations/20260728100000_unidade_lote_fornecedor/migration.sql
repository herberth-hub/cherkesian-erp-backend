-- Lote/partida do tecido informado pelo fornecedor (rastreio produto/lote)
ALTER TABLE "UnidadeEstoque" ADD COLUMN IF NOT EXISTS "loteFornecedor" TEXT;
