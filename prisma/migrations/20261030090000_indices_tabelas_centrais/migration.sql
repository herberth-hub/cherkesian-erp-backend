-- INDICES nas cinco tabelas centrais que nao tinham nenhum.
-- Medido em 29/10/2026 no pg_stat_user_tables de producao:
--   PedidoItem   12.977 varreduras,  5.604.165 linhas lidas, 899 usos de indice
--   ContaPagar   21.216 varreduras,  4.474.830 linhas lidas, 743 usos de indice
--   Cliente      55.580 varreduras,  3.532.766 linhas lidas, 1.284 usos
--   NotaFiscal    9.317 varreduras,    666.666 linhas lidas, 1.502 usos
-- CONCURRENTLY nao roda dentro de transacao e o prisma migrate envolve cada
-- migration numa; as tabelas sao pequenas (centenas de linhas), entao o lock
-- do CREATE INDEX comum dura milissegundos.

CREATE INDEX IF NOT EXISTS "PedidoItem_pedidoId_idx"  ON "PedidoItem"("pedidoId");
CREATE INDEX IF NOT EXISTS "PedidoItem_produtoId_idx" ON "PedidoItem"("produtoId");

CREATE INDEX IF NOT EXISTS "ContaPagar_empresaId_status_idx"     ON "ContaPagar"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "ContaPagar_empresaId_vencimento_idx" ON "ContaPagar"("empresaId", "vencimento");
CREATE INDEX IF NOT EXISTS "ContaPagar_fornecedorId_idx"         ON "ContaPagar"("fornecedorId");

CREATE INDEX IF NOT EXISTS "ContaReceber_empresaId_status_idx"     ON "ContaReceber"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "ContaReceber_empresaId_vencimento_idx" ON "ContaReceber"("empresaId", "vencimento");
CREATE INDEX IF NOT EXISTS "ContaReceber_clienteId_idx"            ON "ContaReceber"("clienteId");
CREATE INDEX IF NOT EXISTS "ContaReceber_pedidoId_idx"             ON "ContaReceber"("pedidoId");
CREATE INDEX IF NOT EXISTS "ContaReceber_notaFiscalId_idx"         ON "ContaReceber"("notaFiscalId");

CREATE INDEX IF NOT EXISTS "Cliente_empresaId_idx" ON "Cliente"("empresaId");

CREATE INDEX IF NOT EXISTS "NotaFiscal_empresaId_status_idx" ON "NotaFiscal"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "NotaFiscal_pedidoId_idx"         ON "NotaFiscal"("pedidoId");
CREATE INDEX IF NOT EXISTS "NotaFiscal_expedicaoId_idx"      ON "NotaFiscal"("expedicaoId");
CREATE INDEX IF NOT EXISTS "NotaFiscal_filialId_idx"         ON "NotaFiscal"("filialId");
