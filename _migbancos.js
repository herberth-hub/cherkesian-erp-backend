const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
  const q = async (s) => p.$executeRawUnsafe(s);
  await q(`CREATE TABLE IF NOT EXISTS "RemessaBancaria" (
    "id" SERIAL PRIMARY KEY, "empresaId" INTEGER NOT NULL,
    "contaBancariaId" INTEGER NOT NULL REFERENCES "ContaBancaria"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "tipo" TEXT NOT NULL DEFAULT 'cobranca', "layout" TEXT NOT NULL DEFAULT '240', "sequencial" INTEGER NOT NULL,
    "nomeArquivo" TEXT NOT NULL, "conteudo" TEXT NOT NULL, "qtdTitulos" INTEGER NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'gerada',
    "geradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "geradaPor" TEXT, "enviadaEm" TIMESTAMP(3))`);
  await q(`CREATE INDEX IF NOT EXISTS "RemessaBancaria_empresaId_contaBancariaId_idx" ON "RemessaBancaria"("empresaId","contaBancariaId")`);
  await q(`CREATE TABLE IF NOT EXISTS "RetornoBancario" (
    "id" SERIAL PRIMARY KEY, "empresaId" INTEGER NOT NULL,
    "contaBancariaId" INTEGER NOT NULL REFERENCES "ContaBancaria"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "nomeArquivo" TEXT NOT NULL, "conteudo" TEXT NOT NULL,
    "processadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processadoPor" TEXT,
    "qtdRegistros" INTEGER NOT NULL DEFAULT 0, "qtdBaixados" INTEGER NOT NULL DEFAULT 0, "resumo" JSONB)`);
  await q(`CREATE INDEX IF NOT EXISTS "RetornoBancario_empresaId_contaBancariaId_idx" ON "RetornoBancario"("empresaId","contaBancariaId")`);
  await q(`CREATE TABLE IF NOT EXISTS "Boleto" (
    "id" SERIAL PRIMARY KEY, "empresaId" INTEGER NOT NULL,
    "contaBancariaId" INTEGER NOT NULL REFERENCES "ContaBancaria"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    "contaReceberId" INTEGER NOT NULL REFERENCES "ContaReceber"("id") ON UPDATE CASCADE ON DELETE CASCADE,
    "nossoNumero" TEXT NOT NULL, "nossoNumeroDv" TEXT, "seuNumero" TEXT,
    "valor" DECIMAL(12,2) NOT NULL, "vencimento" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'gerado',
    "linhaDigitavel" TEXT, "codigoBarras" TEXT,
    "remessaId" INTEGER REFERENCES "RemessaBancaria"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "retornoId" INTEGER REFERENCES "RetornoBancario"("id") ON UPDATE CASCADE ON DELETE SET NULL,
    "valorPago" DECIMAL(12,2), "pagoEm" TIMESTAMP(3), "ocorrencia" TEXT, "motivoRejeicao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "criadoPor" TEXT)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS "Boleto_contaBancariaId_nossoNumero_key" ON "Boleto"("contaBancariaId","nossoNumero")`);
  await q(`CREATE INDEX IF NOT EXISTS "Boleto_empresaId_status_idx" ON "Boleto"("empresaId","status")`);
  await q(`CREATE INDEX IF NOT EXISTS "Boleto_contaReceberId_idx" ON "Boleto"("contaReceberId")`);
  console.log('Tabelas Boleto / RemessaBancaria / RetornoBancario OK');
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
