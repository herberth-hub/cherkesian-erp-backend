# Cherkesian ERP — Backend (Fases 0, 1 e 2 concluídas)

API REST do Cherkesian ERP. **NestJS + Prisma + PostgreSQL + JWT**.

## Fase 2 entregue (financeiro)
- **A receber / a pagar**: `/financeiro/receber` e `/financeiro/pagar` (GET/POST + `/:id/baixar`, parcial ou total). Status por vencimento (a_vencer/vencendo/vencida/pago).
- **Fluxo de caixa**: `GET /financeiro/fluxo` (realizado, projetado e buckets por vencimento).
- **Comissões**: `GET/POST /financeiro/comissoes` + `/:id/pagar`.
- **Impostos**: `GET /financeiro/impostos` (estimativa Lucro Presumido — PIS/COFINS/IRPJ/CSLL).

## Fase 1 entregue (núcleo operacional)
- **Cadastros**: `clientes`, `fornecedores`, `produtos`, `materiais` (código automático `PRD-CAT-0000`/`MP-CAT-0000`), `consumo` (BOM).
- **Vendas**: `pedidos` (orçamento→aprovar; `PV01`; cliente novo ⇒ exige piloto).
- **Produção**: `pilotos` (aprovar libera produção), `ops` (status/progresso).
- **Automação central** `POST /pedidos/:id/gerar-op`: checa piloto liberado, calcula BOM × quantidade vs `Material.saldo`; se faltar, cria `OrdemCompra` e bloqueia; senão gera a OP e baixa o saldo.
- **Compras**: `POST /ordens-compra/:id/receber` repõe o material.
- **Estoque**: `POST /estoque/movimentar` (entrada gera Lote rastreável), lotes por produto.
- **Expedição**: `POST /expedicoes` consome o lote e gera rastreio.


## Fase 0 entregue
- Projeto NestJS + TypeScript configurado.
- Prisma com `schema.prisma` completo (todas as entidades do ERP).
- **Auth**: `POST /auth/login` (bcrypt + JWT + refresh), `POST /auth/refresh`, `POST /auth/authorize-offhours`.
- **Guards globais**: `JwtAuthGuard` → `RolesGuard` (RBAC por área, SPEC §5) → `BusinessHoursGuard` (horário comercial p/ perfis não-admin).
- **Auditoria**: interceptor global grava toda escrita em `Log`.
- **Usuários**: CRUD (`/usuarios`) restrito ao perfil `total` (admin).
- **Erros** padronizados em envelope único; DTOs validados com class-validator.
- Seed inicial (empresa + 6 usuários do protótipo).
- Testes (Jest): login válido/inválido, bloqueio por horário, autorização off-hours, RBAC.

## Rodar localmente
```bash
npm install
# 1) Configure o .env (veja .env.example) — cole a DATABASE_URL do Neon
# 2) Crie o schema no banco e gere o client:
npm run prisma:migrate     # prisma migrate dev
# 3) Popular dados iniciais:
npm run seed
# 4) Subir a API:
npm run start:dev          # http://localhost:3000/api/v1
```

Health check: `GET http://localhost:3000/api/v1/health`

## Scripts
| Script | Ação |
| --- | --- |
| `npm run start:dev` | sobe em watch mode |
| `npm run build` | compila para `dist/` |
| `npm run prisma:migrate` | cria/atualiza migrations (dev) |
| `npm run prisma:deploy` | aplica migrations (produção) |
| `npm run seed` | popula empresa + usuários |
| `npm test` | testes unitários |
| `npm run prisma:studio` | abre o Prisma Studio |

## Login inicial (dev)
`admin` / `cherkesian` (perfil `total`). Demais usuários no `prisma/seed.ts`.
**Troque as senhas antes de produção.**

## RBAC (SPEC §5)
Proteção por **área** via `@Areas('...')`. O perfil `total` acessa tudo; os demais
enxergam apenas seu conjunto de áreas (ver `src/common/rbac/acesso.config.ts`).

## Notas
- Hash de senha usa `bcryptjs` (API compatível com `bcrypt`, sem dependência nativa — build limpo no Windows).
- Datas ISO-8601; valores monetários em `Decimal` no Prisma.
