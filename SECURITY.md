# Segurança — Imobiliária Fabiano Reis V7.1 Premium

Este documento descreve os controles **implementados no código deste pacote**.
Cada item pode ser conferido nos arquivos indicados.

## 1. Autenticação e sessão

| Controle | Implementação |
| --- | --- |
| Hash de senha | `bcryptjs` (`server.js` — login/registro/`scripts/create-admin.js`); nenhuma senha em texto puro |
| Token | JWT assinado com `JWT_SECRET` (`jsonwebtoken`) |
| Transporte da sessão | Cookie `auth_token` com `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400`, e `Secure` quando `NODE_ENV=production` |
| Token no corpo | Não é devolvido no JSON de login (verificado pelo smoke test) |
| Logout | `POST /api/logout` limpa o cookie com `Max-Age=0` |
| Autorização | `verificarToken` → 401; `verificarCorretor` exige `tipo === 'corretor'` → 403 |
| Página do painel | `GET /dashboard.html` passa por `protegerPaginaCorretor` **antes** do static: sem cookie válido → redirect `/?login=1`. `localStorage` sozinho não abre o painel |
| Cache do painel | `no-store` em `dashboard.html` e `dashboard.js` |

`JWT_SECRET` é **obrigatório** em produção e precisa de ao menos 24 caracteres;
caso contrário a aplicação encerra na inicialização com mensagem explícita.

## 2. Proteção das rotas de escrita (CSRF)

- Cookie de sessão com `SameSite=Lax`.
- Middleware de origem em `/api`: `POST/PUT/DELETE` só passam quando o `Origin`
  é ausente (curl/health check), está em `CORS_ORIGIN` ou coincide com o host da
  requisição (`x-forwarded-host`/`host`). Caso contrário → `403`.

## 3. Rate limiting (em memória do processo)

| Rota | Janela | Limite |
| --- | --- | --- |
| `POST /api/login` | 10 min | 10 tentativas por IP |
| `POST /api/register` | 60 min | 5 por IP |
| `POST /api/leads` | 10 min | 8 por IP |
| Uploads de mídia | 10 min | 60 por IP |

Limitação conhecida: o contador vive no processo. Em múltiplas instâncias
(ou serverless) o limite é por instância — para garantia global use um limitador
externo (Redis/Upstash) ou o WAF do provedor.

## 4. Upload e storage

Implementado em `storage/index.js` (usado por todas as rotas de mídia):

- **MIME permitido:** imagens `jpeg/png/webp/gif` (até 5 MB); vídeos
  `mp4/webm/ogg/quicktime` (até 50 MB, máx. 3 por envio).
- **Blocklist de extensões** independente do MIME informado: `.php*`, `.js`,
  `.mjs`, `.cjs`, `.exe`, `.sh`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.jar`, `.py`,
  `.pl`, `.rb`, `.asp(x)`, `.jsp`, `.dll`, `.so`, `.msi`, `.htaccess`,
  `.htpasswd`, `.svg`, `.html`, `.htm`.
- **Nome sempre regenerado no servidor** (`timestamp-uuid.ext`); o nome enviado
  pelo cliente nunca é usado como caminho.
- **Path traversal neutralizado:** `basename` POSIX, remoção de `..`/`\`, e a
  gravação é confinada ao `MEDIA_ROOT` resolvido; pasta restrita a
  `imagens|videos`.
- **Serviço estático da mídia:** `index: false`, `dotfiles: 'deny'`,
  `Cache-Control` imutável; nada é executado a partir de `/uploads`.
- **Remoção:** `deleteFile` só apaga ativos gerenciados pelo provedor ativo;
  URLs legadas do Vercel Blob nunca são apagadas por troca de provedor.

### 4.1 Validação de conteúdo real (magic bytes) — V9.1

MIME declarado e extensão são controlados pelo cliente. Por isso, após o
recebimento, os primeiros bytes do arquivo são comparados com a assinatura do
formato informado (`storage/index.js`: `assinaturaConfere`,
`validarConteudoRecebido`). Um `.jpg` cujo corpo seja HTML, PHP ou binário
arbitrário é apagado do disco e a requisição recebe `400`. Arquivos vazios
também são recusados. Aplicado em `/api/upload`, `/api/imoveis/:id/fotos` e
`/api/imoveis/:id/videos`.

### 4.2 Importação de imagem externa (SSRF) — V9.1

A URL de imagem extraída do HTML remoto é fetchada somente se usar `https` e se
o host não pertencer a loopback, link-local ou faixas privadas (IPv4 e IPv6).

## 5. Cabeçalhos HTTP

`server.js` aplica em todas as respostas:

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cross-Origin-Resource-Policy: same-origin
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none';
  frame-ancestors 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:;
  script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https:;
  form-action 'self'; frame-src 'self' https://www.youtube.com ... player.vimeo.com
Strict-Transport-Security: max-age=31536000; includeSubDomains   (somente em produção)
```

`X-Powered-By` está desativado. `CSP_DISABLED=1` existe apenas para depuração
local — nunca em produção.

Dívida técnica conhecida e documentada: a CSP mantém `'unsafe-inline'` para
scripts e estilos porque as páginas atuais usam handlers e estilos inline
(`onclick`, `style="..."`). Remover `'unsafe-inline'` exige extrair esses
trechos para arquivos e adotar nonce/hash — melhoria planejada, não aplicada
aqui para não quebrar o comportamento existente.

## 6. Validação de entrada

- `express.json({ limit: '1mb' })`.
- Cadastro/edição de imóvel: campos obrigatórios, tipos numéricos, `operacao` e
  `tipo` validados no servidor → `400` com mensagem clara.
- Leads: nome, e-mail (regex), telefone e tamanho de mensagem validados no
  servidor; status aceito apenas de uma lista fechada.
- Vídeo por URL: apenas `http(s)` de hosts de vídeo aceitos.
- **Todas** as consultas SQL usam parâmetros (`?` convertidos para `$n` no
  PostgreSQL em `db-adapter.js`). Não há SQL construído por concatenação de
  entrada do usuário.

## 7. Erros e vazamento de informação

- Handler global responde mensagem genérica; o detalhe fica no log do servidor.
- `/health` e `/api/health` retornam apenas `status`, `banco`, `storage` e
  `versão` — nenhum segredo, string de conexão ou token.
- Nenhum segredo versionado: `.env` está no `.gitignore` e o pacote traz apenas
  `.env.example` com valores de exemplo.

## 8. Produção

- `TRUST_PROXY=1` para cookies `Secure` corretos atrás do proxy da Hostinger.
- HTTPS obrigatório (o cookie de sessão não trafega em HTTP puro em produção).
- Sem `DATABASE_URL` em produção, `/health` sinaliza falha e as rotas `/api`
  respondem erro — o sistema não cai silenciosamente para SQLite.

## 9. Verificações automatizadas

```bash
npm run check        # auditoria de estrutura, segurança e prontidão de deploy
npm run test:smoke   # sobe a app real e executa as verificações funcionais/segurança
```

O smoke test cobre, entre outros: 401 sem sessão, 403 de origem externa,
recusa de `.php`, neutralização de path traversal, cookie HttpOnly, ausência de
token no corpo, cabeçalhos de segurança e `/health` sem segredos.

## 10. Reportar vulnerabilidades

Envie a descrição e o passo a passo de reprodução ao responsável técnico do
projeto antes de qualquer divulgação pública. Não use dados reais de clientes em
provas de conceito.
