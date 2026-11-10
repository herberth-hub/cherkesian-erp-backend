-- Foto/desenho da peça na própria PILOTO.
-- A ficha técnica puxava a imagem só do Produto, e piloto avulsa não tem produto
-- (ele só nasce depois da aprovação): a ficha saía com a moldura vazia.
ALTER TABLE "Piloto" ADD COLUMN IF NOT EXISTS "foto" TEXT;
ALTER TABLE "Piloto" ADD COLUMN IF NOT EXISTS "fotoNome" TEXT;
