# Workflow — Qualificação

**Dono:** Vendedor · Revisão: Gerente

## Checklist (campos de `oportunidade.qualificacao`)
| Campo | Pergunta |
| --- | --- |
| `quantidadePecas` | Quantas peças por pedido / por ano? |
| `tipoUniforme` | Quais peças (privativo, jaleco, polo, calça, macacão...)? |
| `tecido` / `grade` | Há especificação de tecido? Qual a grade de tamanhos? |
| `frequenciaReposicao` | Com que frequência repõe? |
| `personalizacao` | Bordado, silk, DTF, etiqueta, cor por setor? |
| `prazoPretendido` | Para quando precisa? |
| `localEntrega` | Onde entregar (uma ou várias unidades)? |
| `faixaOrcamento` | Só se informada voluntariamente pelo cliente. |
| `processoDecisao` | Quem especifica, quem aprova, quem compra? |
| `exigeAmostra` | Exige amostra/piloto? |

Dados do cliente: razão social, CNPJ (quando necessário e legitimamente disponível), segmento, contato
profissional do comprador (`registrar contato`).

## Regras
- Não informado = `null`. Nunca preencher por suposição.
- Para avançar para `cotacao_solicitada`, `pipeline dados-ausentes` não pode apontar faltas de qualificação.
- Lead qualificado: `atualizar lead --id LEA-... --json '{"status":"qualificado"}'`.
- Desqualificado: `{"status":"descartado","motivoDescarte":"..."}`.

## Saída
Oportunidade com qualificação completa ou lista de pendências + próximo passo para obtê-las.
