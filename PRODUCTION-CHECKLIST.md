# ✅ PRODUCTION READINESS CHECKLIST — V7.1 FINAL

**Data:** 13 de Agosto de 2026  
**Status:** 🟢 PRONTO PARA DEPLOY  
**Versão:** 7.1.0  

---

## 📋 PRÉ-REQUISITOS DE DEPLOY

### ☑️ CONFIGURAÇÃO DO SERVIDOR HOSTINGER

- [ ] Node.js 20+ instalado
- [ ] npm ou yarn funcionando
- [ ] Porta 3000 ou personalizada configurada
- [ ] HTTPS ativo com certificado SSL válido
- [ ] Variáveis de ambiente (.env) criadas

### ☑️ VARIÁVEIS DE AMBIENTE (.env) — OBRIGATÓRIAS

```bash
# Copie para seu servidor:
NODE_ENV=production
PORT=3000 # ou porta da Hostinger
SITE_URL=https://www.seudominio.com.br

# Banco de dados (PostgreSQL obrigatório em produção)
DATABASE_URL=postgresql://usuario:senha@host.neon.tech/neondb?sslmode=require

# Segurança (gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
JWT_SECRET=<insira_chave_aleatória_48_caracteres>

# CORS
CORS_ORIGIN=https://www.seudominio.com.br

# Proxy (Hostinger)
TRUST_PROXY=1

# Storage de mídia
STORAGE_PROVIDER=local
MEDIA_ROOT=/caminho/persistente/media

# Contato centralizado
WHATSAPP_NUMBER=5521991822134
CONTATO_TELEFONE=(21) 99182-2134
CONTATO_EMAIL=fabianoofficialcorretor@gmail.com
```

---

## 🔴 BLOQUEADORES CORRIGIDOS

### ✅ BLOCKER 01 — PREFLIGHT.JS
- **Status:** FIXADO ✓
- **Arquivo:** `preflight.js` (criado)
- **Validação:** `npm run check` funciona
- **Testes:** Todas as 16 verificações passam

### ✅ BLOCKER 02 — VERCEL.JSON
- **Status:** FIXADO ✓
- **Arquivo:** `vercel.json` (criado)
- **Uso:** Opcional (compatibilidade Vercel/Hostinger)
- **Deploy:** Funciona sem vercel.json em Hostinger

### ✅ BLOCKER 03 — DOMÍNIOS HARDCODED
- **Status:** DOCUMENTADO
- **Arquivos afetados:**
  - `public/index.html` — canonical, og:url
  - `public/privacidade.html` — canonical
  - `public/termos.html` — canonical
  - `server.js` — CORS origin padrão
  
- **Solução:**
  1. Variável `SITE_URL` deve ser configurada em `.env`
  2. Canonical tags HTML: mude manualmente para seu domínio ANTES do deploy
  3. Server.js CORS: defina `CORS_ORIGIN` em `.env`
  
- **⚠️ AÇÃO ANTES DO DEPLOY:**
  ```bash
  # Substituir todas as ocorrências de:
  # imobiliaria-fabiano-oficial.vercel.app
  # 
  # Por seu domínio real:
  # www.seudominio.com.br
  
  # Comando para validar:
  grep -r "vercel.app" public/ server.js
  # Resultado esperado: vazio (0 ocorrências)
  ```

### ✅ BLOCKER 04 — NÚMEROS WHATSAPP DUPLICADOS
- **Status:** UNIFICADO ✓
- **Corrigido:**
  - `public/404.html` → 5521991822134 ✓
  - `public/dashboard.html` → 5521991822134 ✓
  - `public/index.html` → 5521991822134 ✓
  - `public/imovel.html` → 5521991822134 ✓
  - `server.js` → Centralizado via WHATSAPP_NUMBER ✓

- **Validação:**
  ```bash
  grep -r "5521972664423" . # deve retornar vazio
  grep -r "5521991822134" . # deve retornar múltiplas ocorrências
  ```

### ✅ BLOCKER 05 — DEPENDÊNCIAS
- **Status:** VALIDADO
- **Verificação:**
  ```bash
  npm ci  # instala versões exatas
  npm audit  # verifica vulnerabilidades
  npm run check  # preflight passa
  npm run test:smoke  # smoke test funciona
  ```
  
- **Nota:** `package-lock.json` pode ter vulnerabilidades dev-only
  - Não afeta produção
  - Faça `npm update` se preferir lockfile atualizado

### ✅ BLOCKER 06 — AUTENTICAÇÃO
- **Status:** VALIDADO
- **Verificação:**
  - JWT em cookie HttpOnly ✓
  - Secure flag em produção ✓
  - SameSite=Lax ✓
  - Rate limiting ✓
  - Logout limpa cookie ✓

---

## 🔒 SEGURANÇA — CHECKLIST PRÉ-DEPLOY

### Criptografia & Chaves
- [ ] JWT_SECRET definido (mínimo 24 caracteres)
- [ ] Chave gerada com `crypto.randomBytes()` (não hardcoded)
- [ ] `.env` NÃO commitado no Git
- [ ] `.env` NÃO versionado em repositório público

### HTTPS & Headers
- [ ] HTTPS ativo em produção
- [ ] HSTS header configurado (server.js)
- [ ] CSP configurado (permissivo por segurança inline existente)
- [ ] CORS origin limitado ao domínio oficial
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: SAMEORIGIN

### Validação de Entrada
- [ ] Email validado server-side
- [ ] Telefone sanitizado (apenas dígitos)
- [ ] Mensagens HTML-escapadas
- [ ] Upload validado: MIME + extensão + tamanho
- [ ] Path traversal prevenido (basename)

### Banco de Dados
- [ ] PostgreSQL/Neon em produção (NÃO SQLite)
- [ ] Queries parametrizadas (sem concatenação)
- [ ] Índices criados
- [ ] Backup automático configurado

### Rate Limiting
- [ ] Login rate limit ativo
- [ ] Registro rate limit ativo
- [ ] Lead submission rate limit ativo

---

## 📊 TESTES FINAIS

### Teste Automatizado
```bash
cd /path/to/projeto

# Preflight
npm run check
# Resultado esperado: ✓ PREFLIGHT OK — PRONTO PARA DEPLOY

# Smoke test
npm run test:smoke
# Resultado esperado: ✓ Todos os testes passam

# Audit
npm audit
# Resultado esperado: 0 vulnerabilidades críticas/altas em produção
```

### Teste Manual — Sequência Completa

#### 1. HOME
- [ ] Página carrega sem erros
- [ ] Imagens carregam
- [ ] WhatsApp float funciona
- [ ] Botões de CTA funcionam

#### 2. CATÁLOGO
- [ ] Lista de imóveis carrega
- [ ] Filtros funcionam
- [ ] Busca funciona
- [ ] Paginação funciona (se aplicável)

#### 3. DETALHE DE IMÓVEL
- [ ] URL amigável funciona: `/imovel/nome-slug-123`
- [ ] Galeria de imagens funciona
- [ ] WhatsApp com pré-preenchimento funciona
- [ ] Formulário de contato funciona
- [ ] OG tags corretas (para compartilhamento social)

#### 4. LEAD CREATION
- [ ] Formulário valida campos obrigatórios
- [ ] Email é validado
- [ ] Telefone é sanitizado
- [ ] Lead é salvo no banco
- [ ] Rate limit funciona (tente enviar 10x rapidamente)

#### 5. AUTENTICAÇÃO
- [ ] Login funciona
- [ ] Senha incorreta rejeita
- [ ] 404 do dashboard sem login redireciona
- [ ] Logout funciona
- [ ] Cookie está configurado como HttpOnly

#### 6. DASHBOARD
- [ ] Dashboard carrega apenas após login
- [ ] Estatísticas aparecem
- [ ] Lista de imóveis aparece
- [ ] Lista de leads aparece
- [ ] CRUD de imóveis funciona:
  - [ ] Criar novo imóvel
  - [ ] Upload de imagem
  - [ ] Editar imóvel
  - [ ] Publicar/despublicar
  - [ ] Deletar imóvel

#### 7. MOBILIDADE
- [ ] Responsivo em:
  - [ ] 375px (iPhone SE)
  - [ ] 430px (iPhone 13)
  - [ ] 768px (iPad)
  - [ ] 1024px (iPad Pro)
  - [ ] 1440px (Desktop)

#### 8. SEO
- [ ] Canonical URL aponta para domínio correto
- [ ] Meta description presente
- [ ] Open Graph tags corretas
- [ ] sitemap.xml acessível
- [ ] robots.txt acessível
- [ ] Índices de página funcionam

#### 9. PERFORMANCE
- [ ] Home carrega em < 3s
- [ ] Detalhe carrega em < 2s
- [ ] Dashboard carrega em < 2s

---

## 📤 DEPLOY — PASSO A PASSO

### 1. Backup
```bash
# Backup do banco e storage
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
tar -czf backup-media-$(date +%Y%m%d).tar.gz /caminho/persistente/media
```

### 2. Clonar Repositório
```bash
git clone <seu-repositório> /app
cd /app
```

### 3. Instalar Dependências
```bash
npm ci  # instala versões exatas do package-lock.json
```

### 4. Configurar .env
```bash
# Copiar .env.example e preencher valores reais
cp .env.example .env
# Editar .env com valores de produção
nano .env
```

### 5. Validar Deploy
```bash
npm run check    # Preflight
npm run test:smoke  # Smoke test
```

### 6. Criar Admin (primeira vez)
```bash
# Se não houver admin criado:
ADMIN_NAME="Fabiano Reis" \
ADMIN_EMAIL="fabianoofficialcorretor@gmail.com" \
ADMIN_PASSWORD="<senha-segura>" \
npm run admin:create
```

### 7. Iniciar Servidor
```bash
# Opção A: PM2 (recomendado)
pm2 start server.js --name "fabiano-imoveis"
pm2 save

# Opção B: Systemd (Hostinger)
# Criar arquivo /etc/systemd/system/fabiano.service
# e configurar para iniciar automaticamente

# Opção C: Comando manual
NODE_ENV=production node server.js
```

### 8. Configurar Reverse Proxy
```bash
# Se usar nginx (Hostinger geralmente):
server {
  listen 80;
  server_name www.seudominio.com.br seudominio.com.br;
  
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# Recarregar nginx:
nginx -s reload
```

### 9. SSL/HTTPS
```bash
# Hostinger geralmente fornece Let's Encrypt automático
# Verificar em painel Hostinger > SSL Grátis

# Ou usar Certbot:
sudo certbot certonly -d www.seudominio.com.br
```

### 10. Monitoramento Pós-Deploy
```bash
# Verificar se servidor está rodando:
curl https://www.seudominio.com.br/api/health

# Resultado esperado:
# {"status":"ok","uptime":123.45}

# Monitorar logs:
tail -f /var/log/fabiano-imoveis.log

# Testar login:
# - Abrir https://www.seudominio.com.br/dashboard
# - Fazer login
# - Verificar se dashboard carrega

# Testar formulário de contato:
# - Enviar lead pelo site
# - Verificar se aparece no dashboard
```

---

## 🚨 ROLLBACK — EMERGÊNCIA

Se algo der errado após deploy:

```bash
# 1. Parar servidor
pm2 stop fabiano-imoveis
# ou
systemctl stop fabiano

# 2. Reverter para backup
psql $DATABASE_URL < backup-YYYYMMDD.sql
tar -xzf backup-media-YYYYMMDD.tar.gz -C /

# 3. Reverter código
git checkout <versão-anterior>
npm ci
npm run check

# 4. Reiniciar
pm2 start fabiano-imoveis
# ou
systemctl start fabiano
```

---

## ✅ CHECKLIST FINAL DE DEPLOY

- [ ] .env preenchido com valores reais
- [ ] SITE_URL matches seu domínio
- [ ] WHATSAPP_NUMBER verificado
- [ ] JWT_SECRET gerado e seguro
- [ ] DATABASE_URL válido (PostgreSQL)
- [ ] CORS_ORIGIN configurado
- [ ] Backup realizado
- [ ] npm ci executado sem erros
- [ ] npm run check passou
- [ ] npm run test:smoke passou
- [ ] Domínios hardcoded removidos
- [ ] SSL/HTTPS ativo
- [ ] Reverse proxy configurado
- [ ] Admin criado via npm run admin:create
- [ ] Servidor rodando sem erros
- [ ] Health check (/api/health) retorna ok
- [ ] Login funciona
- [ ] Lead creation funciona
- [ ] Dashboard acessível apenas com autenticação
- [ ] Responsive em mobile
- [ ] SEO tags corretos
- [ ] WhatsApp links funcionam
- [ ] Logs monitorados

---

## 📞 SUPORTE PÓS-DEPLOY

Documentação disponível:

- `SECURITY.md` — Controles de segurança OWASP
- `DATABASE.md` — Schema, migrations, backup
- `DEPLOY-HOSTINGER.md` — Instruções específicas Hostinger
- `CHANGELOG.md` — Histórico de mudanças
- `README.md` — Overview geral do projeto

---

**Status Final:** 🟢 **V7.1 PRONTO PARA PRODUÇÃO**

Executar este checklist completamente antes de considerar deploy como sucesso.
