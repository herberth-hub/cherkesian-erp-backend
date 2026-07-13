import { createServer } from 'node:http';
import { URL } from 'node:url';
import { cfg } from './config';
import { oauthClient, salvarToken, GOOGLE_SCOPES } from './google';

/**
 * Conecta a conta Google (Gmail + Calendar) via OAuth2.
 *
 *   npm run auth:google
 *
 * Abre um pequeno servidor local em GOOGLE_REDIRECT_URI, imprime o link de
 * consentimento; após você autorizar, o refresh_token é salvo em token.google.json.
 * Requer GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no .env (credenciais OAuth
 * "Desktop app" ou "Web" com o redirect abaixo autorizado).
 */
async function main() {
  if (!cfg.google.clientId || !cfg.google.clientSecret) {
    console.error(
      '\n❌ Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de conectar.\n' +
        '   Crie as credenciais OAuth no Google Cloud Console (APIs Gmail + Calendar habilitadas)\n' +
        `   e autorize o redirect: ${cfg.google.redirectUri}\n`,
    );
    process.exit(1);
  }

  const client = oauthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
  });

  const redirect = new URL(cfg.google.redirectUri);
  const porta = Number(redirect.port || 5555);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '', `http://localhost:${porta}`);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('Sem código de autorização.');
        return;
      }
      const { tokens } = await client.getToken(code);
      salvarToken(tokens as Record<string, unknown>);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        '<h2>✅ Conta Google conectada!</h2><p>Pode fechar esta aba e voltar ao terminal.</p>',
      );
      console.log(`\n✅ Token salvo em ${cfg.google.tokenPath}. Google conectado (Gmail + Calendar).\n`);
      server.close();
      process.exit(0);
    } catch (e) {
      res.writeHead(500).end('Erro: ' + (e instanceof Error ? e.message : String(e)));
      console.error('\n❌ Falha ao trocar o código pelo token:', e);
      server.close();
      process.exit(1);
    }
  });

  server.listen(porta, () => {
    console.log('\n🔗 Abra este link no navegador (logado como o Google do Herberth) e autorize:\n');
    console.log('   ' + authUrl + '\n');
    console.log(`Aguardando o retorno em ${cfg.google.redirectUri} ...\n`);
  });
}

main();
