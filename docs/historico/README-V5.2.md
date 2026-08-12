# Imobiliária Fabiano Reis — V5.2.0 Vercel Ready

## Objetivo
Esta versão parte da V5.1.0 e acrescenta a entrada serverless do Vercel, mantendo:
- site público;
- 🔒 Acesso do Corretor;
- dashboard protegido por autenticação;
- imóveis;
- leads;
- WhatsApp;
- galeria unificada de fotos + vídeos;
- vídeos por arquivo e por URL YouTube/Vimeo;
- exclusão de mídias e foto principal.

## Tecnologia
- Node.js / Express
- SQLite3
- JWT + bcryptjs
- Multer
- HTML5, CSS3 e JavaScript
- Vercel Node Serverless Function

## Teste local
```bash
npm install
npm run check
npm run check:vercel
npm start
```

Abra `http://localhost:3000`.

## Deploy no Vercel
1. Faça commit/push desta versão para o GitHub.
2. No Vercel, importe o repositório.
3. Não publique um arquivo `.env` no Git.
4. Em Settings > Environment Variables, configure pelo menos:
   - `JWT_SECRET` = um segredo forte e exclusivo.
   - `NODE_ENV` = `production`.
5. Faça o deploy.
6. Teste a página inicial, login, dashboard e APIs.

## Limitação importante de produção
A V5.2 adapta o Express para o modelo serverless do Vercel, mas o projeto ainda utiliza:
- `database.db` local;
- `public/uploads/imagens`;
- `public/uploads/videos`.

Esses arquivos não são uma solução de persistência adequada para um sistema administrativo em produção serverless. Em particular, alterações feitas pelo corretor (novos imóveis, leads, fotos e vídeos) não devem depender do filesystem local da função.

Para produção definitiva, substitua:
- SQLite por um banco persistente compatível com Vercel;
- uploads locais por armazenamento de objetos persistente.

Até essa migração, use a V5.2 principalmente para demonstração/teste de deploy e interface.

## Credenciais
A instalação de desenvolvimento contém o usuário padrão:
- usuário: `fabiano@admin`
- senha inicial: `[REMOVIDO — não existe senha padrão]`

**Troque a senha antes de produção.**

## WhatsApp
O número configurado no site é usado nos links de WhatsApp. Revise o número antes de publicar.

## Mídias
- Banner: `public/uploads/imagens/banner-alto-padrao.jpg`
- Foto do corretor: `public/uploads/imagens/foto-corretor-v5.png`
- Fotos: `public/uploads/imagens/`
- Vídeos: `public/uploads/videos/`

## Checklist
```bash
npm install
npm run check
npm run check:vercel
npm start
```

Teste:
- desktop;
- tablet;
- celular;
- menu;
- 🔒 login;
- dashboard;
- cadastro/edição de imóvel;
- fotos;
- vídeos por arquivo;
- vídeos YouTube/Vimeo;
- exclusão;
- foto principal;
- leads;
- WhatsApp.
