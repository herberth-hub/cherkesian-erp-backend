# Colocar o app dos agentes no ar (Render)

App separado do ERP: endereço próprio, servidor próprio, dados próprios. O ERP continua como está.
Tudo abaixo dá para fazer pelo navegador do celular, em [dashboard.render.com](https://dashboard.render.com),
entrando com a mesma conta que publica o ERP.

| Etapa | Resultado | Precisa de |
| --- | --- | --- |
| 1. Criar o app | Painel no ar com os agentes em **modo demonstração** (dados fictícios, sem IA, custo de IA zero) | Conta do Render |
| 2. Abrir o painel | Você vê os 4 agentes trabalhando | Senha gerada pelo Render |
| 3. Ligar a IA | Agentes pensando de verdade (ainda com dados fictícios) | Chave da API do Claude |
| 4. Dados reais | Agentes trabalhando a carteira da HC | Política comercial + usuário do ERP |
| 5. Endereço próprio | `diretoria.hcqualitycorp.com.br` | Acesso ao DNS (Wix) |
| 6. E-mail e 7. WhatsApp | Cotações por e-mail e atendimento no WhatsApp | Google Cloud / Meta ou Z-API |

**Custos** (confira os valores atuais no Render e na Anthropic): instância Starter do Render (ordem de US$ 7/mês) + disco de 1 GB
(centavos/mês) + consumo da IA, limitado pelo teto diário `HC_ORCAMENTO_TOKENS_DIA` (começa em 500 mil tokens/dia).

---

## 1. Criar o app no Render

**Caminho A — Blueprint (mais rápido):**
1. **New +** → **Blueprint**.
2. Escolha o repositório **herberth-hub/cherkesian-erp-backend** (já conectado por causa do ERP).
3. Em **Blueprint Path** (caminho do arquivo), escreva: `comercial-inteligente/render.yaml`.
   O Render vai mostrar **um** serviço novo: `hc-diretoria-comercial`. Confira que ele **não** lista o ERP — se listar, o caminho está errado.
4. Quando pedir `ANTHROPIC_API_KEY`, **deixe vazio** por enquanto (o app sobe em modo demonstração).
5. **Apply** e aguarde o deploy ficar **Live** (alguns minutos).

**Caminho B — manual** (se não aparecer o campo do caminho do Blueprint):
1. **New +** → **Web Service** → repositório **herberth-hub/cherkesian-erp-backend**.
2. Preencha:
   - Name: `hc-diretoria-comercial` · Branch: `main` · Region: a mesma do ERP
   - **Root Directory: `comercial-inteligente`**
   - Runtime: Node · Build Command: `npm ci` · Start Command: `node bin/servico.js`
   - Instance Type: **Starter** (não use o Free: ele hiberna e os agentes param)
3. **Advanced**:
   - Health Check Path: `/saude`
   - **Add Disk**: Name `dados-agentes`, Mount Path `/var/data`, Size `1` GB
   - Environment Variables:

     | Chave | Valor |
     | --- | --- |
     | `NODE_VERSION` | `22` |
     | `HC_BASE` | `demo` |
     | `HC_DATA_DIR` | `/var/data/demo` |
     | `PAINEL_TOKEN` | clique em **Generate** (ou cole um texto longo e aleatório) |
     | `HC_ORCAMENTO_TOKENS_DIA` | `500000` |
4. **Create Web Service** e aguarde ficar **Live**.

## 2. Abrir o painel

1. No serviço `hc-diretoria-comercial`, abra **Environment** e copie o valor de **PAINEL_TOKEN**.
2. O endereço do app aparece no topo (algo como `https://hc-diretoria-comercial.onrender.com`). Abra:
   `https://hc-diretoria-comercial.onrender.com/?token=COLE_O_TOKEN_AQUI`
   O navegador guarda o acesso por 30 dias. No celular: **Compartilhar → Adicionar à Tela de Início**.
3. O painel mostra **"Modo simulado (sem IA) · base demo"**. Dentro do expediente (seg–sex, 06:30–22:00) as rotinas rodam sozinhas;
   para ver na hora, toque **Executar** em qualquer rotina — os agentes aparecem trabalhando nas colunas.

Não compartilhe o link com o token: quem tiver o token aprova decisões no seu nome.

## 3. Ligar a IA

1. Em [console.anthropic.com](https://console.anthropic.com) → **API Keys** → crie uma chave (ex.: "diretoria-comercial") e defina um limite de gasto mensal.
2. No Render → **Environment** → `ANTHROPIC_API_KEY` = a chave → **Save Changes** (o app reinicia sozinho).
3. O painel passa a mostrar **"IA ativa"** e o medidor de tokens. Ainda são dados fictícios: bom para conhecer o comportamento sem risco.
4. Acompanhe 1–2 dias. Se quiser mais trabalho por dia, aumente `HC_ORCAMENTO_TOKENS_DIA` (o padrão do sistema é 3.000.000).

## 4. Dados reais da HC

> Hoje esta etapa usa o **Shell** do Render (aba **Shell** do serviço, disponível em planos pagos). Se preferir fazer
> tudo pelo painel, peça a próxima melhoria: telas de **política comercial** e **importar do ERP** no próprio painel.

1. **Trocar para a base de produção** — Environment: `HC_BASE` = `producao` e `HC_DATA_DIR` = `/var/data/producao` → Save.
2. **Usuário de leitura no ERP** — no ERP, crie um usuário com perfil **comercial** (ex.: `agentes`). No Render → Environment:
   `ERP_API_URL` = `https://<endereço-do-ERP>/api/v1`, `ERP_USUARIO`, `ERP_SENHA` → Save.
3. **Política comercial** — sem ela, toda proposta cai para você decidir. No Shell, na pasta `comercial-inteligente`, crie o arquivo
   `/var/data/producao/politica_comercial.json` a partir do modelo `config/politica_comercial.json`, preenchendo margem mínima,
   alçadas (desconto, margem e valor por papel), impostos e comissão, e `"configurado": true`. (Os valores são decisão sua.)
4. **Cadastrar quem vende** (Shell, pasta `comercial-inteligente`), um comando por pessoa/agente, por exemplo:
   `node bin/hc.js registrar agente --agente humano --json '{"nome":"Fulano","papel":"vendedor","tipo":"humano","ativo":true}'`
   (cadastre também os 4 agentes de IA com `"tipo":"agente_ia"` e você com `"papel":"humano"`).
5. **Importar do ERP** (somente leitura, nada é alterado no ERP):
   `node bin/hc.js erp importar --recurso clientes --agente humano`
   `node bin/hc.js erp importar --recurso produtos --agente humano`
   `node bin/hc.js erp importar --recurso pedidos --agente humano`
   `node bin/hc.js erp importar --recurso leads --agente humano --responsavel AGT-0001` (ID de um vendedor cadastrado)
6. Confira: `node bin/hc.js validar --agente humano` deve responder `"ok": true`.

## 5. Endereço próprio (opcional)

1. Render → serviço → **Settings → Custom Domains → Add**: `diretoria.hcqualitycorp.com.br`.
2. No DNS do domínio (Wix, onde já foi feito o portal do cliente): registro **CNAME** `diretoria` apontando para o endereço que o Render indicar.
3. Quando o Render mostrar o certificado como emitido, defina `HC_URL_PUBLICA` = `https://diretoria.hcqualitycorp.com.br` (necessário para conectar o Gmail).

## 6. E-mail de cotações e 7. WhatsApp

Passo a passo completo em `comercial-inteligente/servico/README.md` (seções Fase 2 e Fase 3). Resumo:
- **E-mail:** credencial OAuth no Google Cloud (tipo Interno) → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → no painel, **Conectar** em cada caixa.
  Na caixa `herberth@`, crie um filtro no Gmail que aplique o marcador `cotacoes`.
- **WhatsApp:** decida o número (o robô do ERP e este app não podem usar o mesmo número ao mesmo tempo) → credenciais da Meta
  ou da Z-API → webhook `https://<endereço-do-app>/webhook/whatsapp`. Comece com `HC_WHATSAPP_AUTONOMIA=aprovacao`.

---

## Se algo der errado

| Sintoma | O que fazer |
| --- | --- |
| "Acesso negado" no painel | Abra de novo com `/?token=<PAINEL_TOKEN>` (o token pode ter mudado se a variável foi regenerada). |
| Agentes parados | Veja o selo no topo: fora do expediente, pausado ou orçamento de tokens do dia esgotado. |
| Deploy falhou | Render → **Logs**. Confira o Root Directory `comercial-inteligente` e o comando `npm ci`. |
| Dados sumiram após deploy | Falta o disco em `/var/data` ou `HC_DATA_DIR` não aponta para ele. |
| E-mail ou WhatsApp com erro | O painel mostra o erro na seção correspondente; os logs do Render mostram o detalhe. |
