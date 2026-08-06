-- Nova etapa 'concluido' (pedido despachado / saiu para entrega)
ALTER TYPE "PedidoEtapa" ADD VALUE IF NOT EXISTS 'concluido';
