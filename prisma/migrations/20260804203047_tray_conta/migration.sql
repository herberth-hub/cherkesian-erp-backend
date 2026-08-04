-- Integração Tray (multi-loja por empresa)
CREATE TABLE "TrayConta" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "apelido" TEXT NOT NULL,
  "consumerKey" TEXT,
  "consumerSecret" TEXT,
  "apiUrl" TEXT,
  "code" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpira" TIMESTAMP(3),
  "storeId" TEXT,
  "conectadoEm" TIMESTAMP(3),
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
