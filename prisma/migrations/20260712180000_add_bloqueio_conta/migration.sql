-- Bloqueio de conta apos tentativas de login malsucedidas
ALTER TABLE "Usuario" ADD COLUMN "tentativasFalhas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Usuario" ADD COLUMN "bloqueado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Usuario" ADD COLUMN "bloqueadoEm" TIMESTAMP(3);
