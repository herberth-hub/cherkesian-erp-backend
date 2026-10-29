# Serviço autônomo — fase 1

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

## Implantação (Render ou outro servidor)

1. Serviço web Node com comando `npm install --prefix comercial-inteligente && node comercial-inteligente/bin/servico.js`.
2. **Plano sempre ligado** (no Render, o gratuito hiberna e os agentes param).
3. **Disco persistente** montado em `HC_DATA_DIR` — sem ele, os dados somem a cada novo deploy.
4. Defina `PAINEL_TOKEN`, `ANTHROPIC_API_KEY`, `HC_BASE=producao`, `HC_DATA_DIR=/caminho/do/disco`.
5. Antes de ligar o modo `claude`, configure a política comercial e importe os dados do ERP (README principal, "Ativação em produção").

O `render.yaml` do ERP **não foi alterado** (ele publica o ERP a cada push na `main`); o serviço é um deploy separado, que você decide criar.

## Limitações desta fase
- **Sem e-mail e sem WhatsApp** (fases 2 e 3): os agentes ainda não falam com clientes; preparam rascunhos como atividades no CRM.
- **Não testado com a API real nesta entrega**: o loop foi testado com um cliente simulado que reproduz o formato da API; a primeira execução com `ANTHROPIC_API_KEY` deve ser acompanhada pelo painel.
- Armazenamento em arquivos JSON: um único processo do serviço por base (não rode duas instâncias apontando para o mesmo diretório).
- O painel é protegido por token único (sem usuários individuais). Para mais de um aprovador, a fase seguinte deve usar o login do ERP.
