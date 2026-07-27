// Service worker mínimo do Cherkesian ERP.
// Rede-primeiro (network-only) para NUNCA servir versão velha do app — o sistema
// é atualizado com frequência. Serve só para tornar o app instalável no celular.
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* deixa o navegador buscar da rede normalmente */ });
