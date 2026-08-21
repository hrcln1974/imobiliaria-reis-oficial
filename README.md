# Fabiano Reis Imóveis — V12.0.0 Hostinger First

Plataforma imobiliária profissional com site público, painel do corretor, CRM,
leads, WhatsApp, agenda, galeria de fotos/vídeos e SEO.

## Produção oficial

A V12 foi consolidada para **Hostinger como único ambiente de aplicação**.
A Vercel não faz parte da arquitetura de produção desta versão.

- Backend: Node.js 20+ + Express
- Banco local: SQLite para desenvolvimento
- Banco de produção: PostgreSQL/Neon
- Mídia: disco persistente da Hostinger via `MEDIA_ROOT`
- Frontend: HTML/CSS/JavaScript sem framework
- Autenticação: JWT HttpOnly + bcryptjs
- CRM: clientes, interações, visitas e conversão de leads
- WhatsApp: atendimento e registro de interações
- SEO: canonical, Open Graph, JSON-LD, sitemap e robots

## Execução local

```bash
npm install
npm run check
npm start
```

Acesse `http://localhost:3000`.

## Produção na Hostinger

Configure no ambiente de produção:

```text
NODE_ENV=production
SITE_URL=https://fabianoreisimoveis.com.br
DATABASE_URL=postgresql://...
JWT_SECRET=<chave forte com pelo menos 24 caracteres>
CORS_ORIGIN=https://fabianoreisimoveis.com.br
TRUST_PROXY=1
STORAGE_PROVIDER=local
MEDIA_ROOT=/home/usuario/fabiano-reis-media
```

Crie previamente as pastas persistentes:

```bash
mkdir -p /home/usuario/fabiano-reis-media/imagens
mkdir -p /home/usuario/fabiano-reis-media/videos
chmod 750 /home/usuario/fabiano-reis-media
```

O banco guarda os caminhos das mídias; as fotos e vídeos permanecem no disco
persistente, fora da pasta de deploy.

## Upload de mídia

O dashboard envia **um arquivo por requisição**. Isso reduz falhas de multipart,
facilita diagnóstico e evita perder todo o lote quando uma foto é inválida.

- Fotos: até 5 MB por arquivo.
- Vídeos: até 50 MB por arquivo.
- MIME, extensão e magic bytes são validados no servidor.
- Nomes são sanitizados e recebem sufixo aleatório.
- Path traversal e extensões executáveis são bloqueados.

## SEO

O Express entrega:

- `/sitemap.xml` — XML válido, com domínio oficial e imóveis ativos;
- `/robots.txt` — bloqueia painel/API e aponta para o sitemap.

O sitemap público estático também usa `https://fabianoreisimoveis.com.br` como
fallback.

## GitHub

Não versione:

```text
.env
node_modules/
database.db
*.db
coverage/
logs/
uploads gerados em produção
```

Use `.env.example` como modelo.

## Verificações

```bash
npm run check
npm run check:syntax
npm run check:crm
npm run verify
```

O `npm run check` valida Node, estrutura, arquivos críticos, arquitetura
Hostinger-first, banco e storage.

## Arquivos importantes

- `server.js` — aplicação Express e API
- `db-adapter.js` — SQLite/PostgreSQL
- `storage/index.js` — storage local persistente
- `public/dashboard.html` — painel protegido
- `public/dashboard.js` — operações do painel e uploads
- `public/crm.html` / `public/crm.js` — CRM
- `public/sitemap.xml` — fallback estático
- `public/robots.txt` — fallback estático
- `.env.example` — variáveis de produção
- `DEPLOY-HOSTINGER.md` — implantação
