const path = require('path');

// P002 — em produção, DATABASE_URL é obrigatório. Nunca cair silenciosamente
// para SQLite: isso perderia dados a cada novo deploy/restart em disco efêmero.
const IS_PRODUCTION_DB = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION_DB && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL não configurado em produção (NODE_ENV=production). ' +
    'A aplicação recusa iniciar para evitar fallback silencioso para SQLite, ' +
    'que causaria perda de dados a cada deploy/restart. Configure DATABASE_URL ' +
    '(PostgreSQL/Neon) nas variáveis de ambiente.'
  );
}

const usePostgres = Boolean(process.env.DATABASE_URL);

function convertPlaceholders(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => `$${++index}`);
}

class PgStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }
  run(params, callback) {
    this.db.run(this.sql, params, callback);
    return this;
  }
  finalize(callback) {
    if (callback) setImmediate(callback);
  }
}

class PostgresCompat {
  constructor(url) {
    this.url = url;
    this._queue = Promise.resolve();
    this.ready = this._init();
  }

  async _init() {
    const { neon } = require('@neondatabase/serverless');
    this.sql = neon(this.url);
    await this.sql.query('SELECT 1');
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        tipo TEXT DEFAULT 'cliente',
        ativo INTEGER DEFAULT 1,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS imoveis (
        id SERIAL PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT,
        preco DOUBLE PRECISION NOT NULL,
        tipo TEXT NOT NULL,
        operacao TEXT NOT NULL,
        endereco TEXT NOT NULL,
        numero TEXT,
        bairro TEXT NOT NULL,
        cidade TEXT NOT NULL,
        cep TEXT,
        quartos INTEGER,
        banheiros INTEGER,
        area DOUBLE PRECISION,
        garagem INTEGER DEFAULT 0,
        piscina INTEGER DEFAULT 0,
        destaque INTEGER DEFAULT 0,
        caracteristicas_json TEXT DEFAULT '[]',
        ativo INTEGER DEFAULT 1,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS imovel_midias (
        id SERIAL PRIMARY KEY,
        imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        arquivo TEXT NOT NULL,
        url_externa TEXT,
        ordem INTEGER DEFAULT 0,
        principal INTEGER DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        telefone TEXT NOT NULL,
        whatsapp TEXT,
        mensagem TEXT,
        imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL,
        tipo_interesse TEXT,
        status TEXT DEFAULT 'novo',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS depoimentos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cidade TEXT,
        texto TEXT NOT NULL,
        nota INTEGER,
        aprovado INTEGER DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS caracteristicas_json TEXT DEFAULT '[]'`);
    // Migração incremental (não destrutiva): orçamento estimado do lead.
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS orcamento TEXT`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'site'`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS cidade TEXT`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS bairro TEXT`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS quartos INTEGER`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS faixa_preco_min DOUBLE PRECISION`);
    await this.sql.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS faixa_preco_max DOUBLE PRECISION`);
    await this.sql.query(`CREATE TABLE IF NOT EXISTS clientes (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT, telefone TEXT, whatsapp TEXT, cidade TEXT, observacoes TEXT, origem TEXT DEFAULT 'site', criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await this.sql.query(`CREATE TABLE IF NOT EXISTS interacoes_crm (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE, lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL, imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL, tipo TEXT NOT NULL, descricao TEXT, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await this.sql.query(`CREATE TABLE IF NOT EXISTS visitas (id SERIAL PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL, lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL, imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL, data_visita TEXT NOT NULL, hora_visita TEXT, status TEXT DEFAULT 'agendado', observacoes TEXT, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_origem ON leads (origem)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_interacoes_cliente ON interacoes_crm (cliente_id, criado_em DESC)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_visitas_data ON visitas (data_visita, status)`);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens (token_hash)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id, criado_em DESC)`);
    // Índices para listagens públicas.
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_ativo ON imoveis (ativo)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_midias_imovel ON imovel_midias (imovel_id)`);
    // V7.1 Premium — índices alinhados às consultas reais (catálogo, filtros,
    // destaques da home, galeria por imóvel, leads e depoimentos aprovados).
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_listagem ON imoveis (ativo, destaque, criado_em DESC)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_operacao ON imoveis (operacao)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_tipo ON imoveis (tipo)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_cidade_bairro ON imoveis (cidade, bairro)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_imoveis_preco ON imoveis (preco)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_midias_imovel_tipo ON imovel_midias (imovel_id, tipo, ordem)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads (criado_em DESC)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_leads_imovel ON leads (imovel_id)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_depoimentos_aprovado ON depoimentos (aprovado, criado_em DESC)`);
    await this.sql.query(`CREATE TABLE IF NOT EXISTS conversoes (id SERIAL PRIMARY KEY, imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE, tipo TEXT NOT NULL, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_conversoes_imovel_tipo_data ON conversoes (imovel_id, tipo, criado_em DESC)`);
    await this.sql.query(`CREATE INDEX IF NOT EXISTS idx_conversoes_data ON conversoes (criado_em DESC)`);
    return true;
  }

  async _query(sql, params = []) {
    await this.ready;
    const pgSql = convertPlaceholders(sql);
    return this.sql.query(pgSql, params);
  }

  _enqueue(work) {
    const run = this._queue.then(() => work());
    this._queue = run.catch(() => {});
    return run;
  }

  _callback(fn, err, value) {
    if (typeof fn !== 'function') return;
    setImmediate(() => fn(err || null, value));
  }

  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    this._enqueue(() => this._query(sql, params || []))
      .then(rows => this._callback(callback, null, rows[0]))
      .catch(err => this._callback(callback, err));
  }

  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    this._enqueue(() => this._query(sql, params || []))
      .then(rows => this._callback(callback, null, rows))
      .catch(err => this._callback(callback, err));
  }

  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    const original = String(sql).trim().replace(/;$/, '');
    const isInsert = /^INSERT\s+/i.test(original);
    const query = isInsert && !/\bRETURNING\b/i.test(original)
      ? `${original} RETURNING id`
      : original;
    this._enqueue(() => this._query(query, params || []))
      .then(rows => {
        const ctx = {
          changes: rows.length,
          lastID: rows[0] && rows[0].id != null ? Number(rows[0].id) : undefined
        };
        this._callback(callback, null, ctx);
      })
      .catch(err => this._callback(callback, err));
  }

  prepare(sql) {
    return new PgStatement(this, sql);
  }

  serialize(callback) {
    callback();
  }

  close(callback) {
    this._callback(callback, null);
  }
}

// SQLite local: usa o pacote `sqlite3` quando disponível e, se ele não estiver
// instalado (ambientes sem toolchain de compilação nativa), cai para o módulo
// nativo `node:sqlite` do Node 22.5+. Em produção com DATABASE_URL, nada disso
// é usado: o adaptador PostgreSQL/Neon assume.
function createSqlite() {
  // SQLITE_FILE permite isolar o banco (ex.: smoke test) sem tocar no database.db real.
  const file = process.env.SQLITE_FILE || path.join(__dirname, 'database.db');
  try {
    const sqlite3 = require('sqlite3').verbose();
    const instance = new sqlite3.Database(file);
    instance.mode = 'sqlite';
    instance.driver = 'sqlite3';
    instance.ready = Promise.resolve(true);
    return instance;
  } catch (err) {
    try {
      const NodeSqliteCompat = require('./db-sqlite-node');
      const instance = new NodeSqliteCompat(file);
      console.warn('[DB] Pacote sqlite3 indisponível; usando o driver nativo node:sqlite.');
      return instance;
    } catch (fallbackErr) {
      throw new Error(
        'Nenhum driver SQLite disponível. Instale o pacote sqlite3 (npm install sqlite3) ' +
        'ou use Node.js 22.5+ para o driver nativo node:sqlite. Detalhe: ' + (fallbackErr.message || fallbackErr)
      );
    }
  }
}

let db;
if (usePostgres) {
  db = new PostgresCompat(process.env.DATABASE_URL);
  db.mode = 'postgres';
  db.driver = 'neon-postgres';
} else {
  db = createSqlite();
}

module.exports = db;
