# Serviço autônomo — fases 1 e 2

Os quatro agentes (CEO, Diretor, Gerente, Vendedor) rodando **sozinhos e em paralelo**, de
**segunda a sexta, das 06:30 às 22:00 (horário de São Paulo)**, com um **painel visual** para
acompanhar o trabalho ao vivo, pausar agentes e tomar as decisões que são suas.

```
node comercial-inteligente/bin/servico.js          # produção (base data/producao)
npm run servico:demo                                # demonstração: base fictícia, sem IA
```

Abra `http://<servidor>:<porta>/?token=<PAINEL_TOKEN>` uma vez; o navegador guarda o acesso por 30 dias.

## Como funciona

| Peça | Arquivo | O que faz |
| --- | --- | --- |
| Orquestrador | `orquestrador.js` | Uma fila por agente. Agentes diferentes trabalham ao mesmo tempo; o vendedor atende até 3 frentes simultâneas (configurável). |
| Expediente | `horario.js` | Fora de seg–sex 06:30–22:00 nenhum trabalho começa; o que estiver em andamento para na próxima verificação. |
| Rotinas | `rotinas.js` | 06:30 abertura do vendedor · 06:45 reunião diária do gerente · 09:00 riscos e aprovações do diretor · a cada 2 h ronda de follow-up · 18:00 fechamento do gerente · sexta 17:00 relatório semanal do diretor · sexta 18:00 relatório executivo do CEO. |
| Fila automática | `orquestrador.js` | Sem ninguém acionar: escalonamento do vendedor vira trabalho do gerente; decisão que volta retoma quem pediu; tarefa atribuída é executada; entrega é verificada por quem atribuiu; pedido de informação vai para quem solicitou. |
| Agente | `agente.js` | Loop com a API do Claude (SDK oficial, modelo `claude-opus-5-5`, raciocínio adaptativo, cache do prompt de sistema, fallback automático do servidor em caso de recusa). |
| Ferramenta | `ferramentas.js` | A única ferramenta dos agentes é a CLI comercial; o servidor impõe papel e base — nenhum agente age como outro, nem como humano, nem roda `erp`/`demo`. |
| Painel | `servidor.js`, `painel.html` | 4 colunas ao vivo (status, trabalho atual, fila, cada comando executado e as notas do agente), "Aguardando você", fluxo de solicitações, tarefas, rotinas com "Executar agora", pausa por agente ou geral. |

### O que só você decide (pelo painel)
Aprovações na alçada `humano` (ex.: margem abaixo da mínima), escalonamentos que chegam ao humano,
respostas a pedidos de informação feitos a você e aprovação da meta geral proposta pelo CEO.
Toda decisão exige justificativa e fica no histórico.

### Proteções de custo e de loop
- **Orçamento diário de tokens** (`HC_ORCAMENTO_TOKENS_DIA`, padrão 3.000.000): atingido, nenhum trabalho novo começa até o dia seguinte; o painel mostra o consumo.
- **Máximo de trabalhos por hora por agente** (padrão 20) e **de iterações por trabalho** (padrão 12).
- **Nada é reprocessado sem mudança no registro**, e cada registro tem no máximo 4 trabalhos por dia; depois o painel avisa e o item fica para você.
- Referência de preço do modelo (Opus 5.5): US$ 4 por milhão de tokens de entrada, US$ 20 de saída, US$ 0,20 em leitura de cache. Com o orçamento padrão, o teto teórico diário fica entre ~US$ 12 (tudo entrada) e US$ 60 (tudo saída); o consumo real aparece no painel e deve ser acompanhado nas primeiras semanas.

## Fase 2 — cotações por e-mail

A cada 5 minutos, dentro do expediente, o serviço verifica as caixas configuradas. Cada e-mail novo vira
um trabalho do **vendedor**, que:

1. classifica (pedido de cotação, cliente atual ou não comercial — este último é ignorado);
2. confere se o cliente/lead já existe e registra lead, oportunidade e atividade **só com o que o e-mail informa**;
3. lê anexos **PDF e imagens** (até 3 por e-mail); planilhas e outros formatos aparecem só pelo nome;
4. escala ao gerente reclamações, clientes estratégicos e o que fugir da alçada;
5. cria **um rascunho de resposta** no próprio Gmail, na mesma conversa, para o remetente original,
   pedindo o que falta (quantidades, grade, cores, tecido, logotipo, prazo, local, CNPJ) — **sem preço, prazo ou certificação**.

**O agente nunca envia.** Você abre o rascunho (link no painel, em "Rascunhos para você revisar e enviar"), ajusta e envia.
O destinatário é sempre o remetente do e-mail original (definido pelo servidor, não pelo agente).
O conteúdo dos e-mails é tratado como dado de terceiros: instruções escritas no e-mail são ignoradas.

| Caixa | O que o agente lê |
| --- | --- |
| `contato@hcqualitycorp.com.br` | Caixa de entrada dos últimos 4 dias, exceto promoções e redes sociais. |
| `herberth@hcqualitycorp.com.br` | **Só e-mails com o marcador `cotacoes`** (caixa pessoal: o resto não é lido). Crie no Gmail um filtro que aplique esse marcador (ex.: assunto contém "cotação" ou "orçamento") ou marque manualmente. |

Cada e-mail é tratado uma vez (controle em `servico-email.json`); com falha, até 3 tentativas e depois aviso no painel.

### Configurar (uma vez)
1. **Google Cloud Console** (projeto da HC, conta do Workspace):
   - ative a **Gmail API**;
   - tela de consentimento OAuth do tipo **Interno** (só usuários `@hcqualitycorp.com.br`; dispensa verificação do Google);
   - crie uma credencial **ID do cliente OAuth → Aplicativo da Web** com o URI de redirecionamento
     `https://<endereço-do-painel>/oauth/gmail/retorno`.
   - Pode reaproveitar o projeto do Agente Secretário, acrescentando esse redirecionamento.
2. No servidor: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `HC_URL_PUBLICA=https://<endereço-do-painel>`.
3. No painel, em **E-mail de cotações**, toque em **Conectar** em cada caixa e entre com **a própria conta** daquela caixa
   (o serviço confere: autorizar com outra conta é recusado).
4. Permissões pedidas: `gmail.readonly` (ler) e `gmail.compose` (criar rascunhos). O Google não tem uma permissão
   "só rascunho"; `compose` também permitiria enviar, mas o código do serviço não tem nenhuma função de envio (há teste que garante).
   Os tokens ficam em `segredos/` dentro da pasta de dados, com permissão restrita, e nunca aparecem no painel ou nos logs.

## Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PAINEL_TOKEN` | — (**obrigatório em produção**, mín. 16 caracteres) | Acesso ao painel. Sem ele, um token temporário é gerado e impresso no console. |
| `ANTHROPIC_API_KEY` | — | Liga o modo `claude`. Sem a chave, o serviço roda em modo `simulado`. |
| `HC_MODO` | automático | `claude` ou `simulado` (rotinas com comandos fixos, sem IA). |
| `HC_BASE` / `HC_DATA_DIR` | `producao` / `data/<base>` | Base de dados; em servidor, aponte `HC_DATA_DIR` para um **disco persistente**. |
| `PORT` | `3100` | Porta HTTP. |
| `HC_HORARIO` / `HC_DIAS` / `HC_FUSO` | `06:30-22:00` / `1,2,3,4,5` / `America/Sao_Paulo` | Expediente. |
| `HC_MODELO` / `HC_ESFORCO` | `claude-opus-5-5` / `medium` | Modelo e esforço de raciocínio (`low`…`max`). |
| `HC_FALLBACKS` | ligado | `off` desliga o fallback automático do servidor em recusas. |
| `HC_ORCAMENTO_TOKENS_DIA`, `HC_MAX_TAREFAS_HORA`, `HC_MAX_ITERACOES` | 3000000, 20, 12 | Limites. |
| `HC_PARALELO_CEO/DIRETOR/GERENTE/VENDEDOR` | 1/1/1/3 | Trabalhos simultâneos por agente. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Credencial OAuth do Google (fase 2). |
| `HC_URL_PUBLICA` | — | Endereço público do painel (para o retorno do login Google). |
| `HC_GMAIL_CONTAS` | `contato@…,herberth@…` | Caixas lidas. |
| `HC_GMAIL_CONSULTA_<CAIXA>` | ver tabela acima | Filtro de busca do Gmail por caixa (ex.: `HC_GMAIL_CONSULTA_HERBERTH`). |
| `HC_GMAIL_INTERVALO_MIN` | `5` | Intervalo de verificação. |
| `GMAIL_TOKEN_<CAIXA>` | — | Alternativa ao botão Conectar: refresh token por variável de ambiente. |

## Implantação (Render ou outro servidor)

1. Serviço web Node com comando `npm install --prefix comercial-inteligente && node comercial-inteligente/bin/servico.js`.
2. **Plano sempre ligado** (no Render, o gratuito hiberna e os agentes param).
3. **Disco persistente** montado em `HC_DATA_DIR` — sem ele, os dados somem a cada novo deploy.
4. Defina `PAINEL_TOKEN`, `ANTHROPIC_API_KEY`, `HC_BASE=producao`, `HC_DATA_DIR=/caminho/do/disco`.
5. Antes de ligar o modo `claude`, configure a política comercial e importe os dados do ERP (README principal, "Ativação em produção").

O `render.yaml` do ERP **não foi alterado** (ele publica o ERP a cada push na `main`); o serviço é um deploy separado, que você decide criar.

## Limitações desta fase
- **Sem WhatsApp** (fase 3). No e-mail, os agentes só criam rascunhos; o envio é sempre humano.
- **E-mail não testado contra o Gmail real nesta entrega**: a integração foi testada com um Gmail simulado no formato da API; conecte primeiro a `contato@` e acompanhe os primeiros rascunhos.
- **Não testado com a API real nesta entrega**: o loop foi testado com um cliente simulado que reproduz o formato da API; a primeira execução com `ANTHROPIC_API_KEY` deve ser acompanhada pelo painel.
- Armazenamento em arquivos JSON: um único processo do serviço por base (não rode duas instâncias apontando para o mesmo diretório).
- O painel é protegido por token único (sem usuários individuais). Para mais de um aprovador, a fase seguinte deve usar o login do ERP.
