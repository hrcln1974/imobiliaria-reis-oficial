# Fabiano Reis Imóveis — V9.0 FINAL CONSOLIDADA

Release única consolidada para execução local.

## Instalação

```bash
npm install
npm run check
npm start
```

Acesse `http://localhost:3000`.

## Desenvolvimento

```bash
npm run dev
```

## Smoke test

```bash
npm run test:smoke
```

## Ambiente

Copie `.env.example` para `.env` quando precisar personalizar:
- `JWT_SECRET`
- `DATABASE_URL` (PostgreSQL/Neon, opcional para desenvolvimento)
- `CORS_ORIGIN`
- `STORAGE_PROVIDER=local|blob`
- variáveis de e-mail/Resend
- `MEDIA_ROOT`

Sem `DATABASE_URL`, o projeto usa SQLite local. Em Node 22+, há fallback para `node:sqlite` se `sqlite3` não estiver disponível.

## Importante

- Não inclua `.env`, `database.db` ou `node_modules` no ZIP.
- Para produção, configure `JWT_SECRET` forte.
- Para Vercel, configure `DATABASE_URL` e o storage compatível.


## V11 — Motor de Conversão

- Tracking de cliques em **Tenho interesse**, **Agendar visita** e **Fazer proposta**.
- Dashboard com métricas por período e ranking por imóvel.
- Eventos armazenados no PostgreSQL/Neon em produção ou SQLite em desenvolvimento.
- O tracking não armazena nome, telefone, e-mail ou IP; somente imóvel, CTA e data/hora.
- Rate limit público para reduzir abuso.
- `DATABASE_URL` obrigatório em produção.

> Clique de CTA é métrica de intenção e não equivale automaticamente a lead, visita realizada ou venda.
