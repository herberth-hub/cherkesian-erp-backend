-- WhatsApp robô comercial
CREATE TABLE "WhatsAppConfig" (
  "id" SERIAL NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "provedor" TEXT NOT NULL DEFAULT 'simulado',
  "token" TEXT,
  "phoneId" TEXT,
  "verifyToken" TEXT,
  "saudacao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT false,
  "soContrato" BOOLEAN NOT NULL DEFAULT true,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppConfig_empresaId_key" ON "WhatsAppConfig"("empresaId");

CREATE TABLE "WhatsAppConversa" (
  "id" SERIAL NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "telefone" TEXT NOT NULL,
  "nome" TEXT,
  "clienteId" INTEGER,
  "estado" TEXT NOT NULL DEFAULT 'bot',
  "pedidoNumero" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppConversa_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppConversa_empresaId_telefone_key" ON "WhatsAppConversa"("empresaId", "telefone");

CREATE TABLE "WhatsAppMensagem" (
  "id" SERIAL NOT NULL,
  "conversaId" INTEGER NOT NULL,
  "origem" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMensagem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsAppMensagem_conversaId_idx" ON "WhatsAppMensagem"("conversaId");
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "WhatsAppConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
