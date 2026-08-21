-- Catálogo anexado ao fornecedor (arquivo base64 + nome)
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "catalogo" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "catalogoNome" TEXT;
