-- Unidades/filiais dentro de um cliente (organização + destinatário da NF quando têm CNPJ próprio).
CREATE TABLE "ClienteUnidade" (
  "id" SERIAL PRIMARY KEY,
  "clienteId" INTEGER NOT NULL,
  "nome" TEXT NOT NULL,
  "cnpjCpf" TEXT,
  "inscricaoEstadual" TEXT,
  "indicadorIE" INTEGER,
  "logradouro" TEXT,
  "numeroEndereco" TEXT,
  "bairro" TEXT,
  "municipio" TEXT,
  "codMunicipio" TEXT,
  "uf" TEXT,
  "cep" TEXT,
  "email" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClienteUnidade_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ClienteUnidade_clienteId_idx" ON "ClienteUnidade"("clienteId");

ALTER TABLE "Pedido" ADD COLUMN "clienteUnidadeId" INTEGER;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteUnidadeId_fkey" FOREIGN KEY ("clienteUnidadeId") REFERENCES "ClienteUnidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
