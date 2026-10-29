# Estrutura comum a todos os relatórios

Gerada pela CLI (`relatorio <tipo>`), sempre nesta ordem — mesmo sem dados (a seção diz "Sem dados"):

1. **Dados confirmados** — registros da base (pedidos com evidência/ERP, atividades registradas, propostas).
2. **Estimativas** — pipeline ponderado, previsões; sempre rotuladas.
3. **Premissas** — probabilidades por etapa, limites de dias, critérios de faturamento (arquivo de origem citado).
4. **Dados ausentes** — campos obrigatórios vazios, integrações não implementadas, metas não aprovadas.
5. **Recomendações** — regras determinísticas (follow-up vencido, desconto sem justificativa, risco de prazo...).
6. **Decisões pendentes de aprovação** — aprovações e solicitações abertas na alçada do leitor.

Cabeçalho: data de referência, base (DEMONSTRAÇÃO = dados fictícios), status da política comercial.

## Análise do agente
Depois do bloco gerado, o agente acrescenta `## Análise do <papel>` com interpretação, riscos e plano
de ação. Regras: não alterar números do bloco; todo número novo indica a fonte (comando) ou é
rotulado como estimativa com premissa; nada de dados externos não verificados.

`--salvar` grava em `data/<base>/relatorios/<tipo>-<data>.md`. `--formato json` devolve as seções estruturadas.
