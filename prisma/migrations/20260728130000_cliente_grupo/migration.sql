-- Grupo de clientes (rede/matriz que agrupa várias unidades)
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS "grupo" TEXT;
