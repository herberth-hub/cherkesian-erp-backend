# Orquestração dos agentes no Claude Code

## Como funciona de verdade

- Os quatro agentes são **subagentes nativos** (`.claude/agents/hc-*.md`), acionados pela sessão
  principal do Claude Code com a ferramenta Agent (`subagent_type: hc-ceo`, `hc-diretor-comercial`,
  `hc-gerente-comercial`, `hc-vendedor-comercial`) ou pedindo em linguagem natural
  ("use o agente hc-gerente-comercial para...").
- **Subagentes não acionam outros subagentes** no Claude Code. Por isso a delegação é **mediada**:
  1. o agente registra a solicitação na CLI (fila `solicitacoes.json`, com regras de hierarquia aplicadas por código);
  2. retorna ao orquestrador indicando o "próximo agente a acionar";
  3. a sessão principal (orquestrador) aciona esse agente, passando os IDs das solicitações.
- A execução é **sequencial**. Nada é executado em paralelo nesta implementação, e nenhum relatório deve afirmar o contrário.

## Regras do orquestrador (sessão principal)

1. Leia `comercial-inteligente/CLAUDE.md`.
2. Antes de cada acionamento: `node comercial-inteligente/bin/hc.js solicitacao listar --todas --agente <papel do próximo agente> [--base demo]` para saber o que está pendente.
3. Passe ao subagente: a base (`demo` ou `producao`), a data de referência, os IDs pendentes e o objetivo.
4. Após o retorno, confira na CLI o que foi efetivamente registrado (não confie só no texto do agente).
5. **Limite: no máximo 8 acionamentos de subagente por comando.** Se ainda houver pendências, pare e
   apresente ao humano o estado da fila. Nunca acione o mesmo agente duas vezes seguidas para a mesma solicitação sem fato novo.
6. Solicitação para `humano`: apresente ao usuário a decisão necessária (com alternativas e impactos que o CEO preparou).
   Somente com a resposta explícita do usuário execute `--agente humano` (o Claude Code pedirá permissão — regra `ask` em `.claude/settings.json`).
7. Não use `--agente humano` por iniciativa própria, nem para "destravar" fluxo.

## Sequências padrão

| Demanda | Sequência |
| --- | --- |
| Meta mensal | CEO (propõe) → humano (aprova) → Diretor (desdobra) → Gerente (desdobra por vendedor e cria tarefas) |
| Proposta fora da alçada | Vendedor (solicita aprovação, escala) → Gerente (decide ou escala) → Diretor → CEO → humano |
| Relatório executivo | Diretor (relatório semanal + análise) → CEO (relatório executivo, recebendo o resumo do diretor) |
| Rotina diária | Vendedor(es) (relatório por responsável) → Gerente (consolida, cobra, prioriza) |
