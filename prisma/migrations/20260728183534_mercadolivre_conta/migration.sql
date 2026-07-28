-- Integração Mercado Livre (OAuth2 + tokens por empresa)
CREATE TABLE IF NOT EXISTS "MercadoLivreConta" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "appId" TEXT,
  "appSecret" TEXT,
  "redirectUri" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpira" TIMESTAMP(3),
  "mlUserId" TEXT,
  "nickname" TEXT,
  "conectadoEm" TIMESTAMP(3),
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MercadoLivreConta_empresaId_key" ON "MercadoLivreConta"("empresaId");
