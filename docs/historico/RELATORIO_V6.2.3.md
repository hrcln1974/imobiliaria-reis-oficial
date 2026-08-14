# Relatório V6.2.3 — Hostinger + Neon + Mídias

## Problemas corrigidos

1. HTTPS no domínio da Hostinger era interpretado pelo painel como motivo para usar Vercel Blob.
2. A Hostinger não tinha `BLOB_READ_WRITE_TOKEN`, então o upload de imagens não concluía.
3. O adaptador PostgreSQL não reportava corretamente `changes` em `UPDATE`/`DELETE`, fazendo operações parecerem sem efeito.
4. A versão entregue precisava de exclusão definitiva de imóvel para remover registros antigos e suas mídias.
5. O formulário de edição/limpeza podia recuperar o estado anterior.

## Estratégia de mídia

- Hostinger/Node tradicional + Neon: mídia salva em `public/uploads/imagens` e `public/uploads/videos`.
- Vercel + Neon + Blob: mídia salva no Vercel Blob.
- O painel consulta `/api/config` e escolhe automaticamente o fluxo correto.

## Validação

- `node --check server.js` ✓
- `node --check db-adapter.js` ✓
- `node --check public/dashboard.js` ✓
- `node --check preflight.js` ✓
- `npm run check` ✓

## Deploy Hostinger

Com `DATABASE_URL` configurada para o Neon e sem `BLOB_READ_WRITE_TOKEN`, o upload tradicional pelo Express é usado automaticamente. Não é necessário criar uma nova base na Hostinger.
