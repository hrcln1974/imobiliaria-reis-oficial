# Deploy — Imobiliária Fabiano Reis V12.1.5 — Hostinger Cloud

## Objetivo

Esta entrega é **Hostinger-first e sem Vercel**. O aplicativo é Node.js + Express, com armazenamento de mídia local persistente em `MEDIA_ROOT`.

O banco continua sendo selecionado por `DATABASE_URL` (PostgreSQL/Neon na configuração atual). O pacote não inclui nem substitui o banco de produção.

## 1. Arquivo de produção

Use o ZIP `Imobiliaria_Fabiano_Reis_V12.1.5_HOSTINGER_PRODUCAO.zip`.

O pacote de deploy não contém:
- `.env`
- `database.db`
- `node_modules`
- `vercel.json`
- `api/index.js`
- mídias de produção

## 2. Hostinger Cloud — Node.js Web App

A Hostinger Cloud oferece hospedagem de aplicações Node.js. No hPanel, crie/configure a aplicação Node.js para o domínio existente e use upload por ZIP ou GitHub.

Configuração do projeto:

- Framework: `Express` (ou `Other`, se a interface não detectar automaticamente)
- Node.js: `22.x`
- Entry/Startup file: `server.js`
- Build: instalação das dependências (`npm ci --omit=dev`)
- Start: `npm start`

## 3. Variáveis de ambiente

Configure no ambiente da aplicação, sem colocar valores reais no ZIP:

```env
NODE_ENV=production
SITE_URL=https://fabianoreisimoveis.com.br
CORS_ORIGIN=https://fabianoreisimoveis.com.br
TRUST_PROXY=1
STORAGE_PROVIDER=local
MEDIA_ROOT=/home/u537144148/fabiano-reis-media
DATABASE_URL=postgresql://...
JWT_SECRET=CHAVE_FORTE_DE_48_OU_MAIS_CARACTERES
WHATSAPP_NUMBER=5521991822134
```

`DATABASE_URL` deve apontar para o banco que já contém os cadastros de produção. **Não execute migração nem crie outro banco durante o corte sem conferir a base atual.**

## 4. Mídias

O `MEDIA_ROOT` deve ficar fora do diretório descartável de cada build/deploy.

Estrutura esperada:

```text
/home/u537144148/fabiano-reis-media/
├── imagens/
└── videos/
```

As URLs públicas continuam no formato:

```text
/uploads/imagens/arquivo.jpg
/uploads/videos/arquivo.mp4
```

## 5. Corte para produção

1. Faça backup do site atual e da base de produção.
2. Mantenha o site atual em manutenção durante o corte.
3. Faça o upload do ZIP da V12.1.5.
4. Configure as variáveis de ambiente.
5. Garanta que `MEDIA_ROOT` aponte para a pasta persistente que contém as mídias reais.
6. Inicie/reinicie a aplicação.
7. Valide `/health`.
8. Valide o domínio público.
9. Teste login, cadastro/edição de imóvel, galeria, foto principal, exclusão de foto, vídeo, lead, WhatsApp e CRM.
10. Somente após a validação retire a página de manutenção.

## 6. Checklist mínimo pós-deploy

```text
[ ] /health = 200
[ ] Site público abre
[ ] Imóveis existentes aparecem
[ ] Login funciona
[ ] Dashboard funciona
[ ] Criar imóvel funciona
[ ] Editar imóvel funciona
[ ] Upload de foto funciona
[ ] Foto principal funciona
[ ] Exclusão de foto funciona
[ ] Vídeo/YouTube funciona
[ ] Lead é registrado
[ ] WhatsApp abre corretamente
[ ] CRM funciona
[ ] Imagens antigas continuam acessíveis
[ ] HTTPS ativo
[ ] Sem dependência de Vercel
```
