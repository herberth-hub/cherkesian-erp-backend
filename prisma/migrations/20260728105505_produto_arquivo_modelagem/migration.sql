-- Arquivo da modelagem (Audaces .adsx/.zip) arquivado no produto
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "arquivoModelagem" TEXT;
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "arquivoModelagemNome" TEXT;
