#!/usr/bin/env node
/**
 * Check de entrega — V6.2
 * Unifica os antigos preflight.js, preflight-v53.js e preflight-vercel.js.
 *
 * Verifica: estrutura de arquivos, sintaxe, dependências, funcionalidades
 * críticas (mídias, autenticação, galeria), prontidão para Vercel, SEO e
 * acessibilidade básica da home.
 *
 * Itens de mídia (fotos reais do cliente) são AVISOS, não erros: eles ficam
 * fora do Git (public/uploads/) e são enviados pelo painel do corretor.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const exists = rel => fs.existsSync(path.join(root, rel));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
let warnings = 0;

const ok = (label, condition) => {
  console.log(`[${condition ? '✓' : '✗'}] ${label}`);
  if (!condition) failed = true;
};
const warn = (label, condition) => {
  console.log(`[${condition ? '✓' : '!'}] ${label}`);
  if (!condition) warnings++;
};

console.log('\n=== FABIANO REIS IMÓVEIS — CHECK DE ENTREGA (V6.2.3) ===\n');

console.log('-- Estrutura --');
[
  'server.js',
  'db-adapter.js',
  'package.json',
  'package-lock.json',
  'api/index.js',
  'vercel.json',
  '.env.example',
  'README.md',
  'CHANGELOG.md',
  'public/index.html',
  'public/dashboard.html',
  'public/dashboard.js',
  'public/script.js',
  'public/style.css',
  'public/favicon.ico',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/img/placeholder.svg',
  'public/uploads/imagens',
  'public/uploads/videos',
  'scripts/create-admin.js',
  'scripts/migrate-sqlite-to-postgres.js',
  'scripts/build-release.js'
].forEach(rel => ok(rel, exists(rel)));

console.log('\n-- Sintaxe --');
[
  'server.js',
  'db-adapter.js',
  'api/index.js',
  'public/script.js',
  'public/dashboard.js',
  'scripts/create-admin.js',
  'scripts/migrate-sqlite-to-postgres.js',
  'scripts/build-release.js'
].forEach(file => {
  const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  ok(`Sintaxe ${file}`, r.status === 0);
  if (r.status !== 0) console.error(r.stderr);
});

console.log('\n-- Dependências --');
const pkg = require(path.join(root, 'package.json'));
[
  'express', 'cors', 'jsonwebtoken', 'bcryptjs', 'sqlite3', 'multer', 'dotenv',
  '@neondatabase/serverless', '@vercel/blob'
].forEach(dep => ok(`Dependência ${dep}`, Boolean(pkg.dependencies?.[dep])));

const server = read('server.js');
const dash = read('public/dashboard.js');
const pub = read('public/script.js');
const html = read('public/index.html');
const lock = exists('package-lock.json') ? read('package-lock.json') : '';

console.log('\n-- Funcionalidades --');
ok('Exclusão segura de fotos', server.includes('DELETE FROM imovel_midias') && server.includes("tipo = 'imagem'"));
ok('Foto principal após exclusão', server.includes('novaPrincipalId'));
ok('Exclusão de vídeos', server.includes("tipo = 'video'") && server.includes('/videos/:videoId'));
ok('Gerenciador unificado de mídias', dash.includes('carregarListaImagens') && dash.includes('carregarListaVideos'));
ok('Galeria pública foto + vídeo', pub.includes('midiasGaleria') && pub.includes("media.tipo === 'video'"));
ok('Vídeos MP4/WebM/MOV + YouTube/Vimeo', server.includes('video/quicktime') && pub.includes('youtube.com/embed'));
ok('Migração SQLite -> PostgreSQL + Blob', exists('scripts/migrate-sqlite-to-postgres.js'));
ok('Criação de admin fora do código', exists('scripts/create-admin.js') && read('scripts/create-admin.js').includes('ADMIN_EMAIL'));

console.log('\n-- Segurança --');
ok('Cookie de sessão HttpOnly', server.includes('HttpOnly') && server.includes('SameSite=Lax'));
ok('Dashboard protegido no servidor', server.includes('protegerPaginaCorretor'));
ok('Rotas do painel exigem corretor', server.includes('verificarCorretor'));
ok('JWT_SECRET obrigatório em produção', server.includes('JWT_SECRET não configurado no Vercel'));
ok('Cabeçalhos de segurança', server.includes('X-Content-Type-Options') && server.includes('Referrer-Policy'));
ok('Limite de tentativas de login', server.includes('loginRateLimit'));
ok('Validação de leads', server.includes('Informe um e-mail válido.'));
ok('Sem segredos versionados', !exists('.env'));

console.log('\n-- Hospedagem --');
ok('Upload local na Hostinger sem Blob', server.includes("public/uploads/") && server.includes('armazenamentoMidia'));
ok('Upload direto Blob somente quando Vercel + Blob', server.includes('uploadDiretoBlob') && server.includes('IS_VERCEL && USE_BLOB'));

console.log('\n-- Vercel --');
ok('Entrada serverless', exists('api/index.js') && read('api/index.js').includes("require('../server')"));
ok('Configuração Vercel', exists('vercel.json') && read('vercel.json').includes('api/index.js'));
ok("Mídia configurável Hostinger/Vercel", server.includes("const USE_BLOB = db.mode === 'postgres' &&") && server.includes("app.get('/api/config'"));
ok('Lockfile com @neondatabase/serverless', lock.includes('@neondatabase/serverless'));
ok('Lockfile com @vercel/blob', lock.includes('@vercel/blob'));

console.log('\n-- SEO / Acessibilidade da home --');
ok('Title único', /<title>[^<]{15,}<\/title>/.test(html));
ok('Meta description', /<meta name="description" content="[^"]{50,}"/.test(html));
ok('Canonical', html.includes('rel="canonical"'));
ok('Open Graph + Twitter Card', html.includes('og:title') && html.includes('twitter:card'));
ok('Dados estruturados schema.org', html.includes('application/ld+json') && html.includes('RealEstateAgent'));
ok('H1 único', (html.match(/<h1/g) || []).length === 1);
ok('robots.txt aponta sitemap', read('public/robots.txt').includes('Sitemap:'));
ok('Formulários com label', html.includes('for="nomeLead"') && html.includes('for="emailLogin"'));
ok('Skip link', html.includes('skip-link'));
ok('Favicon leve (< 100 KB)', fs.statSync(path.join(root, 'public/favicon.ico')).size < 100 * 1024);

console.log('\n-- Mídia do cliente (avisos) --');
warn('Banner enviado (public/uploads/imagens/banner-alto-padrao.png)', exists('public/uploads/imagens/banner-alto-padrao.png'));
warn('Foto do corretor (public/uploads/imagens/foto-corretor-v5.png)', exists('public/uploads/imagens/foto-corretor-v5.png'));

console.log('');
if (warnings) {
  console.log(`${warnings} aviso(s): mídia pendente. A home usa /img/placeholder.svg até o envio dos arquivos.`);
}
console.log(failed
  ? 'RESULTADO: FALHOU — corrija os itens marcados com ✗\n'
  : 'RESULTADO: APROVADO — estrutura, sintaxe, segurança e SEO OK\n');
process.exit(failed ? 1 : 0);
