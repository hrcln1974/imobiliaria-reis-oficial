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
const IS_VERCEL = Boolean(process.env.VERCEL);
const SECRET = process.env.JWT_SECRET || (IS_VERCEL ? '' : 'dev-only-secret-change-me');
if (IS_VERCEL && !SECRET) {
  throw new Error('JWT_SECRET não configurado no Vercel. Configure uma chave forte nas Environment Variables.');
}

// Middleware
const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const defaultCorsOrigins = [
  'https://imobiliaria-fabiano-oficial.vercel.app',
  'http://localhost:3000'
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

// Armazenamento: disco local na V5.2/ambiente local; Vercel usa Vercel Blob.
const USE_BLOB = db.mode === 'postgres';
// Diretórios de mídia local. Em Vercel/Blob não são usados (filesystem read-only).
if (!IS_VERCEL && !USE_BLOB) {
  for (const pasta of ['imagens', 'videos']) {
    try { fs.mkdirSync(path.join(__dirname, 'public', 'uploads', pasta), { recursive: true }); } catch (_) {}
  }
}
const storage = USE_BLOB ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads/imagens');
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!permitidos.includes(file.mimetype)) return cb(new Error('Formato de imagem não permitido'));
    cb(null, true);
  }
});

const videoStorage = USE_BLOB ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads/videos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${baseName}${ext}`);
  }
});

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
  const dir = path.join(__dirname, 'public', 'uploads', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${folder}/${filename}`;
}

async function removeStoredAsset(asset) {
  if (!asset) return;
  if (/^https?:\/\//i.test(asset)) {
    if (USE_BLOB && /\.blob\.vercel-storage\.com/i.test(asset)) {
      try { await blobDel(asset); } catch (_) {}
    }
    return;
  }
  if (asset.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, 'public', asset.replace(/^\//, ''));
    try { await fs.promises.unlink(filePath); } catch (_) {}
  }
}

const uploadVideos = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 3 },
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

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, tipo TEXT DEFAULT 'cliente', ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS imoveis (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, descricao TEXT, preco REAL NOT NULL, tipo TEXT NOT NULL, operacao TEXT NOT NULL, endereco TEXT NOT NULL, numero TEXT, bairro TEXT NOT NULL, cidade TEXT NOT NULL, cep TEXT, quartos INTEGER, banheiros INTEGER, area REAL, garagem INTEGER DEFAULT 0, piscina INTEGER DEFAULT 0, destaque INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS imovel_midias (id INTEGER PRIMARY KEY AUTOINCREMENT, imovel_id INTEGER NOT NULL, tipo TEXT NOT NULL, arquivo TEXT NOT NULL, url_externa TEXT, ordem INTEGER DEFAULT 0, principal INTEGER DEFAULT 0, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT NOT NULL, whatsapp TEXT, mensagem TEXT, imovel_id INTEGER, tipo_interesse TEXT, status TEXT DEFAULT 'novo', criado_em DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(imovel_id) REFERENCES imoveis(id))`);
  });

  return Promise.resolve(true);
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
app.post('/api/register', (req, res) => {
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
    res.json({ imoveis });
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
  const { titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque } = req.body;

  db.run(
    `INSERT INTO imoveis (titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [titulo, descricao, preco, tipo, operacao, endereco, numero, bairro, cidade, cep, quartos, banheiros, area, garagem, piscina, destaque || 0],
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
    'piscina','destaque','ativo'
  ];

  const entradas = Object.entries(req.body || {})
    .filter(([campo, valor]) => camposPermitidos.includes(campo) && valor !== undefined);

  if (!entradas.length) {
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });
  }

  const sets = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([campo, valor]) => {
    if (['piscina','destaque','ativo'].includes(campo)) return Number(Boolean(valor));
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

// Exclusão definitiva: remove o imóvel, suas mídias no banco e tenta remover
// também os arquivos físicos/Vercel Blob associados. A rota fica separada da
// desativação lógica para evitar apagar anúncios por engano.
app.post('/api/imoveis/:id/excluir-definitivo', verificarCorretor, (req, res) => {
  const { id } = req.params;

  db.get('SELECT id, titulo FROM imoveis WHERE id = ?', [id], (err, imovel) => {
    if (err) return res.status(500).json({ erro: 'Erro ao localizar imóvel' });
    if (!imovel) return res.status(404).json({ erro: 'Imóvel não encontrado' });

    db.all(
      'SELECT id, arquivo FROM imovel_midias WHERE imovel_id = ?',
      [id],
      (mediaErr, midias) => {
        if (mediaErr) return res.status(500).json({ erro: 'Erro ao localizar mídias do imóvel' });

        db.run('DELETE FROM imovel_midias WHERE imovel_id = ?', [id], function(mediaDeleteErr) {
          if (mediaDeleteErr) return res.status(500).json({ erro: 'Erro ao remover mídias do imóvel: ' + mediaDeleteErr.message });

          db.run('DELETE FROM imoveis WHERE id = ?', [id], async function(deleteErr) {
            if (deleteErr) return res.status(500).json({ erro: 'Erro ao excluir imóvel: ' + deleteErr.message });
            if (this.changes !== 1) return res.status(404).json({ erro: 'Imóvel não encontrado' });

            let falhasArquivos = 0;
            for (const media of (midias || [])) {
              try { await removeStoredAsset(media.arquivo); } catch (_) { falhasArquivos += 1; }
            }

            console.log(`[IMOVEL] Imóvel ${id} excluído definitivamente (${midias?.length || 0} mídias)`);
            res.json({
              mensagem: falhasArquivos
                ? 'Imóvel excluído do banco. Algumas mídias não puderam ser removidas do armazenamento.'
                : 'Imóvel e suas mídias excluídos definitivamente com sucesso.',
              id: Number(id),
              midiasExcluidas: (midias || []).length,
              falhasArquivos
            });
          });
        });
      }
    );
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
  res.json({ ok: true, servico: 'fabiano-reis-imoveis', timestamp: new Date().toISOString() });
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
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const permitidos = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Formato de imagem não permitido'));
    }

    cb(null, true);
  }
});

app.post(
  '/api/imoveis/:id/fotos',
  verificarCorretor,
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

      const row = await new Promise((resolve, reject) => {
        db.get(
          'SELECT COUNT(*) AS total FROM imovel_midias WHERE imovel_id = ?',
          [id],
          (err, value) => err ? reject(err) : resolve(value)
        );
      });

      const mainRow = await new Promise((resolve, reject) => {
        db.get(
          'SELECT COUNT(*) AS principal FROM imovel_midias WHERE imovel_id = ? AND principal = 1',
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
        useBlob: USE_BLOB,
        hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        files: (req.files || []).map(file => ({
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        }))
      });

      res.status(500).json({
        erro: err?.message || 'Erro ao salvar as fotos',
        codigo: err?.code || null
      });
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
      db.run(
        `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'video'`,
        [videoId, imovelId],
        async function(deleteErr) {
          if (deleteErr) return res.status(500).json({ erro: 'Erro ao excluir vídeo' });
          await removeStoredAsset(video.arquivo);
          res.json({ mensagem: 'Vídeo excluído com sucesso' });
        }
      );
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
    "SELECT id, imovel_id, arquivo, url_externa, ordem, principal, criado_em FROM imovel_midias WHERE imovel_id = ? AND tipo = 'imagem' ORDER BY ordem ASC, criado_em DESC",
    [id],
    (err, imagens) => {
      if (err) {
        console.error('[IMAGENS] Erro ao buscar imagens:', err);
        return res.status(500).json({ erro: 'Erro ao buscar imagens no banco de dados' });
      }
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

app.delete('/api/imoveis/:imovelId/imagens/:imagemId', verificarCorretor, (req, res) => {
  const { imovelId, imagemId } = req.params;

  db.get(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, principal
     FROM imovel_midias
     WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
    [imagemId, imovelId],
    (err, imagem) => {
      if (err) {
        console.error('[MÍDIA] Erro ao buscar imagem para exclusão:', err);
        return res.status(500).json({ erro: 'Erro ao buscar imagem no banco de dados' });
      }
      if (!imagem) return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });

      db.run(
        `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
        [imagemId, imovelId],
        function(deleteErr) {
          if (deleteErr) return res.status(500).json({ erro: 'Erro ao excluir foto: ' + deleteErr.message });
          if (this.changes !== 1) return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });

          console.log(`[MÍDIA] Foto ${imagemId} excluída do imóvel ${imovelId}`);

          // Se a foto excluída era a principal, promove a primeira foto restante.
          const promoverProxima = async () => {
            await removeStoredAsset(imagem.arquivo);
            if (!Number(imagem.principal)) return res.json({
              mensagem: 'Foto excluída com sucesso',
              novaPrincipal: false
            });

            db.get(
              `SELECT id FROM imovel_midias
               WHERE imovel_id = ? AND tipo = 'imagem'
               ORDER BY ordem ASC, criado_em ASC
               LIMIT 1`,
              [imovelId],
              (nextErr, proxima) => {
                if (nextErr) return res.status(500).json({ erro: 'Foto excluída, mas não foi possível definir a nova principal' });
                if (!proxima) return res.json({
                  mensagem: 'Foto excluída com sucesso. O imóvel ficou sem foto principal.',
                  novaPrincipal: false
                });

                db.run(
                  'UPDATE imovel_midias SET principal = 1 WHERE id = ? AND imovel_id = ? AND tipo = ?',
                  [proxima.id, imovelId, 'imagem'],
                  (promoteErr) => {
                    if (promoteErr) return res.status(500).json({ erro: 'Foto excluída, mas não foi possível definir a nova principal' });
                    res.json({
                      mensagem: 'Foto excluída e nova foto principal definida com sucesso',
                      novaPrincipal: true,
                      novaPrincipalId: proxima.id
                    });
                  }
                );
              }
            );
          };

          promoverProxima();
        }
      );
    }
  );
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
app.post('/api/imoveis/:imovelId/imagens/:imagemId/excluir', verificarCorretor, (req, res) => {
  const { imovelId, imagemId } = req.params;

  db.get(
    `SELECT id, imovel_id, tipo, arquivo, url_externa, principal
     FROM imovel_midias
     WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
    [imagemId, imovelId],
    (err, imagem) => {
      if (err) {
        console.error('[MÍDIA] Erro ao buscar imagem para exclusão:', err);
        return res.status(500).json({ erro: 'Erro ao buscar imagem no banco de dados' });
      }
      if (!imagem) return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });

      db.run(
        `DELETE FROM imovel_midias WHERE id = ? AND imovel_id = ? AND tipo = 'imagem'`,
        [imagemId, imovelId],
        function(deleteErr) {
          if (deleteErr) return res.status(500).json({ erro: 'Erro ao excluir foto: ' + deleteErr.message });
          if (this.changes !== 1) return res.status(404).json({ erro: 'Foto não encontrada neste imóvel' });

          console.log(`[MÍDIA] Foto ${imagemId} excluída do imóvel ${imovelId}`);

          // Se a foto excluída era a principal, promove a primeira foto restante.
          const promoverProxima = async () => {
            await removeStoredAsset(imagem.arquivo);
            if (!Number(imagem.principal)) return res.json({
              mensagem: 'Foto excluída com sucesso',
              novaPrincipal: false
            });

            db.get(
              `SELECT id FROM imovel_midias
               WHERE imovel_id = ? AND tipo = 'imagem'
               ORDER BY ordem ASC, criado_em ASC
               LIMIT 1`,
              [imovelId],
              (nextErr, proxima) => {
                if (nextErr) return res.status(500).json({ erro: 'Foto excluída, mas não foi possível definir a nova principal' });
                if (!proxima) return res.json({
                  mensagem: 'Foto excluída com sucesso. O imóvel ficou sem foto principal.',
                  novaPrincipal: false
                });

                db.run(
                  'UPDATE imovel_midias SET principal = 1 WHERE id = ? AND imovel_id = ? AND tipo = ?',
                  [proxima.id, imovelId, 'imagem'],
                  (promoteErr) => {
                    if (promoteErr) return res.status(500).json({ erro: 'Foto excluída, mas não foi possível definir a nova principal' });
                    res.json({
                      mensagem: 'Foto excluída e nova foto principal definida com sucesso',
                      novaPrincipal: true,
                      novaPrincipalId: proxima.id
                    });
                  }
                );
              }
            );
          };

          promoverProxima();
        }
      );
    }
  );
});

// (Rota duplicada de foto principal removida na V6.2 — a definição válida está acima.)

// ============= ROTAS DE LEADS =============

app.post('/api/leads', (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const telefone = String(req.body?.telefone || '').trim();
  const whatsapp = String(req.body?.whatsapp || '').trim();
  const mensagem = String(req.body?.mensagem || '').trim();
  const imovel_id = req.body?.imovel_id;
  const tipo_interesse = String(req.body?.tipo_interesse || '').trim();

  if (nome.length < 2 || nome.length > 120) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  if (telefone.replace(/\D/g, '').length < 10) return res.status(400).json({ erro: 'Informe um telefone válido com DDD.' });
  if (mensagem.length < 5 || mensagem.length > 2000) return res.status(400).json({ erro: 'Escreva uma mensagem com mais detalhes.' });

  db.run(
    "INSERT INTO leads (nome, email, telefone, whatsapp, mensagem, imovel_id, tipo_interesse) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [nome, email, telefone, whatsapp || '', mensagem, imovel_id || null, tipo_interesse || 'geral'],
    function(err) {
      if (err) return res.status(500).json({ erro: 'Erro ao registrar interesse' });
      res.json({ mensagem: 'Seu interesse foi registrado. Fabiano entrará em contato!' });
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
    facebook: 'https://www.facebook.com/share/14n16MN3h15/'
  });
});


app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ erro: err.message || 'Erro no upload' });
  }
  next(err);
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
