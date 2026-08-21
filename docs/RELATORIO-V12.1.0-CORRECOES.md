# V12.1.0 — Correções de mídia, exclusão e segurança

## Base
Esta release usa a V12 enviada pelo cliente como base e incorpora correções observadas ao comparar com a versão que estava publicada na Hostinger.

## Correções
- armazenamento local persistente via `storage/index.js`;
- upload de fotos pelo fluxo usado pelo Dashboard (`/api/imoveis/:id/fotos`);
- upload de vídeos com armazenamento persistente;
- cadastro de vídeos por URL (YouTube, Vimeo e MP4/WebM/OGG);
- exclusão de vídeos pelo painel;
- exclusão definitiva de imóvel com limpeza das mídias associadas;
- desativação lógica continua disponível;
- nova seção Perfil → Trocar senha;
- troca de senha exige senha atual e política de senha forte;
- sessão é encerrada após alteração de senha;
- preservadas as rotas e funcionalidades existentes da V12 (CRM, leads, recuperação de senha, características, SEO e autenticação).

## Testes estáticos
Executar:
`npm run check`
`npm run check:syntax`

## Hostinger
Configurar `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `SITE_URL`, `CORS_ORIGIN`, `STORAGE_PROVIDER=local` e `MEDIA_ROOT` persistente. Não substituir o `.env` de produção pelo `.env.example`.
