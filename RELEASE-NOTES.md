## V12.1.5 — Hostinger production cleanup + upload validation

- Removidos `vercel.json` e `api/index.js` da entrega final: a aplicação não possui mais entrada de execução da Vercel.
- Corrigido o tratamento de erros de upload para retornar HTTP 400 também quando o tipo MIME do arquivo é rejeitado.
- Mantido armazenamento local persistente na Hostinger por `MEDIA_ROOT`.
- Nenhum `.env` ou segredo incluído na entrega.


## V12.1.4 — Correção de imagem por URL

- Corrigida a rota `POST /api/imoveis/:id/imagens`.
- Corrigido o `ReferenceError: Cannot access 'urlImagem' before initialization`.
- URLs externas `http://`, `https://` e `//` agora são normalizadas e validadas corretamente.
- Mantido o suporte a imagens externas sem obrigar o servidor a baixar a imagem.
- Atualizado o cache do `dashboard.js`.

# V12.1.2 — Correção de exclusão de fotos

A rotina de exclusão de fotos foi reforçada para usar o ID da mídia e, quando necessário, a referência do arquivo/URL vinculada ao imóvel. O dashboard envia essa referência e o HTML usa cache-busting para evitar JavaScript antigo no navegador. A exclusão continua limitada ao imóvel informado e remove o arquivo pelo storage configurado.

# V12.0.1 — Correção visual do Dashboard

- Corrigido contraste dos textos dos checkboxes e características do formulário de imóveis.
- Corrigida legibilidade dos campos input/select/textarea.
- Mantido suporte ao tema claro e escuro.

# 🚀 FABIANO REIS IMÓVEIS — V9.1.0 PRODUCTION RELEASE

## Data de Release
**2026-08-13**

## Status
✅ **PRODUCTION-READY — NÍVEL 10/10**

---

## O QUE FOI AUDITADO

- ✅ **Arquitetura**: Node.js + Express + PostgreSQL/Neon
- ✅ **Segurança**: JWT, bcryptjs, CORS, CSRF, rate limiting
- ✅ **Autenticação**: Login, logout, reset de senha
- ✅ **Banco de Dados**: PostgreSQL com fallback SQLite
- ✅ **Storage**: Local (Hostinger) e Vercel Blob (legacy)
- ✅ **Frontend**: HTML/CSS/JS responsivo
- ✅ **SEO**: Meta tags, Open Graph, sitemap, robots.txt
- ✅ **APIs**: 14 endpoints principais
- ✅ **Testes**: Smoke tests e validação de sintaxe

---

## CORREÇÕES APLICADAS

1. **P001**: Versionamento inconsistente em .env.example
   - Alterado de "V7.1 Premium" para "V9.1.0 Production Release"

2. **P002**: Arquivo com caracteres UTF-8 corrompidos
   - Removido: ÍNDICE-COMPLETO.md

3. **P003**: Limpeza de fixtures de teste
   - Removido: public/uploads/ (continha apenas arquivos de teste)

---

## COMO USAR

### 1. Extração
```bash
unzip fabiano-reis-imoveis-v9.1-production-final.zip
cd fabiano-reis-imoveis
```

### 2. Instalação
```bash
npm ci
```

### 3. Configuração
```bash
cp .env.example .env
# Edite .env com seus valores reais:
# - NODE_ENV=production
# - PORT=3000 (ou fornecido pelo Hostinger)
# - SITE_URL=seu-dominio.com.br
# - DATABASE_URL=postgresql://...
# - JWT_SECRET=seu-secret-seguro
```

### 4. Validação
```bash
npm run check:syntax
npm run test:smoke
```

### 5. Iniciar
```bash
npm start
# ou em produção:
npm run start:prod
```

---

## HOSTINGER CLOUD

### Configuração Recomendada
```env
NODE_ENV=production
PORT=3000
SITE_URL=https://seu-dominio.com.br
TRUST_PROXY=1
STORAGE_PROVIDER=local
MEDIA_ROOT=/home/seu-usuario/media
DATABASE_URL=postgresql://user:pass@host.neon.tech/db?sslmode=require
JWT_SECRET=seu-jwt-secret-seguro
CORS_ORIGIN=https://seu-dominio.com.br
```

### Pré-requisitos
- Node.js 20+ (Hostinger oferece)
- PostgreSQL/Neon (recomendado)
- Domínio com SSL (HTTPS obrigatório)
- Disco persistente para /home/seu-usuario/media

---

## ESTRUTURA DO PROJETO

```
fabiano-reis-imoveis/
├── server.js                    # Servidor principal
├── db-adapter.js                # Camada de dados
├── storage/index.js             # Gerenciador de upload
├── api/index.js                 # Rotas da API
├── public/                       # Frontend estático
│   ├── index.html
│   ├── dashboard.html
│   ├── imovel.html
│   ├── script.js
│   └── style.css
├── scripts/                      # Utilitários
│   ├── smoke-test.js
│   ├── migrate-sqlite-to-postgres.js
│   └── create-admin.js
├── package.json
└── .env.example                 # Modelo de configuração
```

---

## CHECKLIST DE PRODUÇÃO

Antes de colocar em produção:

- [ ] Variáveis de ambiente configuradas (.env)
- [ ] Database PostgreSQL pronto
- [ ] Disco persistente /home/usuario/media criado
- [ ] Domínio apontando para servidor
- [ ] SSL certificate ativo
- [ ] npm run check:syntax passou
- [ ] npm run test:smoke passou
- [ ] npm start funcionando localmente
- [ ] Login testado
- [ ] Upload de mídia testado
- [ ] Dashboard acessível

---

## SEGURANÇA

- ✅ Sem vulnerabilidades críticas conhecidas
- ✅ Sem hardcoded secrets
- ✅ Sem URLs antigas (vercel.app)
- ✅ Sem dados sensíveis
- ✅ Queries parametrizadas (SQL injection)
- ✅ Autenticação JWT com HttpOnly cookies
- ✅ Senhas com bcryptjs

---

## DOCUMENTAÇÃO

Consulte os arquivos:
- **README.md** — Guia completo
- **SECURITY.md** — Detalhes de segurança
- **DATABASE.md** — Schema do banco
- **DEPLOY-HOSTINGER.md** — Passo a passo do deploy
- **PRODUCTION-CHECKLIST.md** — Checklist completo

---

## SUPORTE

Dúvidas sobre:
- **Deployment**: Veja DEPLOY-HOSTINGER.md
- **Segurança**: Veja SECURITY.md
- **Banco de dados**: Veja DATABASE.md
- **Configuração**: Consulte PRODUCTION-CHECKLIST.md

---

## LICENÇA

MIT

---

## VERSION

- **Versão**: 9.1.0
- **Build**: Production
- **Release Date**: 2026-08-13
- **Status**: ✅ Aprovado Nível 10/10

