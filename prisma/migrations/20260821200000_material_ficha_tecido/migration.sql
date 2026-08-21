-- Ficha do tecido/artigo (etiqueta do fabricante) + vínculo com o fornecedor
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "fornecedorId" INTEGER;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "artigo" TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "codigoArtigo" TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "composicao" TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "largura" DECIMAL(6,2);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "gramatura" DECIMAL(8,2);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "gramaturaLinear" DECIMAL(8,3);
CREATE INDEX IF NOT EXISTS "Material_fornecedorId_idx" ON "Material"("fornecedorId");
