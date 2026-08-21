require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db-adapter');
const path = require('path');
const CARACTERISTICAS_CONFIG = require('./caracteristicas.json');
const CARACTERISTICA_MAP = new Map(Object.values(CARACTERISTICAS_CONFIG).flat().map(([chave, nome]) => [chave, nome]));

function normalizarCaracteristicas(valor) {
  let lista = valor;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch (_) { lista = []; }
  }
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(v => String(v || '').trim()).filter(v => CARACTERISTICA_MAP.has(v)))];
}

function anexarCaracteristicas(imovel) {
  if (!imovel) return imovel;
  return { ...imovel, caracteristicas: normalizarCaracteristicas(imovel.caracteristicas_json) };
}

const fs = require('fs');
const crypto = require('crypto');
const midiaStorage = require('./storage');
const app = express();
// P06 — versão única, lida do package.json (evita divergência com o release).
const APP_VERSION = (() => {
  try { return String(require('./package.json').version || '0.0.0'); } catch (_) { return '0.0.0'; }
})();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
if (IS_PRODUCTION && !DATABASE_URL) { throw new Error('DATABASE_URL não configurado. Em produção, PostgreSQL/Neon é obrigatório.'); }
const SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'dev-only-secret-change-me');
if (IS_PRODUCTION && !SECRET) {
  // A exigência vale para qualquer host de produção.
  throw new Error('JWT_SECRET não configurado. Defina uma chave longa e aleatória nas variáveis de ambiente de produção.');
}
if (IS_PRODUCTION && SECRET.length < 24) {
  throw new Error('JWT_SECRET muito curto para produção. Use pelo menos 24 caracteres aleatórios.');
}

// Atrás do proxy/HTTPS da Hostinger (ou de qualquer reverse proxy), o Express
// precisa confiar nos cabeçalhos X-Forwarded-* para gerar URLs e cookies corretos.
const TRUST_PROXY = process.env.TRUST_PROXY !== undefined
  ? process.env.TRUST_PROXY
  : (IS_PRODUCTION ? '1' : '');
if (TRUST_PROXY) {
  const valor = /^\d+$/.test(String(TRUST_PROXY)) ? Number(TRUST_PROXY) : String(TRUST_PROXY);
  app.set('trust proxy', valor);
}

// Middleware
const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

// P006 — nenhum domínio legado como fallback. Sem CORS_ORIGIN configurado,
// somente requisições same-origin (sem cabeçalho Origin) são aceitas; em
// desenvolvimento local isso ainda cobre curl/health checks.
const defaultCorsOrigins = IS_PRODUCTION ? [] : ['http://localhost:3000'];

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

// Cabeçalhos de segurança básicos (sem dependências extras).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Content-Security-Policy compatível com as páginas atuais e mídia local.
  if (String(process.env.CSP_DISABLED || '') !== '1') {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https:",
      "form-action 'self'",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com"
    ].join('; '));
  }
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// O dashboard é protegido por cookie HttpOnly; os demais arquivos públicos continuam sendo servidos abaixo.

// ============= ARMAZENAMENTO DE MÍDIA — HOSTINGER =============
// Toda mídia passa pela camada ./storage e fica em disco persistente.
// O caminho é configurado por MEDIA_ROOT.
midiaStorage.garantirDiretorios();

const MIMES_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIMES_VIDEO = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

// Validação dupla: MIME permitido + extensão não executável (anti-upload de código).
function filtroDeArquivo(tiposPermitidos, rotulo) {
  return (req, file, cb) => {
    const erro = midiaStorage.validarUpload(file, tiposPermitidos);
    if (erro) return cb(new Error(rotulo ? erro.replace('arquivo', rotulo) : erro));
    cb(null, true);
  };
}

// P03 — validação de conteúdo real (magic bytes) dos arquivos já recebidos.
// Complementa MIME + extensão: um .jpg com corpo HTML/PHP é recusado e apagado.
async function validarConteudoDeArquivos(arquivos) {
  for (const file of arquivos) {
    const erro = await midiaStorage.validarConteudoRecebido(file);
    if (erro) {
      // Remove os demais arquivos do lote para não deixar órfãos em disco.
      for (const outro of arquivos) {
        if (outro !== file && outro.path) {
          await fs.promises.unlink(outro.path).catch(() => {});
        }
      }
      return erro;
    }
  }
  return null;
}

const storage = midiaStorage.multerStorage('imagens');
const videoStorage = midiaStorage.multerStorage('videos');

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: filtroDeArquivo(MIMES_IMAGEM, 'imagem')
});

const uploadVideos = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 3 },
  fileFilter: filtroDeArquivo(MIMES_VIDEO, 'vídeo')
});

// Wrappers mantidos para não alterar as rotas existentes (compatibilidade V7).
function storeUploadedFile(file, folder) {
  return midiaStorage.uploadFile(file, folder);
}

function storeBuffer(buffer, filename, contentType, folder) {
  return midiaStorage.uploadBuffer(buffer, filename, contentType, folder);
}

function removeStoredAsset(asset) {
  return midiaStorage.deleteFile(asset);
}

// Localiza uma imagem de forma robusta para exclusão.
// Além do ID, aceita a referência do arquivo/URL enviada pelo dashboard.
// Isso mantém compatibilidade com mídias antigas cujo ID no frontend possa
// estar desatualizado, sem permitir acesso a mídia de outro imóvel.
function buscarImagemParaExclusao(imovelId, imagemId, arquivo, urlExterna) {
  return new Promise((resolve, reject) => {
    const id = String(imagemId || '').trim();
    const midiaArquivo = String(arquivo || '').trim();
    const midiaUrl = String(urlExterna || '').trim();

    const porId = () => db.get(
      `SELECT id, imovel_id, tipo, arquivo, url_externa, principal
       FROM imovel_midias
       WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
      [imovelId ? id : '', imovelId],
      (err, imagem) => {
        if (err) return reject(err);
        if (imagem) return resolve(imagem);
        porReferencia();
      }
    );

    const porReferencia = () => {
      if (midiaArquivo) {
        return db.get(
          `SELECT id, imovel_id, tipo, arquivo, url_externa, principal
           FROM imovel_midias
           WHERE imovel_id = ? AND tipo = 'imagem' AND arquivo = ?
           LIMIT 1`,
          [imovelId, midiaArquivo],
          (err, imagem) => {
            if (err) return reject(err);
            if (imagem) return resolve(imagem);
            porUrl();
          }
        );
      }
      porUrl();
    };

    const porUrl = () => {
      if (!midiaUrl) return resolve(null);
      db.get(
        `SELECT id, imovel_id, tipo, arquivo, url_externa, principal
         FROM imovel_midias
         WHERE imovel_id = ? AND tipo = 'imagem' AND url_externa = ?
         LIMIT 1`,
        [imovelId, midiaUrl],
        (err, imagem) => {
          if (err) return reject(err);
          resolve(imagem || null);
        }
      );
    };

    // Primeiro tenta o ID oficial. Se não encontrar, usa a referência
    // enviada pelo próprio registro exibido na galeria.
    porId();
  });
}


// Compatibilidade de imagens por URL de redes sociais.
// Algumas versões do Dashboard enviam URLs de Instagram/Facebook/Pinterest etc.
// Mantemos a validação explícita para evitar que URLs arbitrárias sejam
// tratadas como importação de mídia.
function isSocialMediaUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
    return [
      'instagram.com', 'cdninstagram.com',
      'facebook.com', 'fbcdn.net',
      'pinterest.com', 'pinimg.com',
      'tiktok.com'
    ].some(domain => host === domain || host.endsWith('.' + domain));
  } catch (_) {
    return false;
  }
}

// Importa uma imagem pública de rede social para o storage configurado.
// Usa fetch nativo do Node 18+, portanto não adiciona dependência externa.
async function importSocialImage(sourceUrl) {
  const url = String(sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('URL de imagem inválida.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FabianoReisImoveis/12.1)'
      }
    });

    if (!response.ok) {
      throw new Error(`Não foi possível baixar a imagem (HTTP ${response.status}).`);
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const permitidos = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!permitidos.has(contentType)) {
      throw new Error('A URL informada não retornou uma imagem válida.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('A imagem recebida está vazia.');
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('A imagem ultrapassa o limite de 5 MB.');
    }

    const extensao = ({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    })[contentType] || 'jpg';

    const filename = `social-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extensao}`;
    const arquivo = await storeBuffer(buffer, filename, contentType, 'imagens');

    return { arquivo, contentType, filename };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Tempo limite ao importar a imagem da rede social.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Conectar banco SQLite

// Inicializar banco. SQLite continua sendo usado localmente; em produção,
// DATABASE_URL ativa PostgreSQL/Neon automaticamente.
function initDb() {
  if (db.mode === 'postgres') {
    return db.ready.then(() => true);
  }

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, tipo TEXT DEFAULT 'cliente', ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS imoveis (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, descricao TEXT, preco REAL NOT NULL, tipo TEXT NOT NULL, operacao TEXT NOT NULL, endereco TEXT NOT NULL, numero TEXT, bairro TEXT NOT NULL, cidade TEXT NOT NULL, cep TEXT, quartos INTEGER, banheiros INTEGER, area REAL, garagem INTEGER DEFAULT 0, piscina INTEGER DEFAULT 0, destaque INTEGER DEFAULT 0, caracteristicas_json TEXT DEFAULT '[]', ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS imovel_midias (id INTEGER PRIMARY KEY AUTOINCREMENT, imovel_id INTEGER NOT NULL, tipo TEXT NOT NULL, arquivo TEXT NOT NULL, url_externa TEXT, ordem INTEGER DEFAULT 0, principal INTEGER DEFAULT 0, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT NOT NULL, whatsapp TEXT, mensagem TEXT, imovel_id INTEGER, tipo_interesse TEXT, status TEXT DEFAULT 'novo', criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
    // V7 — estrutura para depoimentos reais (nenhum dado fictício é inserido).
    db.run(`CREATE TABLE IF NOT EXISTS depoimentos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cidade TEXT, texto TEXT NOT NULL, nota INTEGER, aprovado INTEGER DEFAULT 0, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS conversoes (id INTEGER PRIMARY KEY AUTOINCREMENT, imovel_id INTEGER NOT NULL, tipo TEXT NOT NULL, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id) ON DELETE CASCADE)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversoes_imovel_tipo_data ON conversoes (imovel_id, tipo, criado_em)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversoes_data ON conversoes (criado_em)`);
    // V10 — CRM funcional: clientes, histórico de interações e visitas.
    db.run(`CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT, telefone TEXT, whatsapp TEXT, cidade TEXT, observacoes TEXT, origem TEXT DEFAULT 'site', criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS interacoes_crm (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL, lead_id INTEGER, imovel_id INTEGER, tipo TEXT NOT NULL, descricao TEXT, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE CASCADE, FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE SET NULL, FOREIGN KEY(imovel_id) REFERENCES imoveis(id) ON DELETE SET NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS visitas (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER, lead_id INTEGER, imovel_id INTEGER, data_visita TEXT NOT NULL, hora_visita TEXT, status TEXT DEFAULT 'agendado', observacoes TEXT, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE SET NULL, FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE SET NULL, FOREIGN KEY(imovel_id) REFERENCES imoveis(id) ON DELETE SET NULL)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_clientes_email ON clientes (email)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_interacoes_cliente ON interacoes_crm (cliente_id, criado_em)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_visitas_data ON visitas (data_visita, status)`, () => {});
    // V7 — migração incremental: orçamento estimado informado pelo lead.
    db.run(`ALTER TABLE leads ADD COLUMN orcamento TEXT`, () => {});
    db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens (token_hash)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id, criado_em)`, () => {});
    db.run(`ALTER TABLE imoveis ADD COLUMN caracteristicas_json TEXT DEFAULT '[]'`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_ativo ON imoveis (ativo)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_midias_imovel ON imovel_midias (imovel_id)`, () => {});
    // V7.1 Premium — índices para as consultas realmente usadas pelo catálogo,
    // pela home (destaques/recentes), pelo painel e pela listagem de leads.
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_listagem ON imoveis (ativo, destaque, criado_em)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_operacao ON imoveis (operacao)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_tipo ON imoveis (tipo)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_cidade_bairro ON imoveis (cidade, bairro)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_imoveis_preco ON imoveis (preco)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_midias_imovel_tipo ON imovel_midias (imovel_id, tipo, ordem)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads (criado_em)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_imovel ON leads (imovel_id)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_depoimentos_aprovado ON depoimentos (aprovado, criado_em)`, () => {});
  });

  return Promise.resolve(true);
}
const dbReady = initDb();

// Garante que o schema esteja pronto antes de qualquer operação de API.
app.use('/api', async (req, res, next) => {
  try { await dbReady; next(); } catch (err) {
    console.error('Falha ao inicializar banco:', err);
    res.status(503).json({ erro: 'Banco de dados indisponível. Configure DATABASE_URL na produção.' });
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

// CRM também exige autenticação do corretor.
app.get('/crm.html', protegerPaginaCorretor, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

// Sitemap dinâmico (inclui os imóveis ativos). O arquivo estático continua
// no projeto como fallback caso o banco esteja indisponível.
app.get('/sitemap.xml', (req, res) => {
  const base = baseUrlDaRequisicao(req);
  const estatico = ['/', '/privacidade', '/termos'];
  db.all('SELECT id, titulo, bairro, cidade, criado_em FROM imoveis WHERE ativo = 1 ORDER BY criado_em DESC', [], (err, imoveis) => {
    const urls = estatico.map(rota => `  <url><loc>${base}${rota}</loc><changefreq>weekly</changefreq><priority>${rota === '/' ? '1.0' : '0.3'}</priority></url>`);
    if (!err) {
      for (const imovel of imoveis || []) {
        urls.push(`  <url><loc>${base}/imovel/${slugImovel(imovel)}-${imovel.id}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
      }
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
  });
});

// P001 — robots.txt dinâmico (o arquivo estático em public/ existe apenas como
// referência/fallback e nunca é servido, pois esta rota é registrada antes do
// express.static abaixo).
app.get('/robots.txt', (req, res) => {
  const base = baseUrlDaRequisicao(req);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
});

// Páginas estáticas recebem SITE_URL no momento do envio para manter
// canonical, Open Graph e JSON-LD consistentes com o domínio oficial.

// Arquivos públicos
// Mídia persistente fora de public/ (ex.: volume/disco da Hostinger apontado por
// MEDIA_ROOT). Mantém as mesmas URLs /uploads/... já gravadas no banco.
const MEDIA_DENTRO_DE_PUBLIC = path.resolve(midiaStorage.mediaRoot) === path.resolve(__dirname, 'public', 'uploads');
if (midiaStorage.isLocal && !MEDIA_DENTRO_DE_PUBLIC) {
  app.use('/uploads', express.static(midiaStorage.mediaRoot, {
    index: false,
    dotfiles: 'deny',
    setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  }));
}

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('dashboard.js') || filePath.endsWith('dashboard.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ============= PROTEÇÃO DE ORIGEM (CSRF) =============
// A sessão usa cookie HttpOnly + SameSite=Lax. Como reforço, requisições que
// alteram estado precisam vir da mesma origem (ou de uma origem autorizada).
function origemPermitida(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, health checks e navegações same-origin sem Origin
  const permitidas = configuredCorsOrigins.length ? configuredCorsOrigins : defaultCorsOrigins;
  if (permitidas.includes(origin)) return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === String(host);
  } catch (_) {
    return false;
  }
}

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (origemPermitida(req)) return next();
  return res.status(403).json({ erro: 'Origem não autorizada para esta operação.' });
});

// ============= LIMITADOR DE REQUISIÇÕES =============
// P02 — só confia em X-Forwarded-For quando o proxy é confiável (TRUST_PROXY).
// Sem isso, qualquer cliente burlaria o rate limit forjando o cabeçalho.
function clientIp(req) {
  if (TRUST_PROXY) {
    const encaminhado = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (encaminhado) return encaminhado;
  }
  return String(req.socket?.remoteAddress || 'desconhecido').trim();
}

// Limitador em memória do processo. Suficiente para uma instância; em ambientes
// serverless com múltiplas instâncias, um limitador externo (Redis/Upstash) é
// necessário para garantia global.
function criarRateLimit({ windowMs, max, mensagem }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    const entry = hits.get(ip);
    if (hits.size > 5000) hits.clear();
    if (!entry || now - entry.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ erro: mensagem });
    }
    next();
  };
}

const leadRateLimit = criarRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  mensagem: 'Muitos envios em pouco tempo. Aguarde alguns minutos ou fale direto pelo WhatsApp.'
});

const registerRateLimit = criarRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  mensagem: 'Muitas tentativas de cadastro. Tente novamente mais tarde.'
});

const uploadRateLimit = criarRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  mensagem: 'Muitos envios de mídia em sequência. Aguarde um instante e tente novamente.'
});

// ============= ROTAS DE AUTENTICAÇÃO =============
// Cookies de sessão: HttpOnly sempre; Secure em produção.
function setAuthCookie(res, token, maxAge = 86400) {
  const secure = IS_PRODUCTION;
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
  const secure = IS_PRODUCTION;
  const parts = ['auth_token=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}


// Limitador simples de tentativas de login por IP (memória do processo).
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  // P04 — limita o mapa para evitar crescimento indefinido de memória.
  if (loginAttempts.size > 5000) loginAttempts.clear();
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


// ============= RECUPERAÇÃO DE SENHA + NOTIFICAÇÕES =============
const resetRateLimit = criarRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  mensagem: 'Muitas solicitações de recuperação. Aguarde 15 minutos.'
});

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function passwordStrong(password) {
  return String(password).length >= 12
    && String(password).length <= 200
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

function publicBaseUrl(req) {
  return String(process.env.SITE_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/+$/, '');
}

async function sendTransactionalEmail({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !from) {
    if (!IS_PRODUCTION) {
      console.log(`[EMAIL DEV] Para: ${to} | Assunto: ${subject}`);
      console.log(`[EMAIL DEV] ${text || String(html).replace(/<[^>]+>/g, ' ')}`);
      return { sent: false, dev: true };
    }
    console.warn('[EMAIL] RESEND_API_KEY/EMAIL_FROM não configurados; e-mail não enviado.');
    return { sent: false, dev: false };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to: [to], subject, html, text })
      });
      if (response.ok) return { sent: true };
      const detail = await response.text();
      if (attempt === 2) console.error('[EMAIL] Resend recusou envio:', detail.slice(0, 500));
    } catch (err) {
      if (attempt === 2) console.error('[EMAIL] Falha no envio:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
  }
  return { sent: false };
}

async function notifyLeadByEmail(lead) {
  const adminEmail = String(process.env.ADMIN_EMAIL || process.env.CONTATO_EMAIL || '').trim();
  if (!adminEmail) return;
  const base = publicBaseUrl(lead.req);
  const safe = value => escapeHtmlServidor(value);
  const subject = `Novo lead: ${lead.nome}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto">
    <h2>Novo lead — Fabiano Reis Imóveis</h2>
    <p><strong>Nome:</strong> ${safe(lead.nome)}</p>
    <p><strong>E-mail:</strong> ${safe(lead.email)}</p>
    <p><strong>Telefone:</strong> ${safe(lead.telefone)}</p>
    <p><strong>WhatsApp:</strong> ${safe(lead.whatsapp || '-')}</p>
    <p><strong>Mensagem:</strong><br>${safe(lead.mensagem)}</p>
    <p><a href="${base}/dashboard.html">Abrir painel do corretor</a></p>
  </div>`;
  const text = `Novo lead: ${lead.nome}\nE-mail: ${lead.email}\nTelefone: ${lead.telefone}\nMensagem: ${lead.mensagem}\n${base}/dashboard.html`;
  return sendTransactionalEmail({ to: adminEmail, subject, html, text });
}

app.post('/api/auth/forgot-password', resetRateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const resposta = { mensagem: 'Se o e-mail estiver cadastrado, as instruções de recuperação foram enviadas.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.json(resposta);

  db.get('SELECT id, email, nome FROM usuarios WHERE email = ? AND ativo = 1', [email], async (err, user) => {
    if (err) return res.status(500).json({ erro: 'Não foi possível processar a solicitação.' });
    if (!user) return res.json(resposta);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    db.run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [user.id], () => {
      db.run(
        'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [tokenHash, user.id, new Date(Date.now() + 30 * 60 * 1000).toISOString()],
        async insertErr => {
          if (insertErr) return res.status(500).json({ erro: 'Não foi possível gerar a recuperação.' });
          const link = `${publicBaseUrl(req)}/reset-password.html?token=${encodeURIComponent(rawToken)}`;
          await sendTransactionalEmail({
            to: user.email,
            subject: 'Recuperação de senha — Fabiano Reis Imóveis',
            html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto">
              <h2>Redefinição de senha</h2>
              <p>Olá, ${escapeHtmlServidor(user.nome)}.</p>
              <p>Este link é válido por 30 minutos e pode ser usado uma única vez.</p>
              <p><a href="${link}">Redefinir minha senha</a></p>
            </div>`,
            text: `Redefina sua senha em até 30 minutos: ${link}`
          });
          // Em desenvolvimento, o link também fica visível no console para testes locais.
          if (!IS_PRODUCTION) console.log(`[PASSWORD RESET DEV] ${link}`);
          return res.json(resposta);
        }
      );
    });
  });
});

app.get('/api/auth/validate-reset-token', (req, res) => {
  const token = String(req.query?.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.json({ valid: false });
  db.get(
    `SELECT u.email FROM password_reset_tokens r
     JOIN usuarios u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > CURRENT_TIMESTAMP AND u.ativo = 1`,
    [sha256(token)],
    (err, row) => {
      if (err || !row) return res.json({ valid: false });
      res.json({ valid: true, email: row.email });
    }
  );
});

app.post('/api/auth/reset-password', resetRateLimit, async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ erro: 'Token de recuperação inválido.' });
  if (!passwordStrong(password)) {
    return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 12 caracteres, uma letra maiúscula e um número.' });
  }
  if (password !== confirmPassword) return res.status(400).json({ erro: 'As senhas não conferem.' });

  db.get(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [sha256(token)],
    (err, row) => {
      if (err) return res.status(500).json({ erro: 'Não foi possível redefinir a senha.' });
      if (!row) return res.status(400).json({ erro: 'Token expirado ou já utilizado.' });
      const hash = bcrypt.hashSync(password, 12);
      db.run('UPDATE usuarios SET senha = ? WHERE id = ? AND ativo = 1', [hash, row.user_id], function(updateErr) {
        if (updateErr || this.changes !== 1) return res.status(500).json({ erro: 'Não foi possível atualizar a senha.' });
        db.run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id], () => {});
        clearAuthCookie(res);
        res.json({ mensagem: 'Senha redefinida com sucesso. Faça login com a nova senha.' });
      });
    }
  );
});

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

    loginAttempts.delete(clientIp(req));
    setAuthCookie(res, token);
    res.json({ tipo: user.tipo, nome: user.nome, id: user.id });
  });
});
app.post('/api/register', registerRateLimit, (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');

  if (nome.length < 2 || nome.length > 120) {
    return res.status(400).json({ erro: 'Informe um nome válido.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  // P004 — política de senha alinhada com login/reset-password/admin:create.
  if (!passwordStrong(senha)) {
    return res.status(400).json({ erro: 'A senha precisa ter pelo menos 12 caracteres, uma letra maiúscula e um número.' });
  }

  // P005 — mesmo custo de bcrypt usado em reset-password e admin:create.
  const senhaHash = bcrypt.hashSync(senha, 12);
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
      // P003 — arquitetura usa HttpOnly Cookie (igual ao /api/login); o JWT
      // nunca deve trafegar no corpo JSON para o navegador.
      const token = jwt.sign({ id: this.lastID, email: email, tipo: 'cliente' }, SECRET, { expiresIn: '24h' });
      setAuthCookie(res, token);
      res.json({ tipo: 'cliente', nome: nome });
    }
  );
});

// ============= ROTAS DE IMÓVEIS =============

app.get('/api/imoveis', (req, res) => {
  const q = req.query || {};
  const clauses = ['ativo = 1'];
  const params = [];
  const num = v => (v === undefined || v === '' || v === null ? null : Number(v));

  const addLike = (campo, valor) => {
    const texto = String(valor || '').trim();
    if (!texto) return;
    clauses.push(`LOWER(${campo}) LIKE ?`);
    params.push(`%${texto.toLowerCase()}%`);
  };
  const addMin = (campo, valor) => {
    const n = num(valor);
    if (n === null || !Number.isFinite(n)) return;
    clauses.push(`${campo} >= ?`);
    params.push(n);
  };
  const addMax = (campo, valor) => {
    const n = num(valor);
    if (n === null || !Number.isFinite(n)) return;
    clauses.push(`${campo} <= ?`);
    params.push(n);
  };

  if (q.tipo) { clauses.push('tipo = ?'); params.push(String(q.tipo).toLowerCase()); }
  if (q.operacao) {
    // "venda-aluguel" atende tanto quem busca venda quanto aluguel.
    clauses.push('(operacao = ? OR operacao = ?)');
    params.push(String(q.operacao).toLowerCase(), 'venda-aluguel');
  }
  addLike('cidade', q.cidade);
  addLike('bairro', q.bairro);
  addMin('preco', q.preco_min);
  addMax('preco', q.preco_max);
  addMin('quartos', q.quartos);
  addMin('banheiros', q.banheiros);
  addMin('area', q.area_min);
  addMin('garagem', q.garagem);
  if (String(q.destaque) === '1') clauses.push('destaque = 1');
  if (String(q.piscina) === '1') clauses.push('piscina = 1');
  const busca = String(q.q || '').trim().toLowerCase();
  if (busca) {
    clauses.push('(LOWER(titulo) LIKE ? OR LOWER(bairro) LIKE ? OR LOWER(cidade) LIKE ? OR LOWER(descricao) LIKE ?)');
    for (let i = 0; i < 4; i++) params.push(`%${busca}%`);
  }

  const query = `SELECT * FROM imoveis WHERE ${clauses.join(' AND ')} ORDER BY destaque DESC, criado_em DESC`;

  db.all(query, params, (err, imoveis) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar' });
    const lista = imoveis || [];
    if (!lista.length) return res.json({ imoveis: [], total: 0 });

    // Resumo de mídias em UMA consulta (antes o frontend fazia 1 request por imóvel).
    const ids = lista.map(i => Number(i.id)).filter(Number.isFinite);
    const placeholders = ids.map(() => '?').join(',');
    db.all(
      `SELECT id, imovel_id, tipo, arquivo, url_externa, ordem, principal
       FROM imovel_midias
       WHERE imovel_id IN (${placeholders})
       ORDER BY principal DESC, ordem ASC, id ASC`,
      ids,
      (midiaErr, midias) => {
        if (midiaErr) return res.json({ imoveis: lista, total: lista.length });
        const porImovel = new Map();
        for (const m of midias || []) {
          const key = Number(m.imovel_id);
          if (!porImovel.has(key)) porImovel.set(key, []);
          porImovel.get(key).push(m);
        }
        const comMidias = lista.map(imovel => {
          const itens = porImovel.get(Number(imovel.id)) || [];
          const fotos = itens.filter(m => m.tipo === 'imagem');
          const videos = itens.filter(m => m.tipo === 'video');
          const capa = fotos.find(f => Number(f.principal) === 1) || fotos[0] || null;
          return {
            ...imovel,
            slug: slugImovel(imovel),
            url: `/imovel/${slugImovel(imovel)}-${imovel.id}`,
            foto_principal: capa ? (capa.arquivo || capa.url_externa || '') : '',
            total_fotos: fotos.length,
            total_videos: videos.length
          };
        });
        res.json({ imoveis: comMidias.map(anexarCaracteristicas), total: comMidias.length });
      }
    );
  });
});


// Lista completa para o painel do corretor, incluindo imóveis inativos.
app.get('/api/admin/imoveis', verificarCorretor, (req, res) => {
  db.all("SELECT * FROM imoveis ORDER BY ativo DESC, destaque DESC, criado_em DESC", [], (err, imoveis) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar imóveis do painel' });
    res.json({ imoveis: (imoveis || []).map(anexarCaracteristicas) });
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
      res.json({ imovel: anexarCaracteristicas(imovel) });
    });
  });
});

const TIPOS_IMOVEL = ['casa', 'apartamento', 'terreno', 'comercial', 'sitio', 'chacara', 'cobertura', 'kitnet', 'sobrado', 'galpao', 'outro'];
const OPERACOES_IMOVEL = ['venda', 'aluguel', 'venda-aluguel'];

// Validação/normalização usada no cadastro de imóveis (server-side, obrigatória).
function validarImovel(body) {
  const texto = (valor, max) => String(valor ?? '').trim().slice(0, max);
  const titulo = texto(body?.titulo, 160);
  const descricao = texto(body?.descricao, 4000);
  const tipo = texto(body?.tipo, 40).toLowerCase();
  const operacao = texto(body?.operacao, 40).toLowerCase();
  const endereco = texto(body?.endereco, 200);
  const bairro = texto(body?.bairro, 120);
  const cidade = texto(body?.cidade, 120);
  const numero = texto(body?.numero, 20);
  const cep = texto(body?.cep, 12);
  const preco = Number(body?.preco);
  const area = Number(body?.area || 0);
  const inteiro = valor => {
    const n = Math.trunc(Number(valor || 0));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
  };

  if (titulo.length < 3) return { erro: 'Informe um título com pelo menos 3 caracteres.' };
  if (!Number.isFinite(preco) || preco <= 0 || preco > 1e12) return { erro: 'Informe um preço válido.' };
  if (!TIPOS_IMOVEL.includes(tipo)) return { erro: 'Tipo de imóvel inválido.' };
  if (!OPERACOES_IMOVEL.includes(operacao)) return { erro: 'Operação inválida. Use venda, aluguel ou venda-aluguel.' };
  if (endereco.length < 3) return { erro: 'Informe o endereço do imóvel.' };
  if (bairro.length < 2) return { erro: 'Informe o bairro do imóvel.' };
  if (cidade.length < 2) return { erro: 'Informe a cidade do imóvel.' };
  if (!Number.isFinite(area) || area < 0 || area > 1e7) return { erro: 'Informe uma área válida.' };

  return {
    dados: {
      titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep,
      quartos: inteiro(body?.quartos),
      banheiros: inteiro(body?.banheiros),
      area,
      garagem: inteiro(body?.garagem),
      piscina: Number(Boolean(Number(body?.piscina) || body?.piscina === true)),
      destaque: Number(Boolean(Number(body?.destaque) || body?.destaque === true)),
      caracteristicas: normalizarCaracteristicas(body?.caracteristicas)
    }
  };
}

app.post('/api/imoveis', verificarCorretor, (req, res) => {
  const validado = validarImovel(req.body);
  if (validado.erro) return res.status(400).json({ erro: validado.erro });
  const { titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque, caracteristicas } = validado.dados;

  db.run(
    `INSERT INTO imoveis (titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque, caracteristicas_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque || 0, JSON.stringify(caracteristicas)],
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
    'piscina','destaque','ativo','caracteristicas_json'
  ];

  const entradas = Object.entries(req.body || {})
    .filter(([campo, valor]) => camposPermitidos.includes(campo) && valor !== undefined);

  if (!entradas.length) {
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });
  }

  const sets = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([campo, valor]) => {
    if (['piscina','destaque','ativo'].includes(campo)) return Number(Boolean(valor));
    if (campo === 'caracteristicas_json') return JSON.stringify(normalizarCaracteristicas(valor));
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

// Exclusão definitiva: remove o anúncio, as mídias do banco e tenta apagar os arquivos físicos.
app.post('/api/imoveis/:id/excluir-definitivo', verificarCorretor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID de imóvel inválido.' });
  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id, titulo FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado.' });
    const midias = await new Promise((resolve, reject) => db.all('SELECT id, arquivo FROM imovel_midias WHERE imovel_id = ?', [id], (err, rows) => err ? reject(err) : resolve(rows || [])));
    await new Promise((resolve, reject) => db.run('UPDATE leads SET imovel_id = NULL WHERE imovel_id = ?', [id], err => err ? reject(err) : resolve()));
    await new Promise((resolve, reject) => db.run('DELETE FROM imovel_midias WHERE imovel_id = ?', [id], err => err ? reject(err) : resolve()));
    await new Promise((resolve, reject) => db.run('DELETE FROM imoveis WHERE id = ?', [id], function(err) {
      if (err) return reject(err);
      if (this.changes !== 1) return reject(Object.assign(new Error('Imóvel não encontrado.'), { statusCode: 404 }));
      resolve();
    }));
    let falhasArquivos = 0;
    for (const media of midias) {
      try { if (media.arquivo) await removeStoredAsset(media.arquivo); }
      catch (e) { falhasArquivos++; console.warn('[MÍDIA] Falha ao excluir', media.id, e.message); }
    }
    res.json({
      mensagem: falhasArquivos ? 'Imóvel excluído. Algumas mídias precisam de limpeza manual.' : 'Imóvel e mídias excluídos definitivamente.',
      id, midiasExcluidas: midias.length, falhasArquivos
    });
  } catch (err) {
    console.error('[IMÓVEL] Exclusão definitiva:', err);
    res.status(err.statusCode || 500).json({ erro: err.message || 'Erro ao excluir imóvel.' });
  }
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ mensagem: 'Sessão encerrada' });
});

// Verificação de sessão do painel
app.get('/api/auth/check', verificarCorretor, (req, res) => {
  res.json({ autenticado: true, usuario: req.usuario });
});

// Troca de senha dentro do painel, sem depender de e-mail.
app.post('/api/auth/change-password', verificarCorretor, resetRateLimit, (req, res) => {
  const atual = String(req.body?.senhaAtual || '');
  const nova = String(req.body?.novaSenha || '');
  const confirmar = String(req.body?.confirmarSenha || '');
  if (!atual || !nova || !confirmar) return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
  if (!passwordStrong(nova)) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 12 caracteres, uma letra maiúscula e um número.' });
  if (nova !== confirmar) return res.status(400).json({ erro: 'As novas senhas não conferem.' });
  if (nova === atual) return res.status(400).json({ erro: 'A nova senha deve ser diferente da senha atual.' });

  db.get('SELECT id, senha FROM usuarios WHERE id = ? AND ativo = 1', [req.usuario.id], (err, user) => {
    if (err) return res.status(500).json({ erro: 'Erro ao consultar usuário.' });
    if (!user || !bcrypt.compareSync(atual, user.senha)) return res.status(401).json({ erro: 'Senha atual incorreta.' });
    const hash = bcrypt.hashSync(nova, 12);
    db.run('UPDATE usuarios SET senha = ? WHERE id = ? AND ativo = 1', [hash, req.usuario.id], function(updateErr) {
      if (updateErr) return res.status(500).json({ erro: 'Não foi possível alterar a senha.' });
      if (this.changes !== 1) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      clearAuthCookie(res);
      res.json({ mensagem: 'Senha alterada com sucesso. Faça login novamente.' });
    });
  });
});

// Health check (aplicação + banco). Não expõe segredos, URLs de conexão ou versões.
function healthHandler(req, res) {
  const inicio = Date.now();
  db.get('SELECT 1 AS ok', [], err => {
    const bancoOk = !err;
    if (err) console.error('[HEALTH] Banco indisponível:', err?.message || err);
    res.status(bancoOk ? 200 : 503).json({
      ok: bancoOk,
      servico: 'fabiano-reis-imoveis',
      versao: APP_VERSION,
      banco: { conectado: bancoOk, driver: db.driver || db.mode || 'desconhecido' },
      storage: { provider: midiaStorage.provider },
      tempo_ms: Date.now() - inicio,
      timestamp: new Date().toISOString()
    });
  });
}

app.get('/api/health', healthHandler);
// /health é o caminho esperado por monitores externos e pela Hostinger.
app.get('/health', healthHandler);

// ============= ROTAS DE UPLOAD =============
app.post('/api/upload', verificarCorretor, uploadRateLimit, upload.single('imagem'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: 'Arquivo não enviado' });
  }

  const erroConteudo = await validarConteudoDeArquivos([req.file]);
  if (erroConteudo) return res.status(400).json({ erro: erroConteudo });

  try {
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
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL)
    });

    // P05 — detalhe técnico fica somente no log; o cliente recebe mensagem segura.
    res.status(500).json({ erro: 'Não foi possível armazenar a imagem agora. Tente novamente.' });
  }
});

// Upload de várias fotos já vinculadas a um imóvel




const uploadFotos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter: filtroDeArquivo(MIMES_IMAGEM, 'imagem')
});

app.post(
  '/api/imoveis/:id/fotos',
  verificarCorretor,
  uploadRateLimit,
  uploadFotos.array('imagens', 12),
  async (req, res) => {
    const { id } = req.params;

    try {
      const imovel = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id FROM imoveis WHERE id = ?',
          [id],
          (err, row) => err ? reject(err) : resolve(row)
        );
      });

      if (!imovel) {
        return res.status(404).json({
          erro: 'Imóvel não encontrado'
        });
      }

      const arquivos = req.files || [];

      if (!arquivos.length) {
        return res.status(400).json({
          erro: 'Nenhuma foto enviada'
        });
      }

      const erroConteudo = await validarConteudoDeArquivos(arquivos);
      if (erroConteudo) return res.status(400).json({ erro: erroConteudo });

      const row = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem'` ,
          [id],
          (err, value) => err ? reject(err) : resolve(value)
        );
      });

      const mainRow = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS principal FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1` ,
          [id],
          (err, value) => err ? reject(err) : resolve(value)
        );
      });

      const ordemInicial = Number(row?.total || 0);
      const jaTemPrincipal = Number(mainRow?.principal || 0) > 0;

      const imagens = [];

      for (let index = 0; index < arquivos.length; index++) {
        const file = arquivos[index];

        const arquivo = await storeUploadedFile(
          file,
          'imagens'
        );

        const principal =
          !jaTemPrincipal && index === 0 ? 1 : 0;

        const result = await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO imovel_midias
              (imovel_id, tipo, arquivo, url_externa, ordem, principal)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              id,
              'imagem',
              arquivo,
              '',
              ordemInicial + index,
              principal
            ],
            function(err) {
              if (err) {
                reject(err);
              } else {
                resolve(this);
              }
            }
          );
        });

        imagens.push({
          id: result.lastID,
          arquivo
        });
      }

      res.json({
        mensagem: `${arquivos.length} foto(s) enviada(s) com sucesso`,
        imagens: imagens.map(v => v.arquivo)
      });

    } catch (err) {
      console.error('[UPLOAD-FOTOS] ERRO:', {
        message: err?.message || null,
        name: err?.name || null,
        code: err?.code || null,
        stack: err?.stack || null,
        imovelId: id,
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        files: (req.files || []).map(file => ({
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        }))
      });

      // Detalhes técnicos ficam no log do servidor; o cliente recebe mensagem segura.
      res.status(500).json({ erro: 'Não foi possível salvar as fotos agora. Tente novamente.' });
    }
  }
);

// ============= ROTAS DE VÍDEOS =============

// Lista todos os vídeos de um imóvel.
app.get('/api/imoveis/:id/videos', (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, ordem, criado_em
     FROM imovel_midias
     WHERE imovel_id = ? AND tipo = 'video'
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
     WHERE imovel_id = ?
     ORDER BY CASE WHEN principal = 1 THEN 0 ELSE 1 END, ordem ASC, criado_em DESC`,
    [id],
    (err, midias) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar mídias' });
      res.json({ midias: midias || [] });
    }
  );
});

// Upload de até 3 vídeos, 50 MB por arquivo.
app.post('/api/imoveis/:id/videos', verificarCorretor, uploadRateLimit, uploadVideos.array('videos', 3), async (req, res) => {
  const { id } = req.params;
  try {
    const imovel = await new Promise((resolve, reject) => db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, row) => err ? reject(err) : resolve(row)));
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
    const arquivos = req.files || [];
    if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum vídeo enviado' });
    const erroConteudo = await validarConteudoDeArquivos(arquivos);
    if (erroConteudo) return res.status(400).json({ erro: erroConteudo });
    const row = await new Promise((resolve, reject) => db.get(`SELECT COALESCE(MAX(ordem), -1) AS ordem FROM imovel_midias WHERE imovel_id = ? AND tipo = 'video'`, [id], (err, value) => err ? reject(err) : resolve(value)));
    const ordemInicial = Number(row?.ordem ?? -1) + 1;
    const videos = [];
    for (let index = 0; index < arquivos.length; index++) {
      const file = arquivos[index];
      const arquivo = await storeUploadedFile(file, 'videos');
      const result = await new Promise((resolve, reject) => db.run(
        `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'video', ?, '', ?, 0)`,
        [id, arquivo, ordemInicial + index], function(err) { err ? reject(err) : resolve(this); }
      ));
      videos.push({ id: result.lastID, arquivo });
    }
    res.json({ mensagem: `${arquivos.length} vídeo(s) enviado(s) com sucesso`, videos: videos.map(v => v.arquivo) });
  } catch (err) {
    console.error('[UPLOAD-VIDEOS] ERRO:', err?.message || err);
    res.status(500).json({ erro: 'Não foi possível salvar os vídeos agora. Tente novamente.' });
  }
});


// Adição de vídeo por URL (YouTube, Vimeo ou arquivo de vídeo remoto).
app.post('/api/imoveis/:id/videos/url', verificarCorretor, (req, res) => {
  const id = Number(req.params.id);
  const url = String(req.body?.url || '').trim();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'ID de imóvel inválido.' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ erro: 'Informe uma URL http:// ou https://.' });
  const permitida = /(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)/i.test(url) || /\.(mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(url);
  if (!permitida) return res.status(400).json({ erro: 'Use uma URL do YouTube, Vimeo ou de um vídeo MP4/WebM/OGG/MOV.' });

  db.get('SELECT id FROM imoveis WHERE id = ?', [id], (err, imovel) => {
    if (err) return res.status(500).json({ erro: 'Erro ao verificar imóvel.' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado.' });
    db.get(`SELECT COALESCE(MAX(ordem), -1) AS ordem FROM imovel_midias WHERE imovel_id = ? AND tipo = 'video'`, [id], (ordErr, row) => {
      if (ordErr) return res.status(500).json({ erro: 'Erro ao preparar vídeo.' });
      const ordem = Number(row?.ordem ?? -1) + 1;
      db.run(
        `INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'video', '', ?, ?, 0)`,
        [id, url, ordem],
        function(insertErr) {
          if (insertErr) return res.status(500).json({ erro: 'Não foi possível salvar a URL do vídeo.' });
          res.json({ id: this.lastID, mensagem: 'Vídeo adicionado por URL com sucesso.' });
        }
      );
    });
  });
});

app.delete('/api/imoveis/:imovelId/videos/:videoId', verificarCorretor, async (req, res) => {
  const imovelId = Number(req.params.imovelId);
  const videoId = Number(req.params.videoId);
  if (!Number.isInteger(imovelId) || !Number.isInteger(videoId)) return res.status(400).json({ erro: 'Identificador inválido.' });
  db.get(
    `SELECT id, arquivo, url_externa FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'video'`,
    [videoId, imovelId],
    async (err, video) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar vídeo.' });
      if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado neste imóvel.' });
      db.run(`DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'video'`, [videoId, imovelId], async function(delErr) {
        if (delErr) return res.status(500).json({ erro: 'Erro ao excluir vídeo.' });
        if (this.changes !== 1) return res.status(404).json({ erro: 'Vídeo não encontrado.' });
        try { if (video.arquivo) await removeStoredAsset(video.arquivo); } catch (e) {
          console.warn('[MÍDIA] Vídeo removido do banco, mas arquivo não pôde ser apagado:', e.message);
        }
        res.json({ mensagem: 'Vídeo excluído com sucesso.' });
      });
    }
  );
});

app.get('/api/imoveis/:id/imagens', (req, res) => {
  const { id } = req.params;

  db.all(
    "SELECT id, imovel_id, arquivo, url_externa, ordem, principal, criado_em FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' ORDER BY ordem ASC, criado_em DESC",
    [id],
    (err, imagens) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar imagens' });
      res.json({ imagens: imagens || [] });
    }
  );
});


app.post('/api/imoveis/:id/imagens', verificarCorretor, uploadRateLimit, (req, res) => {
  const { id } = req.params;
  const { arquivo, url_externa, principal } = req.body;

  if (!arquivo && !url_externa) {
    return res.status(400).json({ erro: 'Forneça arquivo ou URL' });
  }

  // URL externa de imagem: aceita URLs absolutas HTTP/HTTPS e URLs
  // protocol-relative (//exemplo.com/imagem.jpg).
  // Normalizamos antes de validar para evitar falsos erros quando o corretor
  // cola uma URL sem o protocolo.
  // IMPORTANTE: usar a própria variável recebida do formulário.
  // A versão anterior fazia `url_externa == null ? '' : urlImagem.trim()`;
  // isso acessava urlImagem antes da inicialização e derrubava a rota com
  // `ReferenceError: Cannot access 'urlImagem' before initialization`.
  let urlImagem = String(url_externa ?? '').trim();

  if (urlImagem.startsWith('//')) {
    urlImagem = `https:${urlImagem}`;
  }

  if (urlImagem) {
    try {
      const parsedUrl = new URL(urlImagem);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ erro: 'URL da imagem inválida. Use http:// ou https://' });
      }
      // Mantém a URL exatamente funcional, removendo apenas espaços acidentais.
      urlImagem = parsedUrl.toString();
    } catch (_) {
      return res.status(400).json({ erro: 'URL da imagem inválida. Cole uma URL completa começando com https:// ou http://' });
    }
  }

  // Usa a URL normalizada daqui em diante.
  if (urlImagem) req.body.url_externa = urlImagem;

  // Se for uma publicação de rede social, importa a imagem para o servidor.
  if (urlImagem && isSocialMediaUrl(urlImagem)) {
    db.get('SELECT id FROM imoveis WHERE id = ?', [id], async (checkErr, imovel) => {
      if (checkErr) return res.status(500).json({ erro: 'Erro ao verificar imóvel' });
      if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });
      try {
        const imported = await importSocialImage(urlImagem);
        db.get(`SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' AND principal = 1`, [id], (mainErr, row) => {
          if (mainErr) return res.status(500).json({ erro: 'Erro ao verificar foto principal' });
          const tornarPrincipal = Number(principal) === 1 || Number(row?.total || 0) === 0;
          db.run(
            "INSERT INTO imovel_midias (imovel_id, tipo, arquivo, url_externa, ordem, principal) VALUES (?, 'imagem', ?, ?, COALESCE((SELECT MAX(ordem)+1 FROM imovel_midias WHERE imovel_id = ?), 0), ?)",
            [id, imported.arquivo, urlImagem, id, tornarPrincipal ? 1 : 0],
            function(insertErr) {
              if (insertErr) return res.status(500).json({ erro: 'Erro ao salvar imagem importada' });
              res.json({ id: this.lastID, mensagem: 'Imagem da rede social importada para o servidor com sucesso', principal: tornarPrincipal, arquivo: imported.arquivo, fonte_social: urlImagem });
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
          [id, 'imagem', arquivo || '', urlImagem || '', id, tornarPrincipal ? 1 : 0],
          function(insertErr) {
            if (insertErr) return res.status(500).json({ erro: 'Erro ao adicionar imagem' });
            res.json({ id: this.lastID, mensagem: 'Imagem adicionada com sucesso', principal: tornarPrincipal });
          }
        );
      }
    );
  });
});


async function excluirImagemDoImovel(req, res) {
  const { imovelId, imagemId } = req.params;
  const imagem = await buscarImagemParaExclusao(
    imovelId,
    imagemId,
    req.body?.arquivo,
    req.body?.url_externa
  );

  if (!imagem) {
    return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });
  }

  const deleteResult = await new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
      [imagem.id, imovelId],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: Number(this.changes || 0) });
      }
    );
  });

  if (deleteResult.changes !== 1) {
    return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });
  }

  console.log(`[MÍDIA] Foto ${imagem.id} excluída do imóvel ${imovelId}`);

  // O banco é a fonte da verdade. Se o arquivo físico já não existir,
  // a exclusão continua válida; se houver outro erro de storage, registramos
  // o problema sem transformar uma exclusão de banco já concluída em falha.
  let arquivoRemovido = true;
  try {
    if (imagem.arquivo) await removeStoredAsset(imagem.arquivo);
  } catch (storageErr) {
    arquivoRemovido = false;
    console.warn(
      `[MÍDIA] Foto ${imagem.id} removida do banco, mas o arquivo físico não pôde ser apagado:`,
      storageErr?.message || storageErr
    );
  }

  if (!Number(imagem.principal)) {
    return res.json({
      mensagem: arquivoRemovido
        ? 'Foto excluída com sucesso'
        : 'Foto excluída do cadastro. O arquivo físico será revisado posteriormente.',
      novaPrincipal: false,
      arquivoRemovido
    });
  }

  const proxima = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM imovel_midias
       WHERE imovel_id = ? AND tipo = 'imagem'
       ORDER BY ordem ASC, criado_em ASC, id ASC
       LIMIT 1`,
      [imovelId],
      (err, row) => err ? reject(err) : resolve(row || null)
    );
  });

  if (!proxima) {
    return res.json({
      mensagem: arquivoRemovido
        ? 'Foto excluída com sucesso. O imóvel ficou sem foto principal.'
        : 'Foto excluída do cadastro. O imóvel ficou sem foto principal e o arquivo físico será revisado posteriormente.',
      novaPrincipal: false,
      arquivoRemovido
    });
  }

  const promoteResult = await new Promise((resolve, reject) => {
    db.run(
      'UPDATE imovel_midias SET principal = 1 WHERE id = ? AND imovel_id = ? AND tipo = ?',
      [proxima.id, imovelId, 'imagem'],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: Number(this.changes || 0) });
      }
    );
  });

  if (promoteResult.changes !== 1) {
    return res.status(500).json({
      erro: 'Foto excluída, mas não foi possível definir a nova foto principal.',
      arquivoRemovido
    });
  }

  return res.json({
    mensagem: arquivoRemovido
      ? 'Foto excluída e nova foto principal definida com sucesso'
      : 'Foto excluída e nova foto principal definida. O arquivo físico será revisado posteriormente.',
    novaPrincipal: true,
    novaPrincipalId: Number(proxima.id),
    arquivoRemovido
  });
}

app.delete('/api/imoveis/:imovelId/imagens/:imagemId', verificarCorretor, async (req, res) => {
  try {
    await excluirImagemDoImovel(req, res);
  } catch (err) {
    console.error('[MÍDIA] Erro ao excluir foto:', err);
    if (!res.headersSent) {
      res.status(500).json({ erro: 'Erro ao excluir foto. Tente novamente.' });
    }
  }
});


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


// Fallback POST para exclusão: alguns ambientes/proxies bloqueiam DELETE.
app.post('/api/imoveis/:imovelId/imagens/:imagemId/excluir', verificarCorretor, async (req, res) => {
  try {
    await excluirImagemDoImovel(req, res);
  } catch (err) {
    console.error('[MÍDIA] Erro ao excluir foto pelo fallback POST:', err);
    if (!res.headersSent) {
      res.status(500).json({ erro: 'Erro ao excluir foto. Tente novamente.' });
    }
  }
});


app.post('/api/leads', leadRateLimit, (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const telefone = String(req.body?.telefone || '').trim();
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const mensagem = String(req.body?.mensagem || '').trim();
  const imovel_id = req.body?.imovel_id;
  const tipo_interesse = String(req.body?.tipo_interesse || '').trim().slice(0, 40);
  const orcamento = String(req.body?.orcamento || '').trim().slice(0, 60);
  // Honeypot: campo invisível preenchido = bot. Respondemos 200 sem gravar.
  if (String(req.body?.website || '').trim()) {
    return res.json({ mensagem: 'Seu interesse foi registrado. Fabiano entrará em contato!' });
  }

  if (nome.length < 2 || nome.length > 120) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  if (telefone.replace(/\D/g, '').length < 10) return res.status(400).json({ erro: 'Informe um telefone válido com DDD.' });
  if (mensagem.length < 5 || mensagem.length > 2000) return res.status(400).json({ erro: 'Escreva uma mensagem com mais detalhes.' });

  db.run(
    "INSERT INTO leads (nome, email, telefone, whatsapp, mensagem, imovel_id, tipo_interesse, orcamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [nome, email, telefone, whatsapp || '', mensagem, Number(imovel_id) > 0 ? Number(imovel_id) : null, tipo_interesse || 'geral', orcamento],
    function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao registrar interesse' });
      const leadId = this.lastID;
      // O e-mail é assíncrono: falha de notificação nunca bloqueia o lead.
      notifyLeadByEmail({ id: leadId, nome, email, telefone, whatsapp, mensagem, req })
        .catch(error => console.error('[EMAIL LEAD]', error.message));
      res.json({ mensagem: 'Seu interesse foi registrado. Fabiano entrará em contato!', id: leadId });
    }
  );
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

// =====================================================================
// V10 — CRM FUNCIONAL + WHATSAPP
// Clientes, interações, visitas e conversão de leads em clientes.
// =====================================================================
function texto(v, max = 5000) { return String(v ?? '').trim().slice(0, max); }
function validarId(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }

app.get('/api/crm/resumo', verificarCorretor, (req, res) => {
  const queries = [
    ['clientes', 'SELECT COUNT(*) AS total FROM clientes'],
    ['interacoes', 'SELECT COUNT(*) AS total FROM interacoes_crm'],
    ['visitas_abertas', "SELECT COUNT(*) AS total FROM visitas WHERE status IN ('agendado','confirmado')"],
    ['visitas_hoje', db.mode === 'postgres' ? "SELECT COUNT(*) AS total FROM visitas WHERE data_visita = CURRENT_DATE::text" : "SELECT COUNT(*) AS total FROM visitas WHERE data_visita = date('now')"]
  ];
  Promise.all(queries.map(([key, sql]) => new Promise(resolve => db.get(sql, [], (err, row) => resolve([key, err ? 0 : Number(row?.total || 0)])))))
    .then(values => res.json(Object.fromEntries(values)))
    .catch(() => res.status(500).json({ erro: 'Erro ao carregar resumo do CRM' }));
});

app.get('/api/crm/clientes', verificarCorretor, (req, res) => {
  const busca = texto(req.query?.q, 120);
  const like = `%${busca}%`;
  const sql = `SELECT c.*, (SELECT COUNT(*) FROM interacoes_crm i WHERE i.cliente_id=c.id) AS total_interacoes,
    (SELECT COUNT(*) FROM visitas v WHERE v.cliente_id=c.id AND v.status IN ('agendado','confirmado')) AS visitas_abertas
    FROM clientes c WHERE (? = '' OR c.nome LIKE ? OR c.email LIKE ? OR c.telefone LIKE ? OR c.whatsapp LIKE ?)
    ORDER BY c.atualizado_em DESC, c.id DESC LIMIT 200`;
  db.all(sql, [busca, like, like, like, like], (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar clientes' });
    res.json({ clientes: rows || [] });
  });
});

app.post('/api/crm/clientes', verificarCorretor, (req, res) => {
  const nome = texto(req.body?.nome, 120);
  const email = texto(req.body?.email, 160);
  const telefone = texto(req.body?.telefone, 40);
  const whatsapp = texto(req.body?.whatsapp || telefone, 40);
  const cidade = texto(req.body?.cidade, 100);
  const observacoes = texto(req.body?.observacoes, 3000);
  const origem = texto(req.body?.origem || 'painel', 60);
  if (nome.length < 2) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  db.run(`INSERT INTO clientes (nome,email,telefone,whatsapp,cidade,observacoes,origem) VALUES (?,?,?,?,?,?,?)`,
    [nome,email,telefone,whatsapp,cidade,observacoes,origem], function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao criar cliente' });
      res.status(201).json({ mensagem: 'Cliente criado', id: this.lastID });
    });
});

app.put('/api/crm/clientes/:id', verificarCorretor, (req, res) => {
  const id = validarId(req.params.id); if (!id) return res.status(400).json({ erro: 'ID inválido' });
  const nome = texto(req.body?.nome, 120); if (nome.length < 2) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  const email = texto(req.body?.email, 160); const telefone = texto(req.body?.telefone, 40);
  const whatsapp = texto(req.body?.whatsapp || telefone, 40); const cidade = texto(req.body?.cidade, 100);
  const observacoes = texto(req.body?.observacoes, 3000);
  db.run(`UPDATE clientes SET nome=?,email=?,telefone=?,whatsapp=?,cidade=?,observacoes=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
    [nome,email,telefone,whatsapp,cidade,observacoes,id], function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao atualizar cliente' });
      if (!this.changes) return res.status(404).json({ erro: 'Cliente não encontrado' });
      res.json({ mensagem: 'Cliente atualizado' });
    });
});

app.get('/api/crm/clientes/:id', verificarCorretor, (req, res) => {
  const id = validarId(req.params.id); if (!id) return res.status(400).json({ erro: 'ID inválido' });
  db.get('SELECT * FROM clientes WHERE id=?', [id], (err, cliente) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar cliente' });
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
    db.all(`SELECT i.*, l.nome AS lead_nome, m.titulo AS imovel_titulo FROM interacoes_crm i
      LEFT JOIN leads l ON l.id=i.lead_id LEFT JOIN imoveis m ON m.id=i.imovel_id
      WHERE i.cliente_id=? ORDER BY i.criado_em DESC LIMIT 100`, [id], (e1, interacoes) => {
      db.all(`SELECT v.*, m.titulo AS imovel_titulo FROM visitas v LEFT JOIN imoveis m ON m.id=v.imovel_id
        WHERE v.cliente_id=? ORDER BY v.data_visita DESC, v.hora_visita DESC LIMIT 100`, [id], (e2, visitas) => {
        if (e1 || e2) return res.status(500).json({ erro: 'Erro ao carregar histórico do cliente' });
        res.json({ cliente, interacoes: interacoes || [], visitas: visitas || [] });
      });
    });
  });
});

app.post('/api/crm/interacoes', verificarCorretor, (req, res) => {
  const clienteId = validarId(req.body?.cliente_id); if (!clienteId) return res.status(400).json({ erro: 'Cliente inválido.' });
  const tipo = texto(req.body?.tipo, 40); const descricao = texto(req.body?.descricao, 3000);
  const leadId = validarId(req.body?.lead_id); const imovelId = validarId(req.body?.imovel_id);
  const permitidos = ['whatsapp','telefone','email','visita','nota','proposta','outro'];
  if (!permitidos.includes(tipo)) return res.status(400).json({ erro: 'Tipo de interação inválido.' });
  if (!descricao) return res.status(400).json({ erro: 'Descreva a interação.' });
  db.run(`INSERT INTO interacoes_crm (cliente_id,lead_id,imovel_id,tipo,descricao) VALUES (?,?,?,?,?)`,
    [clienteId,leadId,imovelId,tipo,descricao], function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao registrar interação' });
      db.run('UPDATE clientes SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?',[clienteId],()=>{});
      res.status(201).json({ mensagem: 'Interação registrada', id: this.lastID });
    });
});

app.get('/api/crm/visitas', verificarCorretor, (req, res) => {
  const de = texto(req.query?.de, 10); const ate = texto(req.query?.ate, 10);
  const params = []; let where = '1=1';
  if (/^\d{4}-\d{2}-\d{2}$/.test(de)) { where += ' AND v.data_visita >= ?'; params.push(de); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) { where += ' AND v.data_visita <= ?'; params.push(ate); }
  db.all(`SELECT v.*, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp, c.telefone AS cliente_telefone,
    m.titulo AS imovel_titulo FROM visitas v LEFT JOIN clientes c ON c.id=v.cliente_id LEFT JOIN imoveis m ON m.id=v.imovel_id
    WHERE ${where} ORDER BY v.data_visita ASC, v.hora_visita ASC LIMIT 300`, params, (err, rows) => {
      if (err) return res.status(500).json({ erro: 'Erro ao buscar agenda' });
      res.json({ visitas: rows || [] });
    });
});

app.post('/api/crm/visitas', verificarCorretor, (req, res) => {
  const clienteId = validarId(req.body?.cliente_id); if (!clienteId) return res.status(400).json({ erro: 'Cliente inválido.' });
  const imovelId = validarId(req.body?.imovel_id); const leadId = validarId(req.body?.lead_id);
  const data = texto(req.body?.data_visita, 10); const hora = texto(req.body?.hora_visita, 5);
  const status = texto(req.body?.status || 'agendado', 20); const obs = texto(req.body?.observacoes, 2000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Data inválida.' });
  if (hora && !/^\d{2}:\d{2}$/.test(hora)) return res.status(400).json({ erro: 'Hora inválida.' });
  if (!['agendado','confirmado','realizado','cancelado'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  db.run(`INSERT INTO visitas (cliente_id,lead_id,imovel_id,data_visita,hora_visita,status,observacoes) VALUES (?,?,?,?,?,?,?)`,
    [clienteId,leadId,imovelId,data,hora,status,obs], function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao agendar visita' });
      db.run(`INSERT INTO interacoes_crm (cliente_id,lead_id,imovel_id,tipo,descricao) VALUES (?,?,?,?,?)`,
        [clienteId,leadId,imovelId,'visita',`Visita agendada para ${data}${hora ? ` às ${hora}` : ''}.`],()=>{});
      res.status(201).json({ mensagem: 'Visita agendada', id: this.lastID });
    });
});

app.put('/api/crm/visitas/:id', verificarCorretor, (req, res) => {
  const id = validarId(req.params.id); if (!id) return res.status(400).json({ erro: 'ID inválido' });
  const status = texto(req.body?.status, 20);
  if (!['agendado','confirmado','realizado','cancelado'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  db.run('UPDATE visitas SET status=? WHERE id=?',[status,id],function(err){
    if(err) return res.status(500).json({ erro:'Erro ao atualizar visita' });
    if(!this.changes) return res.status(404).json({ erro:'Visita não encontrada' });
    res.json({ mensagem:'Visita atualizada' });
  });
});

app.post('/api/crm/leads/:id/converter', verificarCorretor, (req, res) => {
  const leadId = validarId(req.params.id); if (!leadId) return res.status(400).json({ erro:'Lead inválido' });
  db.get('SELECT * FROM leads WHERE id=?',[leadId],(err,lead)=>{
    if(err) return res.status(500).json({erro:'Erro ao buscar lead'}); if(!lead) return res.status(404).json({erro:'Lead não encontrado'});
    db.get("SELECT id FROM clientes WHERE lower(email)=lower(?) AND email <> '' LIMIT 1",[lead.email||''],(e,existing)=>{
      if(e) return res.status(500).json({erro:'Erro ao verificar cliente'});
      const finish=(clientId)=>{ db.run("UPDATE leads SET status='convertido' WHERE id=?",[leadId],()=>{}); res.status(201).json({mensagem:'Lead convertido em cliente',id:clientId,existente:Boolean(existing)}); };
      if(existing) return finish(existing.id);
      db.run(`INSERT INTO clientes (nome,email,telefone,whatsapp,observacoes,origem) VALUES (?,?,?,?,?,?)`,
        [lead.nome,lead.email,lead.telefone,lead.whatsapp||lead.telefone,lead.mensagem||'', 'lead'], function(e2){
          if(e2) return res.status(500).json({erro:'Erro ao criar cliente'}); finish(this.lastID);
        });
    });
  });
});

// ============= ROTA DE DADOS DO CORRETOR =============

// V7.1 Premium: dados de contato centralizados em um único lugar do servidor e
// sobrescrevíveis por variáveis de ambiente. O frontend consome /api/corretor e
// aplica o número do WhatsApp em todos os botões — nada de número divergente
// espalhado por vários arquivos.
const env = (chave, padrao) => {
  const valor = String(process.env[chave] ?? '').trim();
  return valor || padrao;
};
const WHATSAPP_NUMERO = env('WHATSAPP_NUMBER', '5521991822134').replace(/\D/g, '');
const CONTATO = Object.freeze({
  nome: env('CONTATO_NOME', 'Fabiano Reis de Araújo'),
  creci: env('CONTATO_CRECI', 'CRECI-RJ 93.426'),
  descricao: 'Corretor imobiliário com experiência e paixão em ajudar pessoas a realizarem seu sonho',
  telefone: env('CONTATO_TELEFONE', '(21) 99182-2134'),
  whatsapp: env('CONTATO_WHATSAPP', '(21) 99182-2134'),
  whatsapp_numero: WHATSAPP_NUMERO,
  email: env('CONTATO_EMAIL', 'fabianooficialcorretor@gmail.com'),
  horario: env('CONTATO_HORARIO', 'Segunda a sábado, 8:00 - 16:00'),
  endereco: env('CONTATO_ENDERECO', 'Travessa Arlindo Carreiro, 451'),
  instagram: env('CONTATO_INSTAGRAM', 'https://www.instagram.com/fabianoreiscorretor'),
  facebook: env('CONTATO_FACEBOOK', 'https://www.facebook.com/share/14n16MN3h15/'),
  youtube: env('CONTATO_YOUTUBE', 'https://www.youtube.com/@FabianoReis-o5i')
});

app.get('/api/corretor', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(CONTATO);
});



// =====================================================================
// V7 — Slugs, páginas de imóvel, depoimentos, indicadores e sitemap
// (adições incrementais; nenhuma rota existente foi removida)
// =====================================================================

function slugImovel(imovel) {
  const base = [imovel?.titulo, imovel?.bairro, imovel?.cidade].filter(Boolean).join(' ');
  return String(base)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'imovel';
}

// V7.1: SITE_URL fixa o domínio oficial em canônicas/sitemap (evita canônicas
// duplicadas quando o app é acessado por IP, subdomínio de teste ou proxy).
const SITE_URL = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');

function baseUrlDaRequisicao(req) {
  if (SITE_URL) return SITE_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || (IS_PRODUCTION ? 'https' : 'http');
  return `${proto}://${host}`;
}

function escapeHtmlServidor(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ============= MOTOR DE CONVERSÃO V11 =============
const TIPOS_CONVERSAO = new Set(['interesse', 'visita', 'proposta']);
const conversaoRateLimit = criarRateLimit({ windowMs: 60 * 1000, max: 30, mensagem: 'Muitas interações em pouco tempo. Tente novamente em alguns instantes.' });
app.post('/api/conversoes', conversaoRateLimit, (req, res) => {
  const imovelId = Math.trunc(Number(req.body?.imovel_id));
  const tipo = String(req.body?.tipo || '').trim().toLowerCase();
  if (!Number.isInteger(imovelId) || imovelId <= 0 || !TIPOS_CONVERSAO.has(tipo)) return res.status(400).json({ erro: 'Evento de conversão inválido.' });
  db.get('SELECT id FROM imoveis WHERE id = ? AND ativo = 1', [imovelId], (findErr, imovel) => {
    if (findErr) return res.status(500).json({ erro: 'Não foi possível validar o imóvel.' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado.' });
    db.run('INSERT INTO conversoes (imovel_id, tipo) VALUES (?, ?)', [imovelId, tipo], function(err) {
      if (err) return res.status(500).json({ erro: 'Não foi possível registrar a conversão.' });
      res.status(201).json({ registrado: true, id: this.lastID });
    });
  });
});

// ============= INDICADORES DO PAINEL =============
app.get('/api/admin/stats', verificarCorretor, (req, res) => {
  const consultas = [
    ['total_imoveis', 'SELECT COUNT(*) AS valor FROM imoveis'],
    ['imoveis_ativos', 'SELECT COUNT(*) AS valor FROM imoveis WHERE ativo = 1'],
    ['imoveis_destaque', 'SELECT COUNT(*) AS valor FROM imoveis WHERE ativo = 1 AND destaque = 1'],
    ['total_leads', 'SELECT COUNT(*) AS valor FROM leads'],
    ['leads_novos', "SELECT COUNT(*) AS valor FROM leads WHERE status = 'novo'"],
    ['total_midias', 'SELECT COUNT(*) AS valor FROM imovel_midias']
  ];

  Promise.all(consultas.map(([chave, sql]) => new Promise(resolve => {
    db.get(sql, [], (err, row) => resolve([chave, err ? 0 : Number(row?.valor || 0)]));
  })))
    .then(pares => res.json(Object.fromEntries(pares)))
    .catch(() => res.status(500).json({ erro: 'Erro ao calcular indicadores' }));
});


app.get('/api/admin/conversoes', verificarCorretor, (req, res) => {
  const days = Math.trunc(Math.min(Math.max(Number(req.query?.days) || 30, 1), 365));
  const porTipo = rows => { const m={interesse:0,visita:0,proposta:0}; for(const r of rows||[]) m[String(r.tipo)]=Number(r.quantidade||0); return m; };
  const rank = cb => {
    const sqlite=`SELECT c.imovel_id,i.titulo,i.cidade,i.bairro,SUM(CASE WHEN c.tipo='interesse' THEN 1 ELSE 0 END) interesse,SUM(CASE WHEN c.tipo='visita' THEN 1 ELSE 0 END) visita,SUM(CASE WHEN c.tipo='proposta' THEN 1 ELSE 0 END) proposta,COUNT(*) total FROM conversoes c INNER JOIN imoveis i ON i.id=c.imovel_id WHERE c.criado_em >= datetime('now', ?) GROUP BY c.imovel_id,i.titulo,i.cidade,i.bairro ORDER BY total DESC,i.titulo ASC`;
    db.all(sqlite,[`-${days} days`],(e,r)=>{ if(!e) return cb(null,r); const pg=`SELECT c.imovel_id,i.titulo,i.cidade,i.bairro,SUM(CASE WHEN c.tipo='interesse' THEN 1 ELSE 0 END) interesse,SUM(CASE WHEN c.tipo='visita' THEN 1 ELSE 0 END) visita,SUM(CASE WHEN c.tipo='proposta' THEN 1 ELSE 0 END) proposta,COUNT(*) total FROM conversoes c INNER JOIN imoveis i ON i.id=c.imovel_id WHERE c.criado_em >= CURRENT_TIMESTAMP - INTERVAL '${days} days' GROUP BY c.imovel_id,i.titulo,i.cidade,i.bairro ORDER BY total DESC,i.titulo ASC`; db.all(pg,[],cb); });
  };
  const sqlite=`SELECT tipo,COUNT(*) quantidade FROM conversoes WHERE criado_em >= datetime('now', ?) GROUP BY tipo ORDER BY quantidade DESC`;
  db.all(sqlite,[`-${days} days`],(e,rows)=>{ const done=tipoRows=>rank((re,ranking)=>{ if(re) return res.status(500).json({erro:'Erro ao calcular conversões.'}); const p=porTipo(tipoRows); res.json({dias:days,total:p.interesse+p.visita+p.proposta,por_tipo:p,ranking:(ranking||[]).map(r=>({imovel_id:Number(r.imovel_id),titulo:r.titulo,cidade:r.cidade,bairro:r.bairro,interesse:Number(r.interesse||0),visita:Number(r.visita||0),proposta:Number(r.proposta||0),total:Number(r.total||0)}))}); }); if(!e) return done(rows); const pg=`SELECT tipo,COUNT(*) quantidade FROM conversoes WHERE criado_em >= CURRENT_TIMESTAMP - INTERVAL '${days} days' GROUP BY tipo ORDER BY quantidade DESC`; db.all(pg,[],(pe,pr)=>pe?res.status(500).json({erro:'Erro ao calcular conversões.'}):done(pr)); });
});

app.get('/api/admin/leads-chart', verificarCorretor, (req, res) => {
  // P08 — inteiro validado antes de qualquer uso em SQL (sem entrada livre).
  const days = Math.trunc(Math.min(Math.max(Number(req.query?.days) || 30, 7), 90));
  db.all(
    `SELECT DATE(criado_em) AS data, COUNT(*) AS quantidade
     FROM leads
     WHERE criado_em >= datetime('now', ?)
     GROUP BY DATE(criado_em)
     ORDER BY data ASC`,
    [`-${days} days`],
    (err, rows) => {
      if (err) {
        // PostgreSQL usa INTERVAL; fallback mantém compatibilidade entre adaptadores.
        return db.all(
          `SELECT DATE(criado_em) AS data, COUNT(*) AS quantidade
           FROM leads WHERE criado_em >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
           GROUP BY DATE(criado_em) ORDER BY data ASC`,
          [],
          (pgErr, pgRows) => pgErr
            ? res.status(500).json({ erro: 'Erro ao gerar gráfico de leads' })
            : res.json(pgRows.map(row => ({ date: row.data, count: Number(row.quantidade || 0) })))
        );
      }
      res.json((rows || []).map(row => ({ date: row.data, count: Number(row.quantidade || 0) })));
    }
  );
});

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

app.get('/api/admin/leads/export.csv', verificarCorretor, (req, res) => {
  db.all(
    `SELECT id, nome, email, telefone, whatsapp, mensagem, imovel_id, tipo_interesse, status, criado_em
     FROM leads ORDER BY criado_em DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ erro: 'Erro ao exportar leads' });
      const header = ['ID','Nome','E-mail','Telefone','WhatsApp','Mensagem','Imóvel','Interesse','Status','Criado em'];
      const body = (rows || []).map(row => [
        row.id,row.nome,row.email,row.telefone,row.whatsapp,row.mensagem,row.imovel_id,
        row.tipo_interesse,row.status,row.criado_em
      ].map(csvCell).join(';'));
      const csv = '\uFEFF' + [header.map(csvCell).join(';'), ...body].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads-fabiano-reis.csv"');
      res.send(csv);
    }
  );
});

app.get('/api/admin/imoveis/export.json', verificarCorretor, (req, res) => {
  db.all(
    `SELECT * FROM imoveis ORDER BY criado_em DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ erro: 'Erro ao exportar imóveis' });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="imoveis-fabiano-reis.json"');
      res.json({ exportado_em: new Date().toISOString(), imoveis: rows || [] });
    }
  );
});

// ============= DEPOIMENTOS (somente dados reais cadastrados) =============
app.get('/api/depoimentos', (req, res) => {
  db.all(
    'SELECT id, nome, cidade, texto, nota, criado_em FROM depoimentos WHERE aprovado = 1 ORDER BY criado_em DESC',
    [],
    (err, depoimentos) => {
      if (err) return res.json({ depoimentos: [] });
      res.json({ depoimentos: depoimentos || [] });
    }
  );
});

app.get('/api/admin/depoimentos', verificarCorretor, (req, res) => {
  db.all('SELECT * FROM depoimentos ORDER BY criado_em DESC', [], (err, depoimentos) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar depoimentos' });
    res.json({ depoimentos: depoimentos || [] });
  });
});

app.post('/api/admin/depoimentos', verificarCorretor, (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 120);
  const cidade = String(req.body?.cidade || '').trim().slice(0, 120);
  const texto = String(req.body?.texto || '').trim().slice(0, 1200);
  const notaBruta = Number(req.body?.nota);
  const nota = Number.isFinite(notaBruta) && notaBruta >= 1 && notaBruta <= 5 ? Math.trunc(notaBruta) : null;
  const aprovado = Number(Boolean(Number(req.body?.aprovado) || req.body?.aprovado === true));

  if (nome.length < 2) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  if (texto.length < 10) return res.status(400).json({ erro: 'O depoimento precisa ter pelo menos 10 caracteres.' });

  db.run(
    'INSERT INTO depoimentos (nome, cidade, texto, nota, aprovado) VALUES (?, ?, ?, ?, ?)',
    [nome, cidade, texto, nota, aprovado],
    function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao salvar depoimento' });
      res.json({ id: this.lastID, mensagem: 'Depoimento cadastrado com sucesso' });
    }
  );
});

app.put('/api/admin/depoimentos/:id', verificarCorretor, (req, res) => {
  const aprovado = Number(Boolean(Number(req.body?.aprovado) || req.body?.aprovado === true));
  db.run('UPDATE depoimentos SET aprovado = ? WHERE id = ?', [aprovado, req.params.id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar depoimento' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Depoimento não encontrado' });
    res.json({ mensagem: aprovado ? 'Depoimento publicado' : 'Depoimento ocultado' });
  });
});

app.delete('/api/admin/depoimentos/:id', verificarCorretor, (req, res) => {
  db.run('DELETE FROM depoimentos WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ erro: 'Erro ao excluir depoimento' });
    if (this.changes === 0) return res.status(404).json({ erro: 'Depoimento não encontrado' });
    res.json({ mensagem: 'Depoimento excluído' });
  });
});

// ============= PÁGINA INDIVIDUAL DO IMÓVEL (URL amigável + SEO) =============
// Aceita /imovel/123 e /imovel/casa-3-quartos-copacabana-123
app.get(['/imovel/:slugId', '/imovel/:slugId/'], (req, res, next) => {
  const match = String(req.params.slugId || '').match(/(\d+)$/);
  if (!match) return next();
  const id = Number(match[1]);

  db.get('SELECT * FROM imoveis WHERE id = ? AND ativo = 1', [id], (err, imovel) => {
    if (err) return next(err);
    if (!imovel) return responder404(req, res);

    db.all(
      "SELECT * FROM imovel_midias WHERE imovel_id = ? ORDER BY principal DESC, ordem ASC, id ASC",
      [id],
      (midiaErr, midias) => {
        const lista = midiaErr ? [] : (midias || []);
        const capa = lista.find(m => m.tipo === 'imagem') || null;
        const slug = slugImovel(imovel);
        const canonica = `${baseUrlDaRequisicao(req)}/imovel/${slug}-${id}`;

        // Redireciona slugs antigos/errados para a URL canônica (bom para SEO).
        if (req.params.slugId !== `${slug}-${id}`) {
          return res.redirect(301, `/imovel/${slug}-${id}`);
        }

        const preco = Number(imovel.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const titulo = `${imovel.titulo} — ${preco} | ${imovel.bairro}, ${imovel.cidade}`;
        const descricaoBase = String(imovel.descricao || '').replace(/\s+/g, ' ').trim();
        const descricao = (descricaoBase || `${imovel.tipo} para ${imovel.operacao} em ${imovel.bairro}, ${imovel.cidade}.`).slice(0, 155);
        const imagem = capa ? String(capa.arquivo || capa.url_externa || '') : '';
        const imagemAbsoluta = imagem
          ? (/^https?:\/\//i.test(imagem) ? imagem : `${baseUrlDaRequisicao(req)}${imagem}`)
          : '';

        const jsonLd = {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Product',
              name: imovel.titulo,
              description: descricaoBase || undefined,
              image: imagemAbsoluta || undefined,
              url: canonica,
              offers: {
                '@type': 'Offer',
                price: Number(imovel.preco || 0),
                priceCurrency: 'BRL',
                availability: 'https://schema.org/InStock',
                url: canonica
              }
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Início', item: `${baseUrlDaRequisicao(req)}/` },
                { '@type': 'ListItem', position: 2, name: 'Imóveis', item: `${baseUrlDaRequisicao(req)}/#imoveis` },
                { '@type': 'ListItem', position: 3, name: imovel.titulo, item: canonica }
              ]
            }
          ]
        };

        try {
          let html = fs.readFileSync(path.join(__dirname, 'public', 'imovel.html'), 'utf8');
          html = html
            .replace(/%%TITULO%%/g, escapeHtmlServidor(titulo))
            .replace(/%%DESCRICAO%%/g, escapeHtmlServidor(descricao))
            .replace(/%%CANONICA%%/g, escapeHtmlServidor(canonica))
            .replace(/%%IMAGEM%%/g, escapeHtmlServidor(imagemAbsoluta))
            .replace(/%%JSONLD%%/g, JSON.stringify(jsonLd).replace(/</g, '\\u003c'))
            .replace(/%%IMOVEL_ID%%/g, String(id));
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=60');
          return res.send(html);
        } catch (readErr) {
          return next(readErr);
        }
      }
    );
  });
});

// Páginas institucionais
app.get('/privacidade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacidade.html')));
app.get('/termos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'termos.html')));

// ============= 404 PROFISSIONAL =============
function responder404(req, res) {
  res.status(404);
  if (req.path.startsWith('/api/')) return res.json({ erro: 'Recurso não encontrado' });
  if (String(req.headers.accept || '').includes('text/html')) {
    return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  return res.type('txt').send('Não encontrado');
}

app.use((req, res) => responder404(req, res));

// Tratador de erros final: mensagens de upload são úteis ao usuário; qualquer
// outra falha retorna mensagem genérica e o detalhe fica apenas no log.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const mensagens = {
      LIMIT_FILE_SIZE: 'Arquivo maior que o limite permitido.',
      LIMIT_FILE_COUNT: 'Quantidade de arquivos acima do limite.',
      LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado.'
    };
    return res.status(400).json({ erro: mensagens[err.code] || 'Erro no upload do arquivo.' });
  }
  // Erros de validação de upload (formato/extensão/pasta) são úteis ao usuário.
  if (err && /formato|extens[aã]o|pasta de m[ií]dia|tipo (?:de )?(?:arquivo|imagem|v[ií]deo)|tipo MIME/i.test(err.message || '')) {
    return res.status(400).json({ erro: err.message });
  }
  console.error('[ERRO NÃO TRATADO]', err?.stack || err);
  res.status(500).json({ erro: 'Não foi possível concluir a operação. Tente novamente.' });
});

// ============= INICIAR SERVIDOR =============

app.listen(PORT, () => {
    console.log('');
    console.log('==========================================');
    console.log(`  IMOBILIARIA FABIANO REIS - V${APP_VERSION}`);
    console.log('==========================================');
    console.log(`  Porta.......: ${PORT}`);
    console.log(`  Ambiente....: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Banco.......: ${db.mode === 'postgres' ? 'PostgreSQL/Neon' : 'SQLite (local)'}`);
    console.log(`  Storage.....: ${midiaStorage.provider}${midiaStorage.isLocal ? ` (${midiaStorage.mediaRoot})` : ''}`);
    console.log(`  Health......: /health`);
    console.log('==========================================');
    console.log('');
  });

module.exports = app;
