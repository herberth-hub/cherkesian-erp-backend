# Deploy — Cherkesian ERP Backend (Render + Neon)

Guia passo a passo para colocar a API no ar no **Render**, usando o **Neon** (Postgres) que já configuramos.

> **Segurança:** nunca comite o arquivo `.env` (já está no `.gitignore`). Os segredos vão direto no painel do Render.

---

## 1. Subir o código para o GitHub

O repositório Git local já está criado e commitado (pasta `backend/`). Falta enviá-lo ao GitHub.

1. Crie um repositório **vazio** em https://github.com/new
   - Nome sugerido: `cherkesian-erp-backend`
   - **Não** marque "Add a README / .gitignore / license" (o repo local já tem tudo).
2. No terminal, dentro da pasta `backend/`, rode (troque `SEU-USUARIO`):
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/cherkesian-erp-backend.git
   git branch -M main
   git push -u origin main
   ```
   Na primeira vez o Git vai pedir login do GitHub (abre o navegador / Git Credential Manager).

---

## 2. Criar o serviço no Render (via Blueprint)

O arquivo `render.yaml` já descreve o serviço.

1. Acesse https://dashboard.render.com e faça login (pode usar a conta GitHub).
2. **New +** → **Blueprint**.
3. Conecte sua conta GitHub e selecione o repositório `cherkesian-erp-backend`.
4. O Render lê o `render.yaml` e mostra o serviço `cherkesian-erp-backend`. Clique **Apply**.
5. Ele vai pedir os valores das variáveis marcadas como `sync:false`. Preencha (copie do seu `.env` local):

   | Variável | Onde pegar |
   | --- | --- |
   | `DATABASE_URL` | linha `DATABASE_URL` do seu `.env` (string do Neon com `-pooler`) |
   | `DIRECT_URL` | linha `DIRECT_URL` do seu `.env` (sem `-pooler`) |
   | `JWT_SECRET` | linha `JWT_SECRET` do seu `.env` |
   | `JWT_REFRESH_SECRET` | linha `JWT_REFRESH_SECRET` do seu `.env` |

   As demais (`JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `TIMEZONE`, `NODE_ENV`) já vêm preenchidas pelo blueprint.
6. Clique **Apply/Create**. O Render vai: instalar deps → `npm run build` → `prisma migrate deploy` → subir a API.

> **Não** defina `PORT` — o Render injeta automaticamente e a app já a utiliza.

---

## 3. Verificar

Quando o deploy terminar, o Render dá uma URL tipo `https://cherkesian-erp-backend.onrender.com`.

- **Health:** abra `https://SEU-APP.onrender.com/api/v1/health` → deve responder `{"status":"ok",...}`.
- **Login:** 
  ```bash
  curl -X POST https://SEU-APP.onrender.com/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"usuario":"admin","senha":"cherkesian"}'
  ```
  Deve retornar `accessToken`.

---

## 4. Observações importantes

- **Banco compartilhado:** a API em produção aponta para o **mesmo Neon** do desenvolvimento (que já tem dados de teste). Para começar limpo, rode localmente `npx prisma migrate reset` + `npm run seed`, **ou** crie um projeto/branch Neon separado só para produção e use a `DATABASE_URL`/`DIRECT_URL` dele no Render.
- **Usuário admin:** já existe no banco (`admin` / `cherkesian`). **Troque a senha** antes do uso real (via `PATCH /usuarios/:id` autenticado como admin).
- **Plano free do Render:** o serviço "hiberna" após ~15 min sem tráfego; a primeira requisição depois disso demora ~50s (cold start). Planos pagos removem isso.
- **CORS:** quando o frontend tiver domínio, defina `CORS_ORIGIN` no Render (ex.: `https://app.cherkesian.com`) para restringir o acesso.
- **Deploys automáticos:** com `autoDeploy: true`, todo `git push` na branch `main` re-deploya sozinho.

---

## Resumo dos comandos (push inicial)
```bash
cd backend
git remote add origin https://github.com/SEU-USUARIO/cherkesian-erp-backend.git
git branch -M main
git push -u origin main
```
Depois é só o fluxo do Render (seção 2).
