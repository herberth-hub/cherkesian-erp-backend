# Dados

| Pasta | Conteúdo | Git |
| --- | --- | --- |
| `demo-seed/` | Semente **fictícia** (clientes, pedidos, preços e política inventados e marcados `ficticio: true`) | versionada |
| `demo/` | Cópia de trabalho da demo (criada automaticamente na 1ª execução com `--base demo`; `demo restaurar` recria) | ignorada |
| `producao/` | Dados reais da HC Quality | **ignorada** — nunca versionar |

Cada base contém um arquivo JSON por entidade (`clientes.json`, `oportunidades.json`, ... — ver
`../schemas/`), além de `historico.json` (alterações com antes/depois), `logs/execucao.jsonl`
(cada comando, com segredos ocultados) e `relatorios/` (relatórios salvos com `--salvar`).

Arquivos opcionais definidos pelo responsável humano dentro da base:

- `politica_comercial.json` — política efetiva (modelo em `../config/politica_comercial.json`);
- `premissas.json` — sobrescreve as premissas operacionais de `../config/premissas.json`.

Regras: a base de produção recusa registros com `ficticio: true` e a demo recusa registros reais.
Para trocar de armazenamento (PostgreSQL do ERP, CRM externo), implemente a mesma interface de
`src/store.js` (`listar`, `obter`, `criar`, `atualizar`, `politica`, `premissas`, `auditar`).
