# Fabiano Reis Imóveis V12.0.0 — Hostinger First

Release consolidada para produção na Hostinger Cloud. A V12.1.5 remove os entrypoints da Vercel e usa armazenamento persistente local configurado por `MEDIA_ROOT`.

## Execução

```bash
npm install
npm run check
npm start
```

## Produção Hostinger

Configure `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `SITE_URL`, `CORS_ORIGIN` e `MEDIA_ROOT`. O banco de produção continua podendo ser PostgreSQL/Neon. As fotos e vídeos ficam em disco persistente da Hostinger.

## Mídia

Uploads usam `multer` + armazenamento local persistente. Fotos têm limite de 5 MB e vídeos de 50 MB. O dashboard envia cada arquivo individualmente para reduzir falhas de multipart e facilitar diagnóstico.

## SEO

`/sitemap.xml` e `/robots.txt` são servidos dinamicamente pelo Express. O domínio canônico padrão é `https://fabianoreisimoveis.com.br`.

## GitHub

Não versionar `.env`, bancos locais, `node_modules`, logs ou mídias geradas.

## Arquitetura

- Node.js 20+
- Express
- PostgreSQL/Neon em produção (conexão definida por `DATABASE_URL`)
- SQLite em desenvolvimento
- Storage local persistente na Hostinger
- CRM + WhatsApp + Leads + Agenda
- SEO + sitemap + robots
