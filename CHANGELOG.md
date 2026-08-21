## V12.1.4-corrigida — Correção do Perfil
- Unificada a duplicidade de `id="perfil"` no painel.
- Preservados os dados do corretor e o formulário de alteração de senha.

# V12.1.3 — Correção robusta de exclusão de fotos

- Centralizada a exclusão de fotos nas rotas DELETE e fallback POST.
- Mantida busca por ID, arquivo e URL da mídia, com validação por imóvel.
- Falhas de remoção física não deixam a API sem resposta após exclusão do banco.
- Promoção da próxima foto principal tratada de forma consistente.
- Banner do servidor passa a exibir a versão real do `package.json`.
- Preflight reforçado com validações das rotas e integração de mídia.

# V12.1.2 — Correção definitiva da exclusão de fotos

- Exclusão de fotos agora usa ID e referência do arquivo/URL como fallback.
- Mantida a validação de vínculo entre foto e imóvel.
- Exclusão do arquivo físico continua passando pelo storage configurado.
- Dashboard envia referência da mídia e usa cache-busting para evitar JavaScript antigo.

## V12.1 — Correção de legibilidade do Dashboard
- Corrigido contraste dos textos das características e checkboxes.
- Corrigida visualização de campos no tema claro/escuro.
- Destaque visual das características selecionadas.

# V12.0.0 — Hostinger First

- Removida a dependência de Vercel como plataforma de execução.
- Removidos `vercel.json`, `api/index.js` e scripts de build específicos da Vercel.
- Removido Vercel Blob do fluxo de mídia.
- Storage consolidado em disco persistente via `MEDIA_ROOT`.
- Upload de fotos e vídeos no dashboard passou a enviar um arquivo por requisição.
- Canonical, Open Graph, robots e sitemap alinhados ao domínio `fabianoreisimoveis.com.br`.
- Versão do projeto atualizada para 12.0.0.

# V11.2.0 — Características completas dos imóveis

- Cadastro e edição de características em 7 categorias com seleção múltipla e busca.
- Persistência em `imoveis.caracteristicas_json`, compatível com SQLite local e PostgreSQL/Neon.
- Migração não destrutiva para bases existentes.
- Exibição pública agrupada por categoria, mostrando somente itens selecionados.
- Chave canônica para opções repetidas, como Suíte master.
- Validação server-side: somente características cadastradas no catálogo são persistidas.
- Mantidas as funcionalidades V11.1: CRM, leads, conversões, WhatsApp, compartilhamento, galeria, vídeos e SEO.


## V11.0.1 — Incorporação de melhoria do V7.0.2.1

- YouTube oficial do Fabiano Reis incorporado à configuração padrão (`CONTATO_YOUTUBE`).
- Botão YouTube da página inicial passa a abrir o canal oficial sem exigir configuração adicional em ambiente local.
- Canal oficial incluído também no `sameAs` do JSON-LD da página inicial.
- Demais recursos da V11 (CRM, conversões, WhatsApp, compartilhamento, mídia e segurança) preservados.

## [10.0.0] — CRM FINAL

- CRM funcional em `/crm.html` com clientes, busca e edição.
- Histórico de interações incluindo WhatsApp, telefone, e-mail, visita e proposta.
- Agenda de visitas com status e resumo operacional.
- Conversão de lead em cliente.
- Schema CRM sincronizado entre SQLite e PostgreSQL/Neon.
- Validação de sintaxe e preflight atualizados para V10.

# V9.1.0 — Hardening de Produção

Auditoria completa (ver `AUDITORIA-V9.1-HARDENING.md`). Nenhuma rota, tabela,
página ou funcionalidade removida.

### Segurança
- Uploads agora validam o conteúdo real do arquivo (magic bytes) além do MIME e da
  extensão; arquivo divergente é apagado do disco e recusado com 400.
- Rate limiting deixa de confiar em `X-Forwarded-For` quando `TRUST_PROXY` está
  desligado (impedia burlar o limite forjando o cabeçalho).
- Importação de imagem de publicação social recusa endereços não-https e hosts
  internos/privados (SSRF).
- `/api/upload` não expõe mais mensagem/código de erro interno ao cliente.
- Mapa de tentativas de login é podado para evitar crescimento de memória.
- `express.static` de `public/` nega dotfiles.

### Qualidade
- `/api/health` reporta a versão real lida do `package.json`.
- Intervalo do gráfico de leads normalizado para inteiro.
- Smoke test ampliado para 34 verificações (conteúdo falsificado e arquivo vazio).

# V8.0.0 — Premium Completa — 12/08/2026

- Recuperação de senha com token hash/expiração/uso único.
- Notificação de leads via Resend com retry e fallback de desenvolvimento.
- Exportação CSV/JSON e série histórica de leads no painel.
- Tema claro/escuro persistente.
- Páginas dedicadas de recuperação de senha.

# CHANGELOG

## [7.1.1] — V7.1 Premium: polimento de UI/UX, índices, contato centralizado e documentação

Nenhuma funcionalidade, rota, tabela ou dado foi removido.

### Frontend / UX
- Nova camada `public/premium.css` (carregada em todas as páginas, inclusive no painel): foco visível em todos os controles, skip-link acessível, hover contido nos cards, estado `is-loading` para botões, avisos de sucesso/erro (`.fr-aviso`), skeletons adicionais, ajustes finos de 320px a ultra-wide (≥1600px), estilos de impressão da ficha do imóvel e respeito a `prefers-reduced-motion`.
- Ações dos cards nunca dependem de hover (acessibilidade em toque/teclado).

### Contato centralizado
- `GET /api/corretor` passou a ler `WHATSAPP_NUMBER`, `CONTATO_*` do ambiente e expõe `whatsapp_numero`.
- `aplicarContatoGlobal()` em `public/script.js` sincroniza todos os links `wa.me`, `tel:` e `mailto:` com esse valor — fim da divergência entre números espalhados por HTML/JS.

### Banco
- Novos índices idempotentes (PostgreSQL e SQLite) para catálogo, filtros, destaques, galeria por imóvel, leads e depoimentos.

### Documentação e limpeza
- `.env.example` restaurado e ampliado (todas as variáveis realmente lidas pelo código).
- Novos documentos: `DEPLOY-HOSTINGER.md`, `SECURITY.md`, `DATABASE.md`.
- Removidos artefatos de teste de `public/uploads/imagens/` (arquivos `teste`/`passwd` gerados pelo smoke test).

## [7.1.0] — Migração V7 → V7.1: Hostinger Cloud, storage persistente e endurecimento de segurança

Nenhuma funcionalidade, rota, tabela, dado, imóvel, lead, depoimento ou mídia foi
removido. Todas as alterações são incrementais e reversíveis.

### Infraestrutura / independência da Vercel
- Nova camada `storage/index.js` (`uploadFile`, `uploadBuffer`, `deleteFile`, `getPublicUrl`, `fileExists`, `multerStorage`): o `server.js` não chama mais o Vercel Blob diretamente.
- `STORAGE_PROVIDER` (`local` | `blob`) e `MEDIA_ROOT` definem onde a mídia é gravada. Padrão: `local` fora da Vercel; `blob` continua sendo o padrão quando `VERCEL` ou `BLOB_READ_WRITE_TOKEN` estão presentes (retrocompatível).
- `@vercel/blob` passou de dependência obrigatória para **opcional** e é carregado apenas quando o provedor `blob` está ativo. `api/index.js` e `vercel.json` foram mantidos.
- `MEDIA_ROOT` fora de `public/` é servido em `/uploads/...` pelo Express, preservando as URLs já gravadas em `imovel_midias`.
- `TRUST_PROXY` (padrão `1` em produção) para operar atrás do proxy HTTPS da Hostinger.
- `SITE_URL` fixa o domínio oficial em canônicas, Open Graph e sitemap dinâmico.
- Banner de inicialização agora informa porta, ambiente, banco real e provedor de storage.

### Segurança
- `JWT_SECRET` passou a ser obrigatório em **qualquer** produção (`NODE_ENV=production`), não só na Vercel, com mínimo de 24 caracteres.
- Upload: validação de extensão além do MIME — extensões executáveis (`.php`, `.js`, `.exe`, `.sh`, `.bat`, `.cgi`, `.ps1`, `.svg`, `.html`, etc.) recusadas com 400.
- Upload: nome de arquivo sempre regenerado no servidor e gravação confinada ao `MEDIA_ROOT` (path traversal neutralizado, inclusive `../` e `\`).
- `Content-Security-Policy` adicionada (compatível com as páginas atuais; `CSP_DISABLED=1` só para depuração).
- Cookie `Secure` e HSTS agora dependem de `IS_PRODUCTION` (antes só de `VERCEL`).
- Rate limiting também em `POST /api/upload` (antes apenas nas rotas de múltiplas mídias).
- Novo `.gitignore` protegendo `.env`, `node_modules/`, banco local, backups, logs e mídia de clientes.

### Banco de dados
- PostgreSQL/Neon preservado integralmente: nenhuma migration destrutiva, nenhum `DROP`, `TRUNCATE` ou `DELETE` em massa. Schema, índices e relacionamentos intactos.
- `imovel_midias` mantém `arquivo`, `url_externa`, `tipo`, `ordem`, `principal` — compatível com mídias antigas da Vercel.

### Observabilidade
- `GET /health` (e `/api/health`) verifica aplicação + banco e informa driver e provedor de storage, sem expor conexão, segredos ou stack.

### Migração de mídia
- Novo `scripts/migrate-media.js` (`npm run migrate:media`): dry-run por padrão, só grava com `--confirm`, valida cada arquivo por SHA-256 (origem × destino), nunca apaga a origem e preserva a URL antiga em `url_externa`.

### Testes
- `npm run test:smoke`: 32 verificações (antes 27) — inclui recusa de `.php` com MIME de imagem, neutralização de path traversal, presença de CSP e health check sem segredos.
- `npm run check`: itens novos de storage, CSP, `trust proxy`, health check, `.gitignore`, `.env.example` sem valores reais e documentação Hostinger. Corrigido o check da galeria pública, que apontava para `public/script.js` embora a galeria tenha ido para `public/imovel.js` na V7.

### Limitações conhecidas
- Rate limiting continua em memória do processo (por instância).
- O formulário de contato registra o lead, mas não envia e-mail/WhatsApp automático.
- As duas imagens de identidade visual (banner e foto do corretor) continuam pendentes de envio pelo cliente.

## [6.3.0] — Auditoria V6.3: segurança, validação e testes automatizados

### Segurança
- Proteção de origem (CSRF) em todas as rotas `/api` que alteram estado: requisições com `Origin` de terceiros recebem 403 (a sessão já usava cookie `HttpOnly` + `SameSite=Lax`).
- Rate limiting adicionado em `/api/leads` (8 envios / 10 min por IP), `/api/register` (5 / hora) e nas rotas de upload de mídia (60 / 10 min).
- Validação server-side completa no cadastro de imóveis (`POST /api/imoveis`): título, preço, área, quantidades, e listas fechadas de `tipo` e `operacao`.
- Mensagens de erro internas deixaram de expor `err.message`, `err.code` e stack ao cliente (detalhes ficam apenas no log do servidor).
- Tratador de erros final diferencia falhas de upload (400 com mensagem útil) de falhas internas (500 genérico) — antes qualquer erro virava 400 com a mensagem original.
- `multer` atualizado de 1.4.x (com vulnerabilidades conhecidas) para 2.x.

### Confiabilidade / infraestrutura
- Novo driver `db-sqlite-node.js`: quando o pacote nativo `sqlite3` não está instalável (ambiente sem toolchain de compilação), o adaptador usa o módulo nativo `node:sqlite` do Node 22.5+ automaticamente.
- `sqlite3` passou a ser `optionalDependency`: `npm install` não falha mais em máquinas sem build tools.
- `SQLITE_FILE` permite apontar o banco local para outro caminho (usado pelo smoke test, sem tocar no `database.db` real).

### Testes
- Novo `npm run test:smoke`: sobe o servidor em banco isolado e valida 27 pontos — login, cookie HttpOnly, proteção do painel, 401 nas rotas do corretor, 403 de origem externa, validação de imóvel/lead, upload aceito e recusado, vídeo por URL, desativação de imóvel e cabeçalhos de segurança.
- `npm run check` ampliado com os novos itens de segurança e o fallback SQLite.

### Observações
- Nenhum dado comercial, texto, imagem ou funcionalidade existente foi removido.

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


## V11 — Motor de Conversão

- Tracking de cliques em **Tenho interesse**, **Agendar visita** e **Fazer proposta**.
- Dashboard com métricas por período e ranking por imóvel.
- Eventos armazenados no PostgreSQL/Neon em produção ou SQLite em desenvolvimento.
- O tracking não armazena nome, telefone, e-mail ou IP; somente imóvel, CTA e data/hora.
- Rate limit público para reduzir abuso.
- `DATABASE_URL` obrigatório em produção.

> Clique de CTA é métrica de intenção e não equivale automaticamente a lead, visita realizada ou venda.

## V11.3.0 — Restauração visual do banner
- Restaurado o banner em proporção nativa, sem crop e sem overlay sobre a arte.
- A imagem principal agora mantém nitidez e composição do projeto de referência.
- Ações e busca rápida da V11 foram movidas para um bloco abaixo do banner, preservando as funcionalidades sem deformar a arte.
- Assets essenciais do banner e foto do corretor incluídos no release.
