require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db-adapter');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
let blobPut = null;
let blobDel = null;
if (db.mode === 'postgres') {
  const blobSdk = require('@vercel/blob');
  blobPut = blobSdk.put;
  blobDel = blobSdk.del;
}
const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || (process.env.HOME ? path.join(process.env.HOME, 'fabiano-reis-media') : path.join(process.cwd(), 'storage', 'uploads')));
const IS_VERCEL = Boolean(process.env.VERCEL);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || IS_VERCEL;
const CONFIGURED_SECRET = String(process.env.JWT_SECRET || '').trim();
const SECRET = CONFIGURED_SECRET || (IS_PRODUCTION ? '' : crypto.randomBytes(32).toString('hex'));
if (IS_PRODUCTION && (!SECRET || SECRET.length < 32)) {
  throw new Error('JWT_SECRET ausente ou inseguro. Configure uma chave aleatória com pelo menos 32 caracteres nas variáveis de ambiente.');
}
if (!CONFIGURED_SECRET && !IS_PRODUCTION) {
  console.warn('[SEGURANÇA] JWT_SECRET não configurado: uma chave efêmera de desenvolvimento foi gerada para esta execução.');
}
if (process.env.TRUST_PROXY === '1' || IS_PRODUCTION) app.set('trust proxy', 1);


// Middleware
const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const defaultCorsOrigins = [
  'https://fabianoreisimoveis.com.br',
  'https://www.fabianoreisimoveis.com.br',
  'https://imobiliaria-fabiano-oficial.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin(origin, callback) {
    // Same-origin requests and non-browser tools (curl/health checks) may not send Origin.
    if (!origin) return callback(null, true);
    const allowed = configuredCorsOrigins.length ? configuredCorsOrigins : defaultCorsOrigins;
    return callback(null, allowed.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));

// Cabeçalhos de segurança básicos (sem dependências extras).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (IS_VERCEL || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// O dashboard é protegido por cookie HttpOnly; os demais arquivos públicos continuam sendo servidos abaixo.

// Armazenamento: Vercel usa Vercel Blob; Hostinger usa uma pasta persistente.
// IMPORTANTE: o banco guarda apenas a URL relativa (/uploads/...), enquanto os
// arquivos locais ficam fora do diretório do deploy para não serem apagados em
// uma nova publicação. MEDIA_ROOT pode ser configurado na Hostinger.
const USE_BLOB = db.mode === 'postgres' && (IS_VERCEL || Boolean(process.env.BLOB_READ_WRITE_TOKEN));
const LOCAL_MEDIA_ROOT = MEDIA_ROOT;

if (!IS_VERCEL && !USE_BLOB) {
  for (const pasta of ['imagens', 'videos']) {
    try { fs.mkdirSync(path.join(LOCAL_MEDIA_ROOT, pasta), { recursive: true }); } catch (_) {}
  }

  // Migra com segurança arquivos da instalação antiga para o armazenamento persistente.
  // Não altera o banco nem apaga a origem; assim o deploy pode ser revertido sem perda.
  for (const pasta of ['imagens', 'videos']) {
    const origem = path.join(__dirname, 'public', 'uploads', pasta);
    const destino = path.join(LOCAL_MEDIA_ROOT, pasta);
    try {
      if (fs.existsSync(origem) && fs.existsSync(destino)) {
        for (const nome of fs.readdirSync(origem)) {
          if (nome === '.gitkeep') continue;
          const src = path.join(origem, nome);
          const dst = path.join(destino, nome);
          if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
        }
      }
    } catch (err) {
      console.warn(`[MEDIA] Não foi possível migrar ${pasta}:`, err.message);
    }
  }
}

const storage = USE_BLOB ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(LOCAL_MEDIA_ROOT, 'imagens');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldNameSize: 100, fieldSize: 64 * 1024, fieldNestingDepth: 3 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!permitidos.includes(file.mimetype)) return cb(new Error('Formato de imagem não permitido'));
    cb(null, true);
  }
});

const videoStorage = USE_BLOB ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(LOCAL_MEDIA_ROOT, 'videos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${baseName}${ext}`);
  }
});

function detectFileSignature(buffer, kind) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (kind === 'image') {
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    const isPng = buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
    const isGif = buffer.subarray(0,6).toString('ascii') === 'GIF87a' || buffer.subarray(0,6).toString('ascii') === 'GIF89a';
    const isWebp = buffer.length >= 12 && buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii') === 'WEBP';
    return isJpeg || isPng || isGif || isWebp;
  }
  if (kind === 'video') {
    const head = buffer.subarray(0, 32).toString('latin1');
    const isMp4Family = buffer.length >= 12 && buffer.subarray(4,8).toString('ascii') === 'ftyp';
    const isWebm = buffer.length >= 4 && buffer.subarray(0,4).equals(Buffer.from([0x1A,0x45,0xDF,0xA3]));
    const isOgg = buffer.subarray(0,4).toString('ascii') === 'OggS';
    return isMp4Family || isWebm || isOgg || head.includes('ftyp');
  }
  return false;
}

async function readUploadedBuffer(file) {
  if (!file) throw new Error('Arquivo não enviado');
  if (file.buffer) return file.buffer;
  if (file.path) return fs.promises.readFile(file.path);
  if (file.destination && file.filename) return fs.promises.readFile(path.join(file.destination, file.filename));
  throw new Error('Não foi possível validar o arquivo enviado.');
}

async function validateUploadedFile(file, kind) {
  const allowed = kind === 'image'
    ? new Set(['image/jpeg','image/png','image/webp','image/gif'])
    : new Set(['video/mp4','video/webm','video/ogg','video/quicktime']);
  if (!allowed.has(String(file.mimetype || '').toLowerCase())) throw new Error('Tipo MIME não permitido.');
  const buffer = await readUploadedBuffer(file);
  if (!detectFileSignature(buffer, kind)) {
    if (file.path) { try { await fs.promises.unlink(file.path); } catch (_) {} }
    throw new Error('O conteúdo do arquivo não corresponde ao tipo declarado.');
  }
  return buffer;
}

async function storeUploadedFile(file, folder) {
  if (!file) throw new Error('Arquivo não enviado');
  if (USE_BLOB) {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) {
      throw new Error('BLOB_READ_WRITE_TOKEN não configurado para armazenamento de mídia.');
    }
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    const safe = path.basename(file.originalname || `arquivo${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const blob = await blobPut(`${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`, file.buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.mimetype
    });
    return blob.url;
  }
  return `/uploads/${folder}/${file.filename}`;
}

async function storeBuffer(buffer, filename, contentType, folder) {
  if (USE_BLOB) {
    const blob = await blobPut(`${folder}/${filename}`, buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType
    });
    return blob.url;
  }
  const dir = path.join(LOCAL_MEDIA_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${folder}/${filename}`;
}

async function removeStoredAsset(asset) {
  if (!asset) return { removed: false, missing: true };

  if (/^https?:\/\//i.test(asset)) {
    if (/\.blob\.vercel-storage\.com/i.test(asset) && blobDel && (USE_BLOB || process.env.BLOB_READ_WRITE_TOKEN)) {
      try { await blobDel(asset); return { removed: true, missing: false }; }
      catch (err) { throw new Error(`Não foi possível excluir o arquivo do Blob: ${err.message}`); }
    }
    return { removed: false, missing: false, external: true };
  }

  if (!asset.startsWith('/uploads/')) return { removed: false, missing: false, external: true };

  const relative = asset.replace(/^\/uploads\//, '');
  const filePath = path.resolve(LOCAL_MEDIA_ROOT, relative);
  const root = path.resolve(LOCAL_MEDIA_ROOT) + path.sep;
  if (!filePath.startsWith(root)) throw new Error('Caminho de mídia inválido.');

  try {
    await fs.promises.unlink(filePath);
    return { removed: true, missing: false };
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false, missing: true };
    throw new Error(`Não foi possível excluir o arquivo ${relative}: ${err.message}`);
  }
}

const uploadVideos = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 3, fields: 15, fieldNameSize: 100, fieldSize: 64 * 1024, fieldNestingDepth: 3 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Formato de vídeo não permitido. Use MP4, WebM ou MOV.'));
    }
    cb(null, true);
  }
});

// Conectar banco SQLite

// Inicializar banco. SQLite continua sendo usado localmente; em produção/Vercel,
// DATABASE_URL ativa PostgreSQL/Neon automaticamente.
function initDb() {
  if (db.mode === 'postgres') {
    return db.ready.then(() => true);
  }

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, tipo TEXT DEFAULT 'cliente', ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS imoveis (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, descricao TEXT, preco REAL NOT NULL, tipo TEXT NOT NULL, operacao TEXT NOT NULL, endereco TEXT NOT NULL, numero TEXT, bairro TEXT NOT NULL, cidade TEXT NOT NULL, cep TEXT, quartos INTEGER, banheiros INTEGER, area REAL, garagem INTEGER DEFAULT 0, piscina INTEGER DEFAULT 0, caracteristicas TEXT, destaque INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS imovel_midias (id INTEGER PRIMARY KEY AUTOINCREMENT, imovel_id INTEGER NOT NULL, tipo TEXT NOT NULL, arquivo TEXT NOT NULL, url_externa TEXT, ordem INTEGER DEFAULT 0, principal INTEGER DEFAULT 0, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT NOT NULL, whatsapp TEXT, mensagem TEXT, imovel_id INTEGER, tipo_interesse TEXT, status TEXT DEFAULT 'novo', criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
      db.all(`PRAGMA table_info(imoveis)`, (err, columns) => {
        if (err) return reject(err);
        if ((columns || []).some(c => c.name === 'caracteristicas')) return resolve(true);
        db.run(`ALTER TABLE imoveis ADD COLUMN caracteristicas TEXT`, err2 => {
          if (err2) return reject(err2);
          resolve(true);
        });
      });
    });
  });
}
const dbReady = initDb();

// Garante que o schema esteja pronto antes de qualquer operação de API.
app.use('/api', async (req, res, next) => {
  try { await dbReady; next(); } catch (err) {
    console.error('Falha ao inicializar banco:', err);
    res.status(503).json({ erro: 'Banco de dados indisponível. Configure DATABASE_URL no Vercel.' });
  }
});

// ============= AUTENTICAÇÃO =============
function getTokenFromRequest(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);

  const cookies = String(req.headers.cookie || '')
    .split(';')
    .map(v => v.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf('=');
      if (idx > -1) acc[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
      return acc;
    }, {});

  return cookies.auth_token || null;
}

function verificarToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

  try {
    const decoded = jwt.verify(token, SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    res.status(401).json({ erro: 'Token inválido' });
  }
}

function verificarCorretor(req, res, next) {
  verificarToken(req, res, () => {
    if (req.usuario.tipo !== 'corretor') {
      return res.status(403).json({ erro: 'Acesso restrito ao corretor' });
    }
    next();
  });
}

// Proteção real da página: localStorage sozinho não libera /dashboard.html.
// O acesso direto exige um cookie HttpOnly criado após login.
function protegerPaginaCorretor(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.redirect('/?login=1');

  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.tipo !== 'corretor') return res.redirect('/?login=1');
    next();
  } catch (err) {
    clearAuthCookie(res);
    return res.redirect('/?login=1');
  }
}

// Dashboard protegido antes do static.
app.get('/dashboard.html', protegerPaginaCorretor, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://fabianoreisimoveis.com.br').replace(/\/$/, '');
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const WHATSAPP_NUMBER = String(process.env.WHATSAPP_NUMBER || '5521991822134').replace(/\D/g, '');
function whatsappUrl(message) { return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`; }
function whatsappMessages(imovel) {
  const titulo = String(imovel?.titulo || 'este imóvel');
  const local = [imovel?.bairro, imovel?.cidade].filter(Boolean).join(' - ');
  const preco = Number(imovel?.preco || 0) > 0 ? Number(imovel.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
  const link = propertyCanonical(imovel?.id);
  const contexto = [titulo, local, preco].filter(Boolean).join(' | ');
  return {
    interesse: `Olá, Fabiano! Tenho interesse no imóvel ${contexto}. Gostaria de receber mais informações.\n\n${link}`,
    visita: `Olá, Fabiano! Gostaria de agendar uma visita ao imóvel ${contexto}.\n\n${link}`,
    pagamento: `Olá, Fabiano! Gostaria de saber as condições de pagamento do imóvel ${contexto}.\n\n${link}`,
    fotos: `Olá, Fabiano! Gostaria de receber mais fotos e detalhes do imóvel ${contexto}.\n\n${link}`
  };
}
function propertyCanonical(id) { return `${PUBLIC_SITE_URL}/imovel/${encodeURIComponent(id)}`; }

app.get('/sitemap.xml', (req, res) => {
  db.all('SELECT id, criado_em FROM imoveis WHERE ativo = 1 ORDER BY criado_em DESC', [], (err, rows) => {
    if (err) return res.status(500).type('text/plain').send('Sitemap indisponível');
    const urls = [{ loc: `${PUBLIC_SITE_URL}/`, changefreq: 'weekly', priority: '1.0' }];
    for (const row of (rows || [])) urls.push({ loc: propertyCanonical(row.id), changefreq: 'daily', priority: '0.8' });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `\n  <url><loc>${escapeXml(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('')}\n</urlset>`;
    res.type('application/xml').set('Cache-Control','public, max-age=300').send(xml);
  });
});

app.get('/imovel/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).send('Imóvel não encontrado');
  db.get('SELECT * FROM imoveis WHERE id = ? AND ativo = 1', [id], (err, imovel) => {
    if (err) return res.status(500).send('Erro ao carregar imóvel');
    if (!imovel) return res.status(404).send('Imóvel não encontrado');
    db.all('SELECT id, tipo, arquivo, url_externa, ordem, principal FROM imovel_midias WHERE imovel_id = ? ORDER BY principal DESC, ordem ASC, criado_em ASC', [id], (mediaErr, midias) => {
      if (mediaErr) return res.status(500).send('Erro ao carregar mídias');
      const media = midias || [];
      const image = media.find(m => m.tipo === 'imagem' && (m.arquivo || m.url_externa));
      const imageUrl = image ? (image.arquivo || image.url_externa) : `${PUBLIC_SITE_URL}/img/placeholder.svg`;
      const preco = Number(imovel.preco || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const title = `${imovel.titulo} | Fabiano Reis Imóveis`;
      const description = String(imovel.descricao || `${imovel.tipo} para ${imovel.operacao} em ${imovel.bairro}, ${imovel.cidade}. Preço ${preco}.`).replace(/\s+/g,' ').trim().slice(0,155);
      const jsonLd = JSON.stringify({
        '@context':'https://schema.org','@type':'RealEstateListing','name':imovel.titulo,'url':propertyCanonical(id),
        'description':description,'image':imageUrl,'datePosted':imovel.criado_em,
        'offers':{'@type':'Offer','price':Number(imovel.preco || 0),'priceCurrency':'BRL'},
        'address':{'@type':'PostalAddress','streetAddress':imovel.endereco || '', 'addressLocality':imovel.cidade || '', 'addressRegion':'RJ','addressCountry':'BR'}
      });
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${propertyCanonical(id)}"><meta property="og:type" content="product"><meta property="og:url" content="${propertyCanonical(id)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(imageUrl)}"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css"><style>main{max-width:1100px;margin:40px auto;padding:0 20px}.property-hero{display:grid;grid-template-columns:1.4fr 1fr;gap:28px}.property-hero img{width:100%;max-height:560px;object-fit:cover;border-radius:18px}.property-meta{background:#fff;border-radius:18px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.08)}.property-meta h1{margin-top:0}.property-price{font-size:2rem;font-weight:800}.property-features{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.property-feature{padding:8px 12px;background:#f1f5f9;border-radius:999px}.property-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:24px}.property-gallery img{width:100%;height:180px;object-fit:cover;border-radius:12px}@media(max-width:800px){.property-hero{grid-template-columns:1fr}}</style></head><body><main><a href="/">← Voltar para Fabiano Reis Imóveis</a><section class="property-hero"><div><img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(imovel.titulo)}"></div><div class="property-meta"><p>${escapeHtml(imovel.operacao || '')}</p><h1>${escapeHtml(imovel.titulo)}</h1><div class="property-price">${escapeHtml(preco)}</div><p>📍 ${escapeHtml(imovel.bairro)}, ${escapeHtml(imovel.cidade)}</p><div class="property-features">${imovel.quartos ? `<span class="property-feature">🛏️ ${imovel.quartos} quartos</span>`:''}${imovel.banheiros ? `<span class="property-feature">🚿 ${imovel.banheiros} banheiros</span>`:''}${imovel.area ? `<span class="property-feature">📐 ${imovel.area} m²</span>`:''}${imovel.garagem ? `<span class="property-feature">🚗 ${imovel.garagem} vagas</span>`:''}</div><p>${escapeHtml(imovel.descricao || 'Consulte a imobiliária para mais informações.')}</p><div class="property-whatsapp-actions"><a class="btn-primary" href="${whatsappUrl(whatsappMessages(imovel).interesse)}" target="_blank" rel="noopener noreferrer">📲 Tenho interesse</a><a class="btn-whatsapp-secondary" href="${whatsappUrl(whatsappMessages(imovel).visita)}" target="_blank" rel="noopener noreferrer">📅 Agendar visita</a><a class="btn-whatsapp-secondary" href="${whatsappUrl(whatsappMessages(imovel).pagamento)}" target="_blank" rel="noopener noreferrer">💰 Condições de pagamento</a><a class="btn-whatsapp-secondary" href="${whatsappUrl(whatsappMessages(imovel).fotos)}" target="_blank" rel="noopener noreferrer">📸 Mais fotos</a></div></div></section><section><h2>Fotos e vídeos</h2><div class="property-gallery">${media.filter(m=>m.tipo==='imagem' && (m.arquivo||m.url_externa)).map(m=>`<img loading="lazy" src="${escapeAttr(m.arquivo||m.url_externa)}" alt="${escapeAttr(imovel.titulo)}">`).join('')}</div></section></main><script type="application/ld+json">${jsonLd}</script></body></html>`;
      res.type('html').set('Cache-Control','public, max-age=300').send(html);
    });
  });
});

// Mídia persistente da Hostinger: /uploads/* aponta para MEDIA_ROOT.
if (!USE_BLOB) {
  app.use('/uploads', express.static(LOCAL_MEDIA_ROOT, {
    fallthrough: true,
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); }
  }));
}

// Arquivos públicos
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('dashboard.js') || filePath.endsWith('dashboard.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ============= ROTAS DE AUTENTICAÇÃO =============
// Cookies de sessão: HttpOnly sempre; Secure em produção.
function setAuthCookie(res, token, maxAge = 86400) {
  const secure = IS_VERCEL || process.env.NODE_ENV === 'production';
  const parts = [
    `auth_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
  const secure = IS_VERCEL || process.env.NODE_ENV === 'production';
  const parts = ['auth_token=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}


// Limitador simples de tentativas de login por IP (memória do processo).
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimit(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido').split(',')[0].trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ erro: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
  }
  next();
}

const publicRateBuckets = new Map();
function publicRateLimit(name, windowMs, max) {
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'desconhecido');
    const key = `${name}:${ip}`;
    const now = Date.now();
    const current = publicRateBuckets.get(key);
    if (!current || now - current.start >= windowMs) {
      publicRateBuckets.set(key, { start: now, count: 1 });
      return next();
    }
    current.count += 1;
    if (current.count > max) return res.status(429).json({ erro: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' });
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, value] of publicRateBuckets) if (value.start < cutoff) publicRateBuckets.delete(key);
  for (const [key, value] of loginAttempts) if (value.start < cutoff) loginAttempts.delete(key);
}, 10 * 60 * 1000).unref();

app.post('/api/login', loginRateLimit, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');

  if (!email || !senha || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ erro: 'Informe e-mail e senha válidos.' });
  }

  db.get("SELECT * FROM usuarios WHERE email = ? AND ativo = 1", [email], (err, user) => {
    if (err) return res.status(500).json({ erro: 'Erro do servidor' });

    // Resposta genérica para reduzir enumeração de contas.
    if (!user || !bcrypt.compareSync(senha, user.senha)) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, tipo: user.tipo },
      SECRET,
      { expiresIn: '24h' }
    );

    loginAttempts.delete(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido').split(',')[0].trim());
    setAuthCookie(res, token);
    res.json({ tipo: user.tipo, nome: user.nome, id: user.id });
  });
});
app.post('/api/register', publicRateLimit('register', 10 * 60 * 1000, 5), (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');

  if (nome.length < 2 || nome.length > 120) {
    return res.status(400).json({ erro: 'Informe um nome válido.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  if (senha.length < 8 || senha.length > 200) {
    return res.status(400).json({ erro: 'A senha deve ter ao menos 8 caracteres.' });
  }

  const senhaHash = bcrypt.hashSync(senha, 10);
  db.run(
    "INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)",
    [nome, email, senhaHash, 'cliente'],
    function(err) {
      if (err) {
        if (/unique|duplicate/i.test(err.message || '')) {
          return res.status(400).json({ erro: 'Email já cadastrado' });
        }
        return res.status(500).json({ erro: 'Erro ao registrar' });
      }
      const token = jwt.sign({ id: this.lastID, email: email, tipo: 'cliente' }, SECRET, { expiresIn: '24h' });
      res.json({ token, tipo: 'cliente', nome: nome });
    }
  );
});

// ============= ROTAS DE IMÓVEIS =============

app.get('/api/imoveis', (req, res) => {
  const { tipo, operacao, cidade, preco_max } = req.query;
  let query = "SELECT * FROM imoveis WHERE ativo = 1";
  let params = [];

  if (tipo) {
    query += " AND tipo = ?";
    params.push(tipo);
  }
  if (operacao) {
    query += " AND operacao = ?";
    params.push(operacao);
  }
  if (cidade) {
    query += " AND cidade LIKE ?";
    params.push(`%${cidade}%`);
  }
  if (preco_max) {
    query += " AND preco <= ?";
    params.push(preco_max);
  }

  query += " ORDER BY destaque DESC, criado_em DESC";

  db.all(query, params, (err, imoveis) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar' });
    const lista = imoveis || [];
    if (!lista.length) return res.json({ imoveis: [] });
    const ids = lista.map(item => item.id);
    const placeholders = ids.map(() => '?').join(',');
    db.all(
      `SELECT id, imovel_id, tipo, arquivo, url_externa, ordem, principal, criado_em
       FROM imovel_midias WHERE imovel_id IN (${placeholders})
       ORDER BY principal DESC, ordem ASC, criado_em DESC`,
      ids,
      (mediaErr, midias) => {
        if (mediaErr) return res.status(500).json({ erro: 'Erro ao buscar mídias dos imóveis' });
        const byProperty = new Map();
        for (const media of (midias || [])) {
          if (!byProperty.has(media.imovel_id)) byProperty.set(media.imovel_id, []);
          byProperty.get(media.imovel_id).push(media);
        }
        for (const item of lista) item.midias = byProperty.get(item.id) || [];
        res.json({ imoveis: lista });
      }
    );
  });
});


// Lista completa para o painel do corretor, incluindo imóveis inativos.
app.get('/api/admin/imoveis', verificarCorretor, (req, res) => {
  db.all("SELECT * FROM imoveis ORDER BY ativo DESC, destaque DESC, criado_em DESC", [], (err, imoveis) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar imóveis do painel' });
    res.json({ imoveis });
  });
});

app.get('/api/imoveis/:id', (req, res) => {
  const { id } = req.params;
  let autorizadoPainel = false;
  const tokenReq = getTokenFromRequest(req);
  if (tokenReq) {
    try {
      const decoded = jwt.verify(tokenReq, SECRET);
      autorizadoPainel = decoded.tipo === 'corretor';
    } catch (_) {}
  }

  const sql = autorizadoPainel
    ? "SELECT * FROM imoveis WHERE id = ?"
    : "SELECT * FROM imoveis WHERE id = ? AND ativo = 1";

  db.get(sql, [id], (err, imovel) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar imóvel' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    db.all("SELECT * FROM imovel_midias WHERE imovel_id = ? ORDER BY principal DESC, ordem ASC, criado_em DESC", [id], (err, midias) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar fotos do imóvel' });
      imovel.midias = midias || [];
      res.json({ imovel });
    });
  });
});

app.post('/api/imoveis', verificarCorretor, (req, res) => {
  const { titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque, caracteristicas } = req.body;
  const listaCaracteristicas = Array.isArray(caracteristicas) ? caracteristicas.map(v => String(v).trim()).filter(Boolean).slice(0, 100) : [];

  db.run(
    `INSERT INTO imoveis (titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, caracteristicas, destaque)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, JSON.stringify(listaCaracteristicas), destaque || 0],
    function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao criar' });
      res.json({ id: this.lastID, mensagem: 'Imóvel criado com sucesso' });
    }
  );
});

app.put('/api/imoveis/:id', verificarCorretor, (req, res) => {
  const { id } = req.params;
  const camposPermitidos = [
    'titulo','descricao','preco','tipo','operacao','endereco','numero',
    'bairro','cidade','cep','quartos','banheiros','area','garagem',
    'piscina','caracteristicas','destaque','ativo'
  ];

  const entradas = Object.entries(req.body || {})
    .filter(([campo, valor]) => camposPermitidos.includes(campo) && valor !== undefined);

  if (!entradas.length) {
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });
  }

  const sets = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([campo, valor]) => {
    if (['piscina','destaque','ativo'].includes(campo)) return Number(Boolean(valor));
    if (campo === 'caracteristicas') { const lista = Array.isArray(valor) ? valor.map(v => String(v).trim()).filter(Boolean).slice(0, 100) : []; return JSON.stringify(lista); }
    if (['quartos','banheiros','garagem'].includes(campo)) return Number(valor) || 0;
    if (['preco','area'].includes(campo)) return Number(valor) || 0;
    return valor;
  });

  db.run(`UPDATE imoveis SET ${sets} WHERE id = ?`, [...valores, id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar imóvel' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    res.json({ mensagem: 'Imóvel atualizado com sucesso' });
  });
});


// Desativação lógica de imóvel (mantém histórico no banco)
app.delete('/api/imoveis/:id', verificarCorretor, (req, res) => {
  const { id } = req.params;
  db.run("UPDATE imoveis SET ativo = 0 WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao desativar imóvel' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    res.json({ mensagem: 'Imóvel desativado com sucesso' });
  });
});

// Exclusão definitiva: remove o imóvel, as mídias no banco e os arquivos associados.
// É separada da desativação lógica para evitar apagar anúncios por engano.
app.post('/api/imoveis/:id/excluir-definitivo', verificarCorretor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID de imóvel inválido' });
  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id, titulo FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    const midias = await new Promise((resolve, reject) => db.all('SELECT id, arquivo FROM imovel_midias WHERE imovel_id = ?', [id], (err, rows) => err ? reject(err) : resolve(rows || [])));
    await new Promise((resolve, reject) => db.run('UPDATE leads SET imovel_id = NULL WHERE imovel_id = ?', [id], err => err ? reject(err) : resolve()));
    if (db.mode === 'postgres') {
      await new Promise((resolve, reject) => db.run('DELETE FROM imoveis WHERE id = ?', [id], function(err) { if (err) reject(err); else if (this.changes !== 1) reject(Object.assign(new Error('Imóvel não encontrado'), {statusCode:404})); else resolve(); }));
    } else {
      await new Promise((resolve, reject) => db.run('DELETE FROM imovel_midias WHERE imovel_id = ?', [id], err => err ? reject(err) : resolve()));
      await new Promise((resolve, reject) => db.run('DELETE FROM imoveis WHERE id = ?', [id], function(err) { if (err) reject(err); else if (this.changes !== 1) reject(Object.assign(new Error('Imóvel não encontrado'), {statusCode:404})); else resolve(); }));
    }
    let falhasArquivos = 0;
    for (const media of midias) {
      try { await removeStoredAsset(media.arquivo); } catch (err) { falhasArquivos += 1; console.warn('[MÍDIA] Falha ao limpar mídia', media.id, err.message); }
    }
    res.json({ mensagem: falhasArquivos ? 'Imóvel excluído. Algumas mídias precisam de limpeza manual.' : 'Imóvel e mídias excluídos definitivamente com sucesso.', id, midiasExcluidas: midias.length, falhasArquivos });
  } catch (err) {
    console.error('[IMÓVEL] Exclusão definitiva falhou:', err);
    res.status(err.statusCode || 500).json({ erro: err.message || 'Erro ao excluir imóvel' });
  }
});

app.post('/api/auth/change-password', verificarCorretor, (req, res) => {
  const senhaAtual = String(req.body?.senhaAtual || '');
  const novaSenha = String(req.body?.novaSenha || '');
  const confirmarSenha = String(req.body?.confirmarSenha || '');

  if (!senhaAtual || !novaSenha || !confirmarSenha) {
    return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
  }
  if (novaSenha !== confirmarSenha) {
    return res.status(400).json({ erro: 'A nova senha e a confirmação não coincidem.' });
  }
  if (novaSenha.length < 12 || novaSenha.length > 200) {
    return res.status(400).json({ erro: 'A nova senha deve ter entre 12 e 200 caracteres.' });
  }
  if (novaSenha === senhaAtual) {
    return res.status(400).json({ erro: 'A nova senha deve ser diferente da senha atual.' });
  }

  db.get('SELECT id, email, nome, tipo, senha FROM usuarios WHERE id = ? AND ativo = 1', [req.usuario.id], (err, user) => {
    if (err) return res.status(500).json({ erro: 'Erro do servidor.' });
    if (!user || user.tipo !== 'corretor' || !bcrypt.compareSync(senhaAtual, user.senha)) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const senhaHash = bcrypt.hashSync(novaSenha, 12);
    db.run('UPDATE usuarios SET senha = ? WHERE id = ? AND ativo = 1', [senhaHash, user.id], function(updateErr) {
      if (updateErr) return res.status(500).json({ erro: 'Não foi possível alterar a senha.' });

      const token = jwt.sign(
        { id: user.id, email: user.email, tipo: user.tipo },
        SECRET,
        { expiresIn: '24h' }
      );
      setAuthCookie(res, token);
      return res.json({ mensagem: 'Senha alterada com sucesso.' });
    });
  });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ mensagem: 'Sessão encerrada' });
});

// Verificação de sessão do painel
app.get('/api/auth/check', verificarCorretor, (req, res) => {
  res.json({ autenticado: true, usuario: req.usuario });
});

// Health check para diagnóstico local
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    servico: 'fabiano-reis-imoveis',
    timestamp: new Date().toISOString(),
    banco: db.mode,
    armazenamentoMidia: USE_BLOB ? 'blob' : 'local',
    uploadDiretoBlob: Boolean(IS_VERCEL && USE_BLOB)
  });
});

// Configuração pública mínima usada pelo painel para escolher o fluxo de upload.
// Não expõe segredos nem credenciais.
app.get('/api/config', (req, res) => {
  res.json({
    armazenamentoMidia: USE_BLOB ? 'blob' : 'local',
    uploadDiretoBlob: Boolean(IS_VERCEL && USE_BLOB),
    maxFotoMB: 5,
    maxVideoMB: 50
  });
});

// ============= ROTAS DE UPLOAD =============
// Upload direto do navegador para Vercel Blob. Necessário para arquivos > 4,5 MB,
// pois Vercel Functions possuem limite de corpo de requisição para uploads server-side.
app.post('/api/blob/upload', async (req, res) => {
  if (!USE_BLOB) return res.status(404).json({ erro: 'Upload direto em Blob está disponível apenas com DATABASE_URL.' });
  const body = req.body || {};
  const isCallback = body.type === 'blob.upload-completed';
  if (!isCallback) {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    try {
      const decoded = jwt.verify(token, SECRET);
      if (decoded.tipo !== 'corretor') return res.status(403).json({ erro: 'Acesso restrito ao corretor' });
    } catch (_) { return res.status(401).json({ erro: 'Token inválido' }); }
  }
  try {
    const { handleUpload } = require('@vercel/blob/client');
    const payload = body.clientPayload ? (() => { try { return JSON.parse(body.clientPayload); } catch (_) { return {}; } })() : {};
    const imovelId = Number(payload.imovelId);
    const kind = payload.kind === 'video' ? 'video' : 'imagem';

    if (!Number.isInteger(imovelId) || imovelId <= 0) {
      return res.status(400).json({ erro: 'Imóvel inválido para o upload.' });
    }

    const imovel = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM imoveis WHERE id = ?', [imovelId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado.' });
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: kind === 'video'
          ? ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
          : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        maximumSizeInBytes: kind === 'video' ? 50 * 1024 * 1024 : 5 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ kind })
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log(`[BLOB] Upload concluído: ${blob.url}`);
      }
    });
    res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('Erro no upload direto Blob:', err);
    res.status(400).json({ erro: err.message || 'Falha no upload direto' });
  }
});


app.post('/api/upload', verificarCorretor, upload.single('imagem'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: 'Arquivo não enviado' });
  }

  try {
    await validateUploadedFile(req.file, 'image');
    const arquivo = await storeUploadedFile(req.file, 'imagens');

    res.json({
      mensagem: 'Imagem enviada com sucesso',
      arquivo
    });
  } catch (err) {
    console.error('[UPLOAD] ERRO:', {
      message: err?.message || null,
      name: err?.name || null,
      code: err?.code || null,
      stack: err?.stack || null,
      useBlob: USE_BLOB,
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL)
    });

    res.status(500).json({
      erro: err?.message || 'Erro ao armazenar imagem',
      codigo: err?.code || null
    });
  }
});

// Upload de várias fotos já vinculadas a um imóvel




const uploadFotos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!permitidos.includes(file.mimetype)) return cb(new Error('Formato de imagem não permitido'));
    cb(null, true);
  }
});

// Uma foto por requisição. Isso evita uploads multipart grandes parcialmente processados
// na Hostinger e permite identificar exatamente qual arquivo falhou.
app.post('/api/imoveis/:id/fotos', verificarCorretor, uploadFotos.single('imagens'), async (req, res) => {
  const { id } = req.params;
  let arquivoSalvo = null;

  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    const file = req.file;
    if (!file) return res.status(400).json({ erro: 'Nenhuma foto enviada' });

    const row = await new Promise((resolve, reject) => db.get("SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem'", [id], (err, value) => err ? reject(err) : resolve(value)));
    const mainRow = await new Promise((resolve, reject) => db.get("SELECT COUNT(*) AS principal FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1", [id], (err, value) => err ? reject(err) : resolve(value)));
    const ordem = Number(row?.total || 0);
    const principal = Number(mainRow?.principal || 0) === 0 ? 1 : 0;

    arquivoSalvo = await storeUploadedFile(file, 'imagens');
    const result = await new Promise((resolve, reject) => db.run(
      `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'imagem', ?, '', ?, ?)`,
      [id, arquivoSalvo, ordem, principal],
      function(err) { err ? reject(err) : resolve(this); }
    ));

    console.log(`[UPLOAD-FOTOS] Foto ${result.lastID} salva para imóvel ${id}: ${arquivoSalvo}`);
    return res.json({
      mensagem: 'Foto enviada com sucesso',
      imagem: { id: result.lastID, arquivo: arquivoSalvo, principal: Boolean(principal) },
      imagens: [arquivoSalvo]
    });
  } catch (err) {
    if (arquivoSalvo) {
      try { await removeStoredAsset(arquivoSalvo); } catch (cleanupErr) {
        console.error('[UPLOAD-FOTOS] Falha ao limpar arquivo após erro:', cleanupErr.message);
      }
    }
    console.error('[UPLOAD-FOTOS] ERRO:', { message: err?.message, code: err?.code, stack: err?.stack, imovelId: id });
    return res.status(500).json({ erro: err?.message || 'Erro ao salvar a foto', codigo: err?.code || null });
  }
});

// ============= ROTAS DE VÍDEOS =============

// Lista todos os vídeos de um imóvel.
app.get('/api/imoveis/:id/videos', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, ordem, criado_em
     FROM imovel_midias
     WHERE imovel_id = ? AND tipo = 'video' AND EXISTS (SELECT 1 FROM imoveis WHERE imoveis.id = imovel_midias.imovel_id AND imoveis.ativo = 1)
     ORDER BY ordem ASC, criado_em DESC`,
    [id],
    (err, videos) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar vídeos' });
      res.json({ videos: videos || [] });
    }
  );
});

// Lista mídias (fotos + vídeos) para a área pública.
app.get('/api/imoveis/:id/midias', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, ordem, principal, criado_em
     FROM imovel_midias
     WHERE imovel_id = ? AND EXISTS (SELECT 1 FROM imoveis WHERE imoveis.id = imovel_midias.imovel_id AND imoveis.ativo = 1)
     ORDER BY CASE WHEN principal = 1 THEN 0 ELSE 1 END, ordem ASC, criado_em DESC`,
    [id],
    (err, midias) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar mídias' });
      res.json({ midias: midias || [] });
    }
  );
});

// Upload de até 3 vídeos, 50 MB por arquivo.
app.post('/api/imoveis/:id/videos', verificarCorretor, uploadVideos.array('videos', 3), async (req, res) => {
  const { id } = req.params;
  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    const arquivos = req.files || [];
    if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum vídeo enviado' });
    const row = await new Promise((resolve, reject) => db.get(`SELECT COALESCE(MAX(ordem), -1) AS ordem FROM imovel_midias WHERE imovel_id = ? AND tipo = 'video'`, [id], (err, value) => err ? reject(err) : resolve(value)));
    const ordemInicial = Number(row?.ordem ?? -1) + 1;
    const videos = [];
    for (let index = 0; index < arquivos.length; index++) {
      const file = arquivos[index];
      await validateUploadedFile(file, 'video');
      const arquivo = await storeUploadedFile(file, 'videos');
      const result = await new Promise((resolve, reject) => db.run(
        `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'video', ?, '', ?, 0)`,
        [id, arquivo, ordemInicial + index], function(err) { err ? reject(err) : resolve(this); }
      ));
      videos.push({ id: result.lastID, arquivo });
    }
    res.json({ mensagem: `${arquivos.length} vídeo(s) enviado(s) com sucesso`, videos: videos.map(v => v.arquivo) });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao salvar os vídeos' });
  }
});

// Registra no banco um vídeo que já foi enviado diretamente ao Vercel Blob.
app.post('/api/imoveis/:id/videos/blob', verificarCorretor, async (req, res) => {
  const { id } = req.params;
  const arquivo = String(req.body?.arquivo || '').trim();
  if (!/^https:\/\/[^\s]+\.blob\.vercel-storage\.com\//i.test(arquivo)) {
    return res.status(400).json({ erro: 'URL do Vercel Blob inválida.' });
  }
  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    const row = await new Promise((resolve, reject) => db.get(`SELECT COALESCE(MAX(ordem), -1) AS ordem FROM imovel_midias WHERE imovel_id = ? AND tipo = 'video'`, [id], (err, value) => err ? reject(err) : resolve(value)));
    const result = await new Promise((resolve, reject) => db.run(
      `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'video', ?, '', ?, 0)`,
      [id, arquivo, Number(row?.ordem ?? -1) + 1], function(err) { err ? reject(err) : resolve(this); }
    ));
    res.json({ id: result.lastID, mensagem: 'Vídeo enviado ao armazenamento e cadastrado com sucesso', arquivo });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao registrar vídeo' });
  }
});

// Adicionar vídeo por URL direta (MP4/WebM/MOV ou URL externa compatível).
app.post('/api/imoveis/:id/videos/url', verificarCorretor, (req, res) => {
  const { id } = req.params;
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ erro: 'Informe uma URL http(s) válida.' });

  db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, imovel) => {
    if (err) return res.status(500).json({ erro: 'Erro ao verificar imóvel' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    db.get(`SELECT COALESCE(MAX(ordem), -1) AS ordem FROM imovel_midias WHERE imovel_id = ? AND tipo = 'video'`,
      [id], (ordErr, row) => {
        if (ordErr) return res.status(500).json({ erro: 'Erro ao organizar vídeos' });
        db.run(
          `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal)
           VALUES (?, 'video', '', ?, ?, 0)`,
          [id, url, Number(row?.ordem ?? -1) + 1],
          function(insertErr) {
            if (insertErr) return res.status(500).json({ erro: 'Erro ao salvar URL do vídeo' });
            res.json({ id: this.lastID, mensagem: 'Vídeo adicionado por URL com sucesso' });
          }
        );
      });
  });
});

app.delete('/api/imoveis/:imovelId/videos/:videoId', verificarCorretor, (req, res) => {
  const { imovelId, videoId } = req.params;
  db.get(
    `SELECT * FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'video'`,
    [videoId, imovelId],
    async (err, video) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar vídeo' });
      if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' });
      try {
        // Remove o arquivo primeiro. Se o armazenamento falhar, o registro
        // permanece no banco para permitir uma nova tentativa sem perder a referência.
        const storageResult = await removeStoredAsset(video.arquivo);
        const deleted = await new Promise((resolve, reject) => db.run(
          `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'video'`,
          [videoId, imovelId],
          function(deleteErr) { deleteErr ? reject(deleteErr) : resolve(this.changes); }
        ));
        if (deleted !== 1) return res.status(404).json({ erro: 'Vídeo não encontrado' });
        return res.json({ mensagem: 'Vídeo excluído com sucesso', storageResult });
      } catch (deleteErr) {
        console.error('[MÍDIA] Erro ao excluir vídeo:', deleteErr);
        return res.status(500).json({ erro: deleteErr.message || 'Erro ao excluir vídeo' });
      }
    }
  );
});


// Resolve URLs de redes sociais para a imagem de compartilhamento (Open Graph)
// e baixa uma cópia local para que a foto não dependa da rede social depois.
const SOCIAL_IMAGE_HOSTS = new Set([
  'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'threads.net', 'www.threads.net',
  'pinterest.com', 'www.pinterest.com',
  'tiktok.com', 'www.tiktok.com',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'
]);

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === '::1') return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [a,b,c,d] = ipv4.slice(1).map(Number);
  if ([a,b,c,d].some(n => n > 255)) return true;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
}
function assertSafeHttpUrl(value) {
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol)) throw new Error('URL remota não permitida.');
  if (isPrivateHostname(u.hostname)) throw new Error('Destino de rede privada não permitido.');
  return u;
}

function isSocialMediaUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? SOCIAL_IMAGE_HOSTS.has(u.hostname.toLowerCase())
      : false;
  } catch (_) { return false; }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function extractSocialImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1]);
  }
  return '';
}

function extensionForMime(mime) {
  const m = String(mime || '').split(';')[0].toLowerCase();
  return ({
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/avif': '.avif'
  })[m] || '';
}

async function importSocialImage(sourceUrl) {
  if (!isSocialMediaUrl(sourceUrl)) {
    throw new Error('Informe uma URL pública do Instagram, Facebook, Threads, Pinterest, TikTok, X/Twitter ou uma URL direta de imagem.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    assertSafeHttpUrl(sourceUrl);
    const page = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!page.ok) throw new Error(`A rede social respondeu HTTP ${page.status}.`);
    const html = await page.text();
    let imageUrl = extractSocialImage(html);
    if (!imageUrl) throw new Error('Não foi possível localizar a imagem pública desta publicação. A rede social pode exigir login ou bloquear a leitura automática.');
    imageUrl = new URL(imageUrl, page.url || sourceUrl).toString();
    assertSafeHttpUrl(imageUrl);

    const imgController = new AbortController();
    const imgTimer = setTimeout(() => imgController.abort(), 12000);
    try {
      const imageResponse = await fetch(imageUrl, {
        signal: imgController.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
      });
      if (!imageResponse.ok) throw new Error(`Não foi possível baixar a imagem (HTTP ${imageResponse.status}).`);
      const mime = imageResponse.headers.get('content-type') || '';
      const ext = extensionForMime(mime);
      if (!ext) throw new Error('A publicação não forneceu uma imagem em formato compatível (JPG, PNG, WEBP, GIF ou AVIF).');
      const data = Buffer.from(await imageResponse.arrayBuffer());
      if (data.length > 8 * 1024 * 1024) throw new Error('A imagem da rede social excede o limite de 8 MB.');

      const filename = `${Date.now()}-social-${crypto.randomUUID().slice(0, 8)}${ext}`;
      const arquivo = await storeBuffer(data, filename, mime.split(';')[0], 'imagens');
      return { arquivo, fonte_social: sourceUrl };
    } finally { clearTimeout(imgTimer); }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tempo esgotado ao acessar a rede social.');
    throw err;
  } finally { clearTimeout(timer); }
}


// ============= ROTAS DE IMAGENS =============

app.get('/api/imoveis/:id/imagens', (req, res) => {
  const { id } = req.params;

  db.all(
    "SELECT id, imovel_id, arquivo, url_externa, ordem, principal, criado_em FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND EXISTS (SELECT 1 FROM imoveis WHERE imoveis.id = imovel_midias.imovel_id AND imoveis.ativo = 1) ORDER BY ordem ASC, criado_em DESC",
    [id],
    (err, imagens) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar imagens' });
      res.json({ imagens: imagens || [] });
    }
  );
});

app.post('/api/imoveis/:id/imagens/blob', verificarCorretor, (req, res) => {
  const { id } = req.params;
  const arquivo = String(req.body?.arquivo || '').trim();

  if (!/^https:\/\/[^\s]+\.blob\.vercel-storage\.com\//i.test(arquivo)) {
    return res.status(400).json({ erro: 'Informe uma URL válida do Vercel Blob.' });
  }

  db.get('SELECT id FROM imoveis WHERE id = ?', [id], (checkErr, imovel) => {
    if (checkErr) return res.status(500).json({ erro: 'Erro ao verificar imóvel' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    db.get(
      `SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1`,
      [id],
      (mainErr, row) => {
        if (mainErr) return res.status(500).json({ erro: 'Erro ao verificar foto principal' });
        const principal = Number(row?.total || 0) === 0 ? 1 : 0;

        db.run(
          `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal)
           VALUES (?, 'imagem', ?, '', COALESCE((SELECT MAX(ordem)+1 FROM imovel_midias WHERE imovel_id = ?), 0), ?)`,
          [id, arquivo, id, principal],
          function(insertErr) {
            if (insertErr) return res.status(500).json({ erro: 'Erro ao registrar imagem' });
            res.json({ id: this.lastID, arquivo, principal });
          }
        );
      }
    );
  });
});

app.post('/api/imoveis/:id/imagens', verificarCorretor, (req, res) => {
  const { id } = req.params;
  const { arquivo, url_externa, principal } = req.body;

  if (!arquivo && !url_externa) {
    return res.status(400).json({ erro: 'Forneça arquivo ou URL' });
  }

  if (url_externa && !/^https?:\/\//i.test(String(url_externa))) {
    return res.status(400).json({ erro: 'A URL da imagem precisa começar com http:// ou https://' });
  }

  // Se for uma publicação de rede social, importa a imagem para o servidor.
  if (url_externa && isSocialMediaUrl(String(url_externa))) {
    db.get('SELECT id FROM imoveis WHERE id = ?', [id], async (checkErr, imovel) => {
      if (checkErr) return res.status(500).json({ erro: 'Erro ao verificar imóvel' });
      if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
      try {
        const imported = await importSocialImage(String(url_externa));
        db.get(`SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1`, [id], (mainErr, row) => {
          if (mainErr) return res.status(500).json({ erro: 'Erro ao verificar foto principal' });
          const tornarPrincipal = Number(principal) === 1 || Number(row?.total || 0) === 0;
          db.run(
            "INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'imagem', ?, ?, COALESCE((SELECT MAX(ordem)+1 FROM imovel_midias WHERE imovel_id = ?), 0), ?)",
            [id, imported.arquivo, String(url_externa), id, tornarPrincipal ? 1 : 0],
            function(insertErr) {
              if (insertErr) return res.status(500).json({ erro: 'Erro ao salvar imagem importada' });
              res.json({ id: this.lastID, mensagem: 'Imagem da rede social importada para o servidor com sucesso', principal: tornarPrincipal, arquivo: imported.arquivo, fonte_social: String(url_externa) });
            }
          );
        });
      } catch (e) {
        return res.status(422).json({ erro: e.message });
      }
    });
    return;
  }

  db.get('SELECT id FROM imoveis WHERE id = ?', [id], (checkErr, imovel) => {
    if (checkErr) return res.status(500).json({ erro: 'Erro ao verificar imóvel' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    db.get(
      `SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1`,
      [id],
      (mainErr, row) => {
        if (mainErr) return res.status(500).json({ erro: 'Erro ao verificar foto principal' });

        const tornarPrincipal = Number(principal) === 1 || Number(row?.total || 0) === 0;

        db.run(
          "INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(ordem)+1 FROM imovel_midias WHERE imovel_id = ?), 0), ?)",
          [id, 'imagem', arquivo || '', url_externa || '', id, tornarPrincipal ? 1 : 0],
          function(insertErr) {
            if (insertErr) return res.status(500).json({ erro: 'Erro ao adicionar imagem' });
            res.json({ id: this.lastID, mensagem: 'Imagem adicionada com sucesso', principal: tornarPrincipal });
          }
        );
      }
    );
  });
});

async function excluirImagemDefinitivamente(imovelId, imagemId) {
  const imagem = await new Promise((resolve, reject) => db.get(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, principal FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
    [imagemId, imovelId],
    (err, row) => err ? reject(err) : resolve(row)
  ));
  if (!imagem) { const err = new Error('Foto não encontrada neste imóvel'); err.statusCode = 404; throw err; }

  // Primeiro garante que o arquivo local/Blob pode ser removido.
  // ENOENT é tratado como já removido, permitindo limpar registros órfãos.
  const storageResult = await removeStoredAsset(imagem.arquivo);

  const deleted = await new Promise((resolve, reject) => db.run(
    `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
    [imagemId, imovelId],
    function(err) { err ? reject(err) : resolve(this.changes); }
  ));
  if (deleted !== 1) { const err = new Error('Foto não encontrada neste imóvel'); err.statusCode = 404; throw err; }

  let novaPrincipal = false;
  let novaPrincipalId = null;
  if (Number(imagem.principal)) {
    const proxima = await new Promise((resolve, reject) => db.get(
      `SELECT id FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' ORDER BY ordem ASC, criado_em ASC LIMIT 1`,
      [imovelId],
      (err, row) => err ? reject(err) : resolve(row)
    ));
    if (proxima) {
      await new Promise((resolve, reject) => db.run(
        'UPDATE imovel_midias SET principal = 1 WHERE id = ? AND imovel_id = ? AND tipo = ?',
        [proxima.id, imovelId, 'imagem'],
        function(err) { err ? reject(err) : resolve(this); }
      ));
      novaPrincipal = true;
      novaPrincipalId = Number(proxima.id);
    }
  }

  return {
    storageResult,
    novaPrincipal,
    novaPrincipalId,
    mensagem: novaPrincipal ? 'Foto excluída e nova foto principal definida com sucesso' : 'Foto excluída com sucesso'
  };
}

async function responderExclusaoImagem(req, res) {
  const { imovelId, imagemId } = req.params;
  try {
    const resultado = await excluirImagemDefinitivamente(imovelId, imagemId);
    console.log(`[MÍDIA] Foto ${imagemId} excluída do imóvel ${imovelId}`, resultado.storageResult);
    return res.json(resultado);
  } catch (err) {
    console.error(`[MÍDIA] Erro ao excluir foto ${imagemId} do imóvel ${imovelId}:`, err);
    return res.status(err.statusCode || 500).json({ erro: err.message || 'Erro ao excluir foto' });
  }
}

app.delete('/api/imoveis/:imovelId/imagens/:imagemId', verificarCorretor, responderExclusaoImagem);
app.post('/api/imoveis/:imovelId/imagens/:imagemId/excluir', verificarCorretor, responderExclusaoImagem);

app.put('/api/imoveis/:imovelId/imagens/:imagemId/principal', verificarCorretor, (req, res) => {
  const { imovelId, imagemId } = req.params;

  db.get(
    `SELECT id FROM imovel_midias
     WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
    [imagemId, imovelId],
    (err, imagem) => {
      if (err) return res.status(500).json({ erro: 'Erro ao verificar foto' });
      if (!imagem) return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });

      db.serialize(() => {
        db.run('UPDATE imovel_midias SET principal = 0 WHERE imovel_id = ? AND tipo = ?', [imovelId, 'imagem'], clearErr => {
          if (clearErr) return res.status(500).json({ erro: 'Erro ao limpar foto principal anterior' });

          db.run(
            'UPDATE imovel_midias SET principal = 1 WHERE id = ? AND imovel_id = ? AND tipo = ?',
            [imagemId, imovelId, 'imagem'],
            function(setErr) {
              if (setErr) return res.status(500).json({ erro: 'Erro ao definir foto principal' });
              if (this.changes !== 1) return res.status(404).json({ erro: 'Foto não encontrada' });
              res.json({ mensagem: 'Foto principal atualizada', principalId: Number(imagemId) });
            }
          );
        });
      });
    }
  );
});

// A criação de mídia deve ocorrer por rotas específicas que validam o imóvel e o tipo.


// (Rota duplicada de foto principal removida na V6.2 — a definição válida está acima.)

// ============= ROTAS DE LEADS =============

app.post('/api/leads', publicRateLimit('lead', 10 * 60 * 1000, 8), (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const telefone = String(req.body?.telefone || '').trim();
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const mensagem = String(req.body?.mensagem || '').trim();
  const imovel_id = req.body?.imovel_id;
  const tipo_interesse = String(req.body?.tipo_interesse || '').trim();
  const imovelId = imovel_id == null || imovel_id === '' ? null : Number(imovel_id);

  if (imovelId !== null && (!Number.isInteger(imovelId) || imovelId <= 0)) return res.status(400).json({ erro: 'Imóvel inválido.' });

  if (nome.length < 2 || nome.length > 120) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  if (telefone.replace(/\D/g, '').length < 10) return res.status(400).json({ erro: 'Informe um telefone válido com DDD.' });
  if (mensagem.length < 5 || mensagem.length > 2000) return res.status(400).json({ erro: 'Escreva uma mensagem com mais detalhes.' });

  const salvarLead = () => db.run(
    "INSERT INTO leads (nome, email, telefone, whatsapp, mensagem, imovel_id, tipo_interesse) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [nome, email, telefone, whatsapp || '', mensagem, imovelId, tipo_interesse || 'geral'],
    function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao registrar interesse' });
      res.json({ mensagem: 'Seu interesse foi registrado. Fabiano entrará em contato!' });
    }
  );
  if (imovelId === null) return salvarLead();
  db.get('SELECT id FROM imoveis WHERE id = ? AND ativo = 1', [imovelId], (checkErr, row) => {
    if (checkErr) return res.status(500).json({ erro: 'Erro ao validar imóvel' });
    if (!row) return res.status(404).json({ erro: 'Imóvel não encontrado ou indisponível.' });
    salvarLead();
  });
});

app.get('/api/leads', verificarCorretor, (req, res) => {
  db.all("SELECT * FROM leads ORDER BY criado_em DESC", (err, leads) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar' });
    res.json({ leads });
  });
});

app.put('/api/leads/:id', verificarCorretor, (req, res) => {
  const { id } = req.params;
  const statusPermitidos = ['novo', 'contato', 'interessado', 'convertido'];
  const { status } = req.body || {};
  if (!statusPermitidos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

  db.run("UPDATE leads SET status = ? WHERE id = ?", [status, id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar lead' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Lead não encontrado' });
    res.json({ mensagem: 'Status atualizado', status });
  });
});

app.delete('/api/leads/:id', verificarCorretor, (req, res) => {
  db.run('DELETE FROM leads WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao excluir lead' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Lead não encontrado' });
    res.json({ mensagem: 'Lead excluído com sucesso' });
  });
});

// ============= ROTA DE DADOS DO CORRETOR =============

app.get('/api/corretor', (req, res) => {
  res.json({
    nome: 'Fabiano Reis de Araújo',
    creci: 'CRECI-RJ 93.426',
    descricao: 'Corretor imobiliário com experiência e paixão em ajudar pessoas a realizarem seu sonho',
    telefone: '(21) 99182-2134',
    whatsapp: '(21) 97266-4423',
    email: 'fabianooficialcorretor@gmail.com',
    horario: 'Segunda a sábado, 8:00 - 16:00',
    endereco: 'Travessa Arlindo Carreiro, 451',
    instagram: 'https://www.instagram.com/fabianoreiscorretor',
    facebook: 'https://www.facebook.com/share/14n16MN3h15/',
    youtube: 'https://www.youtube.com/@FabianoReis-o5i'
  });
});


app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_FIELD_COUNT' || err.code === 'LIMIT_FIELD_KEY' || err.code === 'LIMIT_FIELD_VALUE' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 400;
    return res.status(status).json({ erro: `Upload inválido: ${err.message}` });
  }
  if (err) {
    console.error('[ERRO]', err);
    return res.status(err.statusCode || 500).json({ erro: err.statusCode && err.statusCode < 500 ? err.message : 'Erro interno do servidor' });
  }
  next();
});

// ============= INICIAR SERVIDOR =============

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  🏠 IMOBILIÁRIA FABIANO REIS          ║
║                                        ║
║  ✅ Servidor rodando em               ║
║     http://localhost:${PORT}           ║
║                                        ║
║  ✅ Banco SQLite conectado            ║
║  ✅ Rotas da API prontas              ║
║                                        ║
╚════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
