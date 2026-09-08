# Planner do Líder — API

> Backend do [Planner do Líder](https://planner.institutodalideranca.com.br): autenticação de líderes e liderados, e todos os dados do quadro (liderados, Kanban, metas, diário de bordo, dashboard) num banco Postgres real — em vez de localStorage.

---

## Por que isso existe

O site (`planner.institutodalideranca.com.br`, hospedado no GitHub Pages) é estático — não roda código no servidor. Pra um liderado poder logar com a própria conta e ver seus dados de qualquer aparelho, os dados precisam morar num banco de verdade, e o login precisa ser validado num servidor de verdade. É isso que esta API faz.

- **Banco:** Postgres no [Neon](https://neon.tech) (plano gratuito, serverless — mesmo provedor usado no CRM, mas um projeto novo e isolado).
- **Servidor:** Node/Express, hospedado no [Render](https://render.com) (mesmo host do backend do CRM).
- **Autenticação:** e-mail + senha, com JWT (token) — cada líder tem seu workspace; cada liderado enxerga só o que é dele.

---

## Papéis

| Papel | O que enxerga |
|---|---|
| **Líder** | Tudo do seu workspace: cadastro de liderados, quadro Kanban completo, metas, diário de bordo de todos (individual e visão da equipe), dashboard de gestão do tempo. |
| **Liderado** | Só o que é seu: as próprias atividades atribuídas, as metas vinculadas a elas, e os **feedbacks formais** que recebeu (nunca as observações do dia a dia nem os apontamentos de risco psicossocial que o líder registra — isso continua privado, só do líder). |

---

## Estrutura

```
planner-lider-api/
├── src/
│   ├── app.js              # monta o Express (rotas, cors, error handler)
│   ├── server.js           # ponto de entrada — sobe o app na porta do Render
│   ├── db.js                # pool de conexão com o Postgres (Neon)
│   ├── migrate.js          # aplica src/schema.sql no banco
│   ├── schema.sql           # todas as tabelas
│   ├── middleware/auth.js  # emissão/validação de JWT, checagem de papel
│   └── routes/              # auth, liderados, atividades, metas, diario, rotina, matriz, plano-acao, dashboard-config
├── test/smoke.js            # testa a API inteira contra um Postgres em memória (sem precisar do Neon)
├── .env.example
└── package.json
```

---

## Como colocar no ar

### 1. Criar o banco no Neon

1. Acesse [neon.tech](https://neon.tech) e crie um novo projeto (ex: `planner-lider`).
2. Em **Connection Details**, copie a **connection string** (a versão "pooled" é a recomendada). Algo como:
   `postgresql://usuario:senha@ep-exemplo-pooler.neon.tech/neondb?sslmode=require`

### 2. Rodar as migrações (criar as tabelas)

Localmente, com Node instalado:

```bash
npm install
cp .env.example .env
# edite o .env e cole a connection string do Neon em DATABASE_URL
npm run migrate
```

### 3. Publicar a API no Render

1. Suba este repositório no GitHub.
2. No [Render](https://render.com), **New > Web Service**, conecte o repositório.
3. Configurações do serviço:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Em **Environment**, adicione as variáveis (nunca coloque no código nem no GitHub):
   - `DATABASE_URL` — a connection string do Neon.
   - `JWT_SECRET` — uma string aleatória longa. Gere uma com:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `ALLOWED_ORIGINS` — `https://planner.institutodalideranca.com.br`
5. Deploy. O Render te dá uma URL pública (ex: `https://planner-lider-api.onrender.com`) — é essa URL que o site vai chamar.

> No plano gratuito do Render o serviço "dorme" depois de um tempo sem uso e demora alguns segundos pra acordar na primeira chamada — normal, não é bug.

### 4. Testar sem precisar do Neon

```bash
npm test
```

Isso sobe a API inteira contra um Postgres simulado em memória e exercita os fluxos principais (cadastro, login, permissões por papel, Kanban, metas, diário de bordo, e a garantia de que o liderado nunca vê os apontamentos privados do líder). Útil antes de qualquer deploy.

---

## Endpoints (resumo)

Todas as rotas (exceto `/auth/*` e `/health`) exigem `Authorization: Bearer <token>`.

| Rota | Quem usa | O que faz |
|---|---|---|
| `POST /auth/registrar-lider` | líder | cria o workspace |
| `POST /auth/login` | líder ou liderado | login |
| `GET/POST/PUT/DELETE /liderados` | líder | equipe (cria login do liderado junto) |
| `GET /liderados/me` | liderado | próprio perfil |
| `GET/POST/PUT/DELETE /atividades` | líder | quadro Kanban |
| `PATCH /atividades/:id/status` | líder | mover card |
| `GET /atividades/minhas` | liderado | só as próprias |
| `GET/POST/PUT/DELETE /metas` | líder | metas & indicadores |
| `GET /metas/minhas` | liderado | só as vinculadas às próprias atividades |
| `GET /diario/liderado/:id`, `POST /diario`, `DELETE /diario/:id` | líder | diário de bordo |
| `GET /diario/resumo-equipe` | líder | visão da equipe (mais recente de cada liderado) |
| `GET /diario/meus-feedbacks` | liderado | só os feedbacks formais recebidos |
| `GET/POST/DELETE /rotina` | líder | registro de rotina diária |
| `GET/POST/PUT/DELETE /matriz` | líder | matriz de prioridade |
| `GET/POST/PUT/DELETE /plano-acao` | líder | plano de ação do dashboard |
| `GET/PUT /dashboard-config` | líder | alocação ideal + checklists |

---

## Instituto da Liderança

Site: [www.institutodalideranca.com.br](https://www.institutodalideranca.com.br)
