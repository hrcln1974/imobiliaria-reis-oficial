# Fabiano Reis Imóveis — Pacote de Entrega ao Cliente

**Versão:** V12.1.4  
**Base:** evolução da linha V7  
**Destino:** manutenção, backup e futuras implantações do projeto

## O que este pacote contém

- código-fonte completo da aplicação;
- servidor Node.js/Express;
- integração PostgreSQL/Neon;
- armazenamento persistente de mídia;
- catálogo público de imóveis;
- página individual de imóvel;
- painel administrativo;
- CRM;
- leads e agenda;
- autenticação e recuperação de senha;
- integração com WhatsApp;
- integração social, incluindo YouTube;
- SEO, sitemap e robots;
- scripts de verificação, administração e migração;
- documentação técnica de operação.

## Segurança da entrega

Este pacote foi separado do ambiente de produção. **Não contém:**

- `.env` com credenciais reais;
- senha de administrador;
- `DATABASE_URL` real;
- `JWT_SECRET` real;
- `database.db` de produção;
- `node_modules`;
- `.git` ou histórico local do repositório;
- mídias geradas/armazenadas na Hostinger;
- arquivos de backup do código.

O arquivo `.env.example` é somente um modelo. Para produção, crie um `.env` no servidor e preencha os valores reais.

## Instalação básica

```bash
npm install
npm run check
npm run check:syntax
npm start
```

Para desenvolvimento local, configure as variáveis necessárias em `.env` a partir de `.env.example`.

## Produção Hostinger

A arquitetura de produção prevista é:

```text
Internet
  -> HTTPS / Hostinger
  -> Node.js 20+
  -> Express
  -> PostgreSQL/Neon
  -> MEDIA_ROOT persistente da Hostinger
```

Consulte `README-V12-HOSTINGER.md` e `DEPLOY-HOSTINGER.md` antes de qualquer implantação.

## Verificações disponíveis

```bash
npm run check
npm run check:syntax
npm run test:smoke
npm run verify
```

O preflight da versão empacotada foi executado e passou. A ausência de `node_modules` no pacote é intencional; após `npm install`, as verificações devem ser repetidas no ambiente de destino.

## Importante sobre dados de produção

As fotos, vídeos e demais mídias da operação real ficam no armazenamento persistente configurado no servidor e não fazem parte deste pacote de código. O banco PostgreSQL de produção também não é distribuído neste ZIP.

## Documentação principal

- `README-V12-HOSTINGER.md` — arquitetura e operação na Hostinger
- `DEPLOY-HOSTINGER.md` — implantação
- `DATABASE.md` — banco e migração
- `SECURITY.md` — segurança
- `PRODUCTION-CHECKLIST.md` — checklist técnico
- `RELEASE-NOTES.md` — notas da release
- `CHANGELOG.md` — histórico de alterações

## Observação de entrega

Este ZIP é o **pacote-fonte profissional**, separado do ambiente de produção. Ele não substitui o backup do servidor, o banco PostgreSQL ou o armazenamento de mídia.
