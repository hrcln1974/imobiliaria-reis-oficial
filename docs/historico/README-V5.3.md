# Imobiliária Fabiano Reis — V5.3

V5.3 é a evolução da V5.2 para produção no Vercel. A interface, banner, acesso protegido do corretor e galeria foto + vídeo foram preservados.

## O que mudou

- **Banco local:** SQLite continua funcionando para desenvolvimento.
- **Banco de produção:** quando `DATABASE_URL` existe, o projeto usa PostgreSQL/Neon.
- **Mídias de produção:** quando PostgreSQL está ativo, fotos e vídeos são armazenados no Vercel Blob em vez do filesystem da Function.
- **Uploads grandes:** vídeos e arquivos maiores que 4,5 MB usam upload direto do navegador para o Vercel Blob.
- **Migração:** `scripts/migrate-sqlite-to-postgres.js` migra usuários, imóveis, leads e mídias do `database.db` para PostgreSQL e envia os arquivos locais referenciados ao Blob.
- **Compatibilidade local:** sem `DATABASE_URL`, o fluxo anterior com SQLite e `public/uploads` continua disponível.

A Vercel documenta o limite de 4,5 MB para uploads server-side e recomenda Client Uploads para arquivos maiores; o Vercel Blob é indicado para imagens e vídeos. urlDocumentação Vercel Blob — Client Uploadshttps://vercel.com/docs/vercel-blob/client-upload urlDocumentação Vercel Blob — Server Uploadshttps://vercel.com/docs/vercel-blob/server-upload

## Requisitos

- Node.js 20 ou superior
- npm
- Para produção: projeto Vercel
- Para produção: PostgreSQL/Neon
- Para produção: Vercel Blob com armazenamento **público** para as mídias da galeria

A integração Neon no Vercel fornece PostgreSQL gerenciado e pode configurar `DATABASE_URL`. urlNeon para Vercelhttps://vercel.com/integrations/neon

## Instalação local

```bash
npm install
npm run check
npm run check:v53
npm start
```

Abra `http://localhost:3000`.

O login administrativo preservado da V5.2 é:

- usuário: `fabiano@admin`
- senha inicial: `[REMOVIDO — não existe senha padrão]`

**Troque a senha antes de usar o sistema em produção.**

## Configuração local

Copie `.env.example` para `.env` e ajuste:

```env
PORT=3000
JWT_SECRET=troque-por-um-segredo-forte-e-unico
NODE_ENV=development
```

Sem `DATABASE_URL`, o projeto usa o `database.db` local.

## Produção no Vercel

### 1. Criar/conectar PostgreSQL

No projeto Vercel, instale uma integração PostgreSQL, preferencialmente Neon. A integração atual do Vercel com Neon é o caminho recomendado para PostgreSQL gerenciado. urlNeon para Vercelhttps://vercel.com/integrations/neon

O projeto precisa de:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=um-segredo-forte-e-unico
```

### 2. Criar o Vercel Blob

No Vercel:

**Project → Storage → Create Database → Blob**

Para esta galeria pública, crie o Blob como **Public**. O Vercel Blob é próprio para imagens, vídeos e outros arquivos de mídia. urlVercel Blobhttps://vercel.com/docs/vercel-blob

O Vercel fornece `BLOB_READ_WRITE_TOKEN` ao conectar o store ao projeto. urlVercel Blob SDKhttps://vercel.com/docs/vercel-blob/using-blob-sdk

### 3. Fazer o primeiro deploy

Faça push da V5.3 para o GitHub e deixe o Vercel criar o deployment.

### 4. Migrar os dados atuais da V5.2

No computador onde está este projeto:

```bash
vercel link
vercel env pull .env.local
npm install
npm run migrate:vercel
```

A migração usa o `database.db` incluído neste pacote e preserva IDs. As imagens/vídeos locais referenciados pelo banco são enviados ao Blob. URLs externas, como YouTube, continuam como URLs externas.

**Importante:** execute a migração somente uma vez sobre a base de produção inicial. O script é idempotente para os registros pelo ID, mas uploads de arquivos podem gerar novos objetos Blob se executado repetidamente.

### 5. Redeploy

Depois da migração, faça um novo deploy se necessário para garantir que as variáveis de produção estejam disponíveis na versão ativa.

## Como testar a V5.3

### Público

- Página inicial
- Banner de alto padrão
- Foto do corretor
- Lista de imóveis
- Filtros
- Detalhes do imóvel
- Galeria de fotos
- Galeria de vídeos
- Vídeos por URL

### Corretor

- Login com cadeado
- Acesso protegido a `/dashboard.html`
- Listagem de imóveis ativos/inativos
- Criar imóvel
- Editar imóvel
- Ativar/desativar imóvel
- Leads
- Gerenciador de mídias
- Definir foto principal
- Excluir foto
- Excluir vídeo
- Enviar fotos
- Enviar vídeos
- Upload de vídeos grandes via Blob

### Comandos de verificação

```bash
npm run check
npm run check:v53
npm run check:vercel
```

## Build/deploy

O projeto não possui frontend bundler obrigatório. O Vercel executa a Function `api/index.js` e os arquivos estáticos são servidos pelo projeto.

```bash
npm run vercel-build
```

Para publicação, basta fazer push para a branch conectada ao Vercel.

## Estrutura importante

```text
imobiliaria-fabiano/
├── api/index.js
├── database.db
├── db-adapter.js
├── server.js
├── vercel.json
├── package.json
├── public/
│   ├── index.html
│   ├── dashboard.html
│   ├── dashboard.js
│   ├── script.js
│   ├── style.css
│   └── uploads/
├── scripts/
│   └── migrate-sqlite-to-postgres.js
└── preflight-v53.js
```

## Configurações externas necessárias

Produção depende de:

1. PostgreSQL/Neon e `DATABASE_URL`.
2. Vercel Blob público e `BLOB_READ_WRITE_TOKEN`.
3. `JWT_SECRET` forte no Vercel.
4. Domínio/URL do Vercel.
5. Integrações externas de WhatsApp/redes sociais, caso sejam alteradas.

Nenhuma senha ou token real de produção deve ser colocado no GitHub.

## Observação sobre package-lock

A V5.3 adiciona `@neondatabase/serverless` e `@vercel/blob`. O ambiente final deve executar `npm install` para resolver essas novas dependências e atualizar o lockfile com as versões efetivamente instaladas.
