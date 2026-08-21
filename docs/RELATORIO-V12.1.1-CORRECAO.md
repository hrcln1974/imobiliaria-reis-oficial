# V12.1.1 — Correção de importação de imagens por URL

## Correção principal
Corrigido o erro `ReferenceError: isSocialMediaUrl is not defined` no `server.js`, que ocorria ao acessar a rota de cadastro de imagens por URL.

## O que foi mantido
- Upload de fotos e vídeos pelo storage configurado.
- Rotas existentes do Dashboard.
- Exclusão de imagens e vídeos.
- Exclusão definitiva de imóveis.
- Troca de senha.
- SQLite local e PostgreSQL/Neon em produção.

## Compatibilidade
Foi adicionada também a função `importSocialImage()` usando o `fetch` nativo do Node.js, com validação de MIME, limite de 5 MB e timeout de 15 segundos.

## Teste
Após extrair o ZIP:
```bash
npm install
npm run check
npm run check:syntax
npm start
```
