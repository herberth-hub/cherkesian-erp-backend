-- Andar passa a aceitar letras (matéria-prima: A/B/C) além de 0..4
ALTER TABLE "UnidadeEstoque" ALTER COLUMN "andar" TYPE TEXT USING "andar"::text;
