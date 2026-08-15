# Fabiano Reis Imóveis — V7.0

## Produção

- Domínio oficial: https://fabianoreisimoveis.com.br
- Node.js: >=20
- Multer: 2.2.0
- JWT_SECRET: obrigatório em produção, mínimo 32 caracteres
- MEDIA_ROOT: armazenamento persistente para Hostinger
- DATABASE_URL: PostgreSQL/Neon em produção quando configurado
- BLOB_READ_WRITE_TOKEN: Vercel Blob quando usado

## Deploy

1. Configure `JWT_SECRET`, `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN` conforme o ambiente.
2. Na Hostinger, configure `MEDIA_ROOT` para uma pasta persistente fora do diretório de deploy.
3. Execute `npm ci`.
4. Execute `npm run check`.
5. Execute `npm run build:release` e publique somente a pasta `release/`.
6. Preserve `MEDIA_ROOT` entre deploys.

## V7.0 — mudanças principais

Segurança de upload, rate limiting público, validação de assinatura, SSRF hardening, SEO do domínio oficial, sitemap dinâmico, páginas individuais de imóveis, mídia agregada e release por lista branca.

# Imobiliária Fabiano Reis — Site + Painel do Corretor

Versão **7.0.0**

Site institucional de imóveis com painel administrativo do corretor: cadastro de
imóveis, galeria de fotos e vídeos, destaque na home, captação e gestão de leads.

- Corretor: Fabiano Reis de Araújo — CRECI-RJ 93.426
- Contato do site: WhatsApp (21) 97266-4423 · Telefone (21) 99182-2134 · fabianooficialcorretor@gmail.com
- Atendimento: segunda a sábado, 8:00 – 16:00 · Travessa Arlindo Carreiro, 451

> Todos os dados comerciais acima já constavam no projeto original e foram preservados.

---

## Tecnologia

| Camada | Stack |
| --- | --- |
| Backend | Node.js 20+ · Express 4 |
| Frontend | HTML5 · CSS3 · JavaScript (sem framework) |
| Banco (local) | SQLite 3 (`database.db`, criado automaticamente) |
| Banco (produção) | PostgreSQL / Neon (`@neondatabase/serverless`) |
| Mídia (local) | Disco persistente em `MEDIA_ROOT` |
| Mídia (Hostinger) | Disco persistente em `MEDIA_ROOT` (fallback em `~/fabiano-reis-media`) |
| Mídia (Vercel) | Vercel Blob (`@vercel/blob`), incluindo client upload para arquivos grandes |
| Autenticação | JWT em cookie **HttpOnly** + `bcryptjs` |
| Deploy | Vercel (`api/index.js` + `vercel.json`) ou qualquer host Node |

A troca SQLite → PostgreSQL é automática: se `DATABASE_URL` existir, o adaptador
(`db-adapter.js`) usa Neon; caso contrário, usa SQLite local.

## Requisitos

- Node.js **20 ou superior**
- npm 10+
- (opcional, produção) conta Vercel com Postgres/Neon e Blob Store

## Instalação

```bash
npm install
cp .env.example .env   # preencha os valores necessários
```

## Execução local

```bash
npm start        # http://localhost:3000
npm run dev      # com nodemon (requer nodemon instalado)
```

Criar o usuário do corretor (não existe cadastro de corretor pela interface):

```bash
ADMIN_EMAIL=seu@email.com ADMIN_PASSWORD=umaSenhaComMais12Chars npm run admin:create
```

Acesse a home → **Acesso do Corretor** → login → `/dashboard.html`.

## Build

O projeto é servido diretamente por Node/Express: **não há etapa de bundling**.

- Validação de entrega: `npm run check`
- Pacote de release em `release/`: `npm run build:release`
- Na Vercel, `vercel-build` executa a validação (`preflight.js`)

## Testes

Não há suíte automatizada de unidade no projeto. O que existe e foi executado:

```bash
npm run check      # estrutura, sintaxe, dependências, segurança, SEO, acessibilidade
```

Roteiro manual recomendado após qualquer alteração:

1. `npm start` e abrir `http://localhost:3000` (console do navegador sem erros)
2. Enviar o formulário de contato → lead deve aparecer no painel
3. Login do corretor → criar/editar/desativar imóvel
4. Enviar fotos e vídeos, definir foto principal, excluir mídia
5. Conferir a home em 390px, 768px e 1440px

## Deploy

### Vercel (recomendado)

1. Crie o projeto a partir do repositório (sem framework preset).
2. Configure as variáveis de ambiente:
   - `DATABASE_URL` — string de conexão Neon
   - `JWT_SECRET` — segredo forte e exclusivo
   - `CORS_ORIGIN` — domínio público do site
   - `BLOB_READ_WRITE_TOKEN` — necessário somente para usar Vercel Blob; na Hostinger pode ficar vazio
3. `npm run migrate:vercel` para migrar dados/mídia do SQLite local (opcional).
4. `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create` com `DATABASE_URL` apontando para o Neon.
5. Deploy. A função serverless é `api/index.js`, que reexporta `server.js`.

### Host Node tradicional / VPS

```bash
npm ci --omit=dev
NODE_ENV=production JWT_SECRET=... node server.js
```

Use um proxy reverso com HTTPS (o cookie de sessão usa `Secure` em produção).

## Configurações pendentes ([CONFIGURAR])

| Item | Onde | Observação |
| --- | --- | --- |
| `JWT_SECRET` | env | obrigatório em produção; o servidor falha ao iniciar sem ele na Vercel |
| `DATABASE_URL` | env | sem ela o app usa SQLite local |
| `BLOB_READ_WRITE_TOKEN` | env | Hostinger: opcional; Vercel: necessário para mídia em Blob |
| `CORS_ORIGIN` | env | domínio público; sem ela vale a lista padrão em `server.js` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | env (uso pontual) | criação do corretor via `npm run admin:create` |
| Domínio canônico | `public/index.html`, `public/robots.txt`, `public/sitemap.xml` | hoje aponta para `imobiliaria-fabiano-oficial.vercel.app`; troque ao usar domínio próprio |
| `banner-alto-padrao.png` | `public/uploads/imagens/` | **[IMAGEM PENDENTE]** — não veio no pacote; a home exibe `/img/placeholder.svg` |
| `foto-corretor-v5.png` | `public/uploads/imagens/` | **[IMAGEM PENDENTE]** — idem |

## Integrações

- **WhatsApp**: links diretos `wa.me/5521991822134` (botão flutuante e redes sociais).
- **Instagram / Facebook**: links do corretor no cartão de apresentação.
- **Formulário de contato**: grava lead real via `POST /api/leads` (persistido no banco e visível no painel). Não envia e-mail — para notificação por e-mail é necessário integrar um serviço externo (SMTP/Resend) — **[NÃO CONFIGURADO]**.
- **Mídia**: Hostinger usa `MEDIA_ROOT` persistente; Vercel usa Vercel Blob (fotos até 5 MB e vídeos até 50 MB), com client upload para arquivos grandes.
- **Vídeos por URL**: aceita MP4/WebM/MOV diretos e links de YouTube/Vimeo (embed).

## Estrutura

```
.
├── api/
│   └── index.js                 # entrada serverless da Vercel (reexporta server.js)
├── docs/
│   └── historico/               # relatórios e changelogs das versões anteriores
├── public/                      # front-end estático servido pelo Express
│   ├── index.html               # home pública
│   ├── dashboard.html           # painel do corretor (noindex, protegido no servidor)
│   ├── script.js                # lógica da home (imóveis, galeria, leads, login)
│   ├── dashboard.js             # lógica do painel (CRUD, mídias, leads)
│   ├── style.css                # design system do site
│   ├── img/placeholder.svg      # fallback de imagem pendente
│   ├── robots.txt, sitemap.xml  # SEO técnico
│   └── uploads/                 # mídia local (fora do Git)
├── scripts/
│   ├── create-admin.js          # cria/atualiza o usuário corretor
│   ├── migrate-sqlite-to-postgres.js
│   └── build-release.js
├── db-adapter.js                # SQLite ↔ PostgreSQL/Neon com a mesma API
├── server.js                    # Express: rotas, autenticação, uploads, leads
├── preflight.js                 # check de entrega (npm run check)
├── vercel.json                  # roteamento da Vercel
└── .env.example
```

### Principais rotas da API

| Método | Rota | Acesso |
| --- | --- | --- |
| POST | `/api/login`, `/api/logout` | público (login com limite de tentativas) |
| GET | `/api/imoveis`, `/api/imoveis/:id`, `/api/imoveis/:id/midias` | público (somente ativos) |
| GET | `/api/admin/imoveis` | corretor |
| POST/PUT/DELETE | `/api/imoveis...` | corretor |
| POST/DELETE | `/api/imoveis/:id/fotos`, `/videos`, `/imagens/...` | corretor |
| POST | `/api/leads` | público (validado) |
| GET/PUT/DELETE | `/api/leads` | corretor |
| GET | `/api/corretor`, `/api/health` | público |

## Segurança implementada

- Sessão em cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` em produção); `/dashboard.html` é validado no servidor antes de ser servido.
- Senhas com `bcrypt`; resposta genérica no login para reduzir enumeração de contas.
- Limite de 10 tentativas de login por IP a cada 10 minutos.
- Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, HSTS em produção; `X-Powered-By` desativado.
- CORS com lista de origens permitidas e credenciais.
- Validação de entrada em login, cadastro e leads; escape de HTML no front (`escapeHtml`).
- Upload restrito por MIME type e tamanho; nenhum segredo versionado (`.env` ignorado pelo Git).

## Observações e limitações

- O limite de tentativas de login é em memória do processo: em ambiente serverless com múltiplas instâncias ele é por instância. Para bloqueio global, use um store compartilhado (Redis/Postgres).
- `public/uploads/` não é persistente em Vercel: em produção a mídia deve ir para o Vercel Blob (já implementado).
- O formulário de contato registra o lead no banco, mas **não** dispara e-mail/WhatsApp automático.
- As duas imagens de identidade visual (banner e foto do corretor) não vieram no pacote recebido; enquanto não forem enviadas, o site mostra um placeholder identificado.
- Não há testes automatizados; a validação disponível é `npm run check` + roteiro manual.

## Histórico

Consulte `CHANGELOG.md` e `docs/historico/` (documentação das versões 3.x a 6.1).

## V6.2.5 — Hostinger: mídia persistente

Na Hostinger, as fotos e vídeos não são mais gravados no diretório do deploy. O servidor usa `MEDIA_ROOT` para um armazenamento persistente.

Recomendado na Hostinger:

```env
MEDIA_ROOT=/home/SEU_USUARIO/fabiano-reis-media
```

Se `MEDIA_ROOT` não for definido, o sistema usa automaticamente `$HOME/fabiano-reis-media` (ou `storage/uploads` quando `HOME` não estiver disponível).

As URLs públicas continuam no formato `/uploads/imagens/...` e `/uploads/videos/...`.

O upload de fotos é processado uma foto por requisição. A exclusão de fotos usa uma única rotina compartilhada pelas rotas `DELETE` e `POST /excluir`.
