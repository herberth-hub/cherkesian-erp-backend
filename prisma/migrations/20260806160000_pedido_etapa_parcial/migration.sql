-- Etapa "parcial": pedido com expedição parcial (falta expedir o restante).
ALTER TYPE "PedidoEtapa" ADD VALUE IF NOT EXISTS 'parcial';
