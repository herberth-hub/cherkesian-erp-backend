# Colocar o app dos agentes no ar (Render)

App separado do ERP: endereço próprio, servidor próprio, dados próprios. O ERP continua como está.
Tudo abaixo dá para fazer pelo navegador do celular, em [dashboard.render.com](https://dashboard.render.com),
entrando com a mesma conta que publica o ERP.

| Etapa | Resultado | Precisa de |
| --- | --- | --- |
| 1. Criar o app | Painel no ar com os agentes em **modo demonstração** (dados fictícios, sem IA, custo de IA zero) | Conta do Render |
| 2. Abrir o painel | Você vê os 5 agentes trabalhando | Senha gerada pelo Render |
| 3. Ligar a IA | Agentes pensando de verdade (ainda com dados fictícios) | Chave da API do Claude |
| 4. Dados reais | Agentes trabalhando a carteira da HC (tudo pelo painel) | Política comercial + usuário do ERP |
| 5. Endereço próprio | `diretoria.hcqualitycorp.com.br` | Acesso ao DNS (Wix) |
| 6. E-mail e 7. WhatsApp | Cotações por e-mail e atendimento no WhatsApp | Google Cloud / Meta ou Z-API |

**Custos** (confira os valores atuais no Render e na Anthropic): instância Starter do Render (ordem de US$ 7/mês) + disco de 1 GB
(centavos/mês) + consumo da IA, limitado pelo teto diário em dólares `HC_ORCAMENTO_USD_DIA` (padrão US$ 5/dia; o painel mostra o gasto do dia).

---

## 1. Criar o app no Render

**Caminho A — Blueprint (mais rápido):**
1. **New +** → **Blueprint**.
2. Escolha o repositório **herberth-hub/cherkesian-erp-backend** (já conectado por causa do ERP).
3. Em **Blueprint Path** (caminho do arquivo), escreva: `comercial-inteligente/render.yaml`.
   O Render vai mostrar **um** serviço novo: `hc-diretoria-comercial`. Confira que ele **não** lista o ERP — se listar, o caminho está errado.
4. Preencha o que o Render pedir: `HC_BASE` = `demo`, `HC_DATA_DIR` = `/var/data/demo`, `PAINEL_TOKEN` = uma senha sua
   (texto longo, só letras e números, mínimo 16 caracteres) e `ANTHROPIC_API_KEY` **vazio** por enquanto (o app sobe em modo demonstração).
   Esses valores ficam sob seu controle: atualizações do Blueprint não os sobrescrevem.
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
     | `PAINEL_TOKEN` | uma senha sua: texto longo, só letras e números (mín. 16) |
     | `HC_ORCAMENTO_USD_DIA` | `5` |
     | `HC_ORCAMENTO_TOKENS_DIA` | `2000000` |
4. **Create Web Service** e aguarde ficar **Live**.

## 2. Abrir o painel

1. Abra o endereço do app (aparece no topo do serviço, algo como `https://hc-diretoria-comercial.onrender.com`).
2. Na tela de entrada, cole o **PAINEL_TOKEN** (Render → Environment) e toque **Entrar**.
   O navegador guarda o acesso por 30 dias. No celular: **Compartilhar → Adicionar à Tela de Início**.
3. O painel mostra **"Modo simulado (sem IA) · base demo"**. Dentro do expediente (seg–sex, 06:30–22:00) as rotinas rodam sozinhas;
   para ver na hora, toque **Executar** em qualquer rotina — os agentes aparecem trabalhando nas colunas.

Não compartilhe o link com o token: quem tiver o token aprova decisões no seu nome.

## 3. Ligar a IA

1. Em [console.anthropic.com](https://console.anthropic.com) → **API Keys** → crie uma chave (ex.: "diretoria-comercial") e defina um limite de gasto mensal.
2. No Render → **Environment** → `ANTHROPIC_API_KEY` = a chave → **Save Changes** (o app reinicia sozinho).
3. O painel passa a mostrar **"IA ativa"** e o gasto do dia em US$. Ainda são dados fictícios: bom para conhecer o comportamento sem risco.
4. Acompanhe 1–2 dias. Para permitir mais trabalho por dia, aumente `HC_ORCAMENTO_USD_DIA`.

## 4. Dados reais da HC

Tudo pelo painel, no botão **Configurar** (topo da tela):

1. **Trocar para a base de produção** — no Render → Environment: `HC_BASE` = `producao` e `HC_DATA_DIR` = `/var/data/producao` → Save.
   (O painel deixa de mostrar o aviso "dados fictícios".)
2. **Usuário de leitura no ERP** — no ERP, crie um usuário com perfil **comercial** (ex.: `agentes`). No Render → Environment:
   `ERP_API_URL` = `https://<endereço-do-ERP>/api/v1`, `ERP_USUARIO`, `ERP_SENHA` → Save.
3. **Configurar → Política comercial** — preencha margem mínima geral, impostos, comissão, validade e as alçadas
   (desconto máximo, margem mínima e valor máximo por nível), marque **Política ativa** e toque **Salvar política**.
   O painel recusa combinações incoerentes (ex.: vendedor com mais desconto que o gerente) e explica o motivo.
   Os valores são decisão sua; enquanto a política estiver desligada, toda proposta vem para você.
4. **Configurar → Equipe** — cadastre os vendedores (pessoas), os 5 agentes de IA (tipo "Agente de IA") e você
   (papel "Responsável humano").
5. **Configurar → Importar do ERP** — toque, nesta ordem: **Importar clientes**, **Importar produtos**, **Importar pedidos**;
   depois escolha o vendedor responsável e toque **Importar leads**. É só leitura: nada muda no ERP, e reimportar atualiza sem duplicar.
6. **Configurar → Saúde da base** deve mostrar "Todos os registros válidos".
7. A partir daí a **importação é automática**: todo dia útil às 06:00 o app reimporta tudo do ERP (sem duplicar) antes de os agentes
   começarem. O resultado aparece em **Configurar → Importar do ERP → Importação automática**, com o botão **Sincronizar agora**.

> Alternativa por linha de comando (Shell do Render, pasta `comercial-inteligente`): `node bin/hc.js politica definir --agente humano --json '{...}'`,
> `node bin/hc.js registrar agente --agente humano --json '{...}'`, `node bin/hc.js erp importar --recurso clientes --agente humano` e
> `node bin/hc.js validar --agente humano`.

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
| Agentes parados | Veja o selo no topo: fora do expediente, pausado ou teto de gasto do dia (US$) atingido. |
| Deploy falhou | Render → **Logs**. Confira o Root Directory `comercial-inteligente` e o comando `npm ci`. |
| Dados sumiram após deploy | Falta o disco em `/var/data` ou `HC_DATA_DIR` não aponta para ele. |
| E-mail ou WhatsApp com erro | O painel mostra o erro na seção correspondente; os logs do Render mostram o detalhe. |
