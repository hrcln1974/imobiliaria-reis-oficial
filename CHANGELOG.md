
## 6.2.3 — Correção Hostinger + mídia + PostgreSQL

- Corrige o upload de fotos/vídeos na Hostinger: HTTPS não força mais Vercel Blob.
- Hostinger usa `public/uploads/` quando `BLOB_READ_WRITE_TOKEN` não está configurado.
- Vercel continua usando Vercel Blob quando disponível.
- Adiciona `/api/config` para o painel selecionar automaticamente o fluxo de upload.
- Corrige operações `UPDATE`/`DELETE` no adaptador PostgreSQL/Neon.
- Mantém exclusão definitiva de imóvel com limpeza das mídias associadas.
- Corrige edição e limpeza do formulário para não restaurar dados antigos.
- Adiciona ação de exclusão definitiva para imóveis inativos no painel.
# CHANGELOG

## [6.2.0] — Auditoria técnica, segurança e organização

### Segurança
- Cabeçalhos de segurança em todas as respostas (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`) e HSTS em produção.
- `X-Powered-By` desativado.
- Limite de tentativas de login por IP (10 tentativas / 10 minutos).
- Validação de entrada em `/api/login`, `/api/register` e `/api/leads` (formato de e-mail, tamanho de campos, senha mínima).
- Mensagem de login genérica para reduzir enumeração de contas.
- `/dashboard.html` marcado como `noindex, nofollow`.

### SEO
- Metatags corrigidas: descrição, geolocalização e canonical coerentes com CRECI-RJ (antes referenciavam São Paulo).
- Open Graph, Twitter Cards e JSON-LD (`RealEstateAgent`) na home.
- `robots.txt` e `sitemap.xml` adicionados, com o painel bloqueado para indexação.
- Um único `h1` semântico na home.

### Acessibilidade
- `label` associado a todos os campos de contato e login.
- Skip link para o conteúdo principal e estados de foco visíveis.
- `alt` descritivo nas imagens e `aria-label` nos links de redes sociais/WhatsApp.

### Performance
- Favicon reduzido de ~1,6 MB para menos de 9 KB (ICO multi-tamanho).
- Placeholder SVG leve para as imagens ainda não fornecidas, eliminando quebras de layout.

### Correções
- Fechamento de `div` faltante na seção do banner do `index.html`.
- Rota duplicada de "definir foto principal" removida.
- `ReferenceError: Cannot access 'USE_BLOB' before initialization` na inicialização do servidor.
- Overflow horizontal verificado e zerado em 390px, 768px e 1440px.
- `scripts/create-admin.js` passa a funcionar também com SQLite local (antes exigia `DATABASE_URL`, o que impedia acesso ao painel em desenvolvimento).

### Organização
- Scripts de validação unificados em `preflight.js` (`npm run check`).
- Documentação histórica consolidada em `docs/historico/`.
- `README.md` reescrito (instalação, execução, deploy, integrações, pendências) e `.env.example` + `.gitignore` adicionados.


## V5.0.0
- Novo banner de casa de alto padrão.
- Nova imagem de apresentação do corretor.
- Responsividade real para mobile/tablet/desktop.
- README e relatório de validação atualizados.

## [5.3.0] — Persistência de produção no Vercel

- PostgreSQL/Neon ativado por `DATABASE_URL`.
- SQLite mantido para desenvolvimento local.
- Vercel Blob para fotos e vídeos em produção.
- Client Uploads para arquivos maiores que o limite de request das Functions.
- Migração SQLite → PostgreSQL + Blob.
- Correção do erro de atualização de imóveis observado na V5.2 em produção.
- Preservação do banner, galeria, acesso do corretor e identidade visual V5.2.
