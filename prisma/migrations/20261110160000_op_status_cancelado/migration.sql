-- OP ganha o estado "cancelado": pedido cancelado derruba a OP junto.
-- Antes a OP continuava viva e a fábrica seguia com produção contratada de um
-- pedido que já não existia (ex.: PV139, 5 OPs e 62 peças).
ALTER TYPE "OPStatus" ADD VALUE IF NOT EXISTS 'cancelado';
