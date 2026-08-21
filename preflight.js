#!/usr/bin/env node
/**
 * preflight.js — Validações pré-deploy V7.1
 * 
 * Executa via: npm run check
 * 
 * Verificações:
 * - Node.js 20+
 * - Arquivo .env (produção)
 * - Variáveis obrigatórias
 * - Package.json integridade
 * - Estrutura de diretórios
 * - Arquivos críticos
 */

const fs = require('fs');
const path = require('path');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[36m';

let errors = [];
let warnings = [];
let passes = [];

console.log(`${BLUE}═══════════════════════════════════════${RESET}`);
console.log(`${BLUE}  PREFLIGHT V12.1.5 — Validações de Deploy${RESET}`);
console.log(`${BLUE}═══════════════════════════════════════${RESET}\n`);

// ============= CHECK 1: Node.js =============
const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split('.')[0], 10);

if (majorVersion >= 20) {
  passes.push(`Node.js ${nodeVersion} ✓`);
} else {
  errors.push(`Node.js 20+ necessário (atual: ${nodeVersion})`);
}

// ============= CHECK 2: Package.json =============
const pkgPath = path.join(__dirname, 'package.json');
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.name && pkg.version && pkg.main) {
      passes.push(`package.json válido (v${pkg.version})`);
    } else {
      errors.push('package.json incompleto (faltam campos: name, version, main)');
    }
  } catch (e) {
    errors.push(`package.json inválido: ${e.message}`);
  }
} else {
  errors.push('package.json não encontrado');
}

// ============= CHECK 3: Estrutura de diretórios =============
const dirs = ['public', 'scripts', 'storage'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    passes.push(`Diretório /${dir} ✓`);
  } else {
    errors.push(`Diretório /${dir} ausente`);
  }
});

// ============= CHECK 4: Arquivos críticos =============
const criticalFiles = [
  'public/crm.html',
  'public/crm.js',
  'public/crm.css',
  'server.js',
  'db-adapter.js',
  'package.json',
  'public/index.html',
  'public/dashboard.html',
  'public/script.js'
];

criticalFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    passes.push(`Arquivo ${file} ✓`);
  } else {
    errors.push(`Arquivo crítico ausente: ${file}`);
  }
});

// ============= CHECK 5: HOSTINGER-FIRST =============
['vercel.json', 'api/index.js'].forEach(file => {
  if (fs.existsSync(path.join(__dirname, file))) errors.push(`Arquivo legado da Vercel encontrado: ${file}`);
});
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const forbidden = ['@vercel/blob'];
  const allDeps = Object.assign({}, pkg.dependencies || {}, pkg.optionalDependencies || {}, pkg.devDependencies || {});
  forbidden.forEach(dep => { if (allDeps[dep]) errors.push(`Dependência Vercel não permitida na V12: ${dep}`); });
  passes.push('Arquitetura Hostinger-first validada ✓');
} catch (_) {}

// ============= CHECK 5: Dependências instaladas =============
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  passes.push(`node_modules encontrado ✓`);
} else {
  warnings.push('node_modules não encontrado — execute: npm install');
}

// ============= CHECK 6: Banco de dados =============
const dbAdapterPath = path.join(__dirname, 'db-adapter.js');
if (fs.existsSync(dbAdapterPath)) {
  const dbContent = fs.readFileSync(dbAdapterPath, 'utf8');
  if (dbContent.includes('sqlite') || dbContent.includes('postgres')) {
    passes.push('Adaptador de banco detectado ✓');
  } else {
    warnings.push('Banco de dados pode não estar configurado corretamente');
  }
}

// ============= CHECK 7: .env em produção =============
const isProd = process.env.NODE_ENV === 'production';
const envPath = path.join(__dirname, '.env');
if (isProd) {
  const requiredEnvVars = [
    'JWT_SECRET',
    'DATABASE_URL',
    'NODE_ENV'
  ];
  
  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      errors.push(`Variável de ambiente ausente: ${varName}`);
    } else {
      passes.push(`Env var ${varName} ✓`);
    }
  });
} else {
  passes.push('Modo desenvolvimento ✓ (verificação de .env não necessária)');
}

// ============= CHECK 8: Storage =============
const storageIndexPath = path.join(__dirname, 'storage', 'index.js');
if (fs.existsSync(storageIndexPath)) {
  passes.push('Storage abstrato configurado ✓');
} else {
  warnings.push('Storage index não encontrado');
}

// ============= CHECK 9: Rotas e mídia =============
try {
  const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const dashboardContent = fs.readFileSync(path.join(__dirname, 'public', 'dashboard.js'), 'utf8');
  const mediaChecks = [
    ['Exclusão de foto por DELETE', serverContent.includes("app.delete('/api/imoveis/:imovelId/imagens/:imagemId'")],
    ['Fallback POST para exclusão de foto', serverContent.includes("app.post('/api/imoveis/:imovelId/imagens/:imagemId/excluir'")],
    ['Busca robusta da foto', serverContent.includes('function buscarImagemParaExclusao')],
    ['Storage com exclusão segura', serverContent.includes('removeStoredAsset')],
    ['Dashboard envia referência da foto', dashboardContent.includes('body:JSON.stringify({arquivo:arquivo||\'\',url_externa:urlExterna||\'\'})')]
  ];
  mediaChecks.forEach(([label, ok]) => {
    if (ok) passes.push(`${label} ✓`);
    else errors.push(`Falha na verificação de mídia: ${label}`);
  });
} catch (e) {
  errors.push(`Não foi possível validar rotas de mídia: ${e.message}`);
}

// ============= CHECK 10: Integridade de scripts =============
const smokeTestPath = path.join(__dirname, 'scripts', 'smoke-test.js');
if (fs.existsSync(smokeTestPath)) {
  passes.push('Smoke test disponível ✓');
} else {
  warnings.push('Smoke test não encontrado');
}

// ============= RELATÓRIO FINAL =============
console.log(`${GREEN}✓ VALIDAÇÕES PASSARAM${RESET}`);
passes.forEach(msg => console.log(`  ${GREEN}✓${RESET} ${msg}`));

if (warnings.length > 0) {
  console.log(`\n${YELLOW}⚠ AVISOS${RESET}`);
  warnings.forEach(msg => console.log(`  ${YELLOW}⚠${RESET} ${msg}`));
}

if (errors.length > 0) {
  console.log(`\n${RED}✗ ERROS${RESET}`);
  errors.forEach(msg => console.log(`  ${RED}✗${RESET} ${msg}`));
  console.log(`\n${RED}═══════════════════════════════════════${RESET}`);
  console.log(`${RED}PREFLIGHT FALHOU${RESET}`);
  console.log(`${RED}═══════════════════════════════════════${RESET}\n`);
  process.exit(1);
}

console.log(`\n${BLUE}═══════════════════════════════════════${RESET}`);
console.log(`${GREEN}PREFLIGHT OK — PRONTO PARA DEPLOY${RESET}`);
console.log(`${BLUE}═══════════════════════════════════════${RESET}\n`);

process.exit(0);
