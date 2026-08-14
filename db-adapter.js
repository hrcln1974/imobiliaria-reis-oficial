const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

  _callback(fn, err, value, context) {
    if (typeof fn !== 'function') return;
    setImmediate(() => fn.call(context, err || null, value));
  }

  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    this._enqueue(() => this._query(sql, params || []))
      .then(rows => this._callback(callback, null, rows[0], undefined))
      .catch(err => this._callback(callback, err));
  }

  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    this._enqueue(() => this._query(sql, params || []))
      .then(rows => this._callback(callback, null, rows, undefined))
      .catch(err => this._callback(callback, err));
  }

  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    const original = String(sql).trim().replace(/;$/, '');
    const isInsert = /^INSERT\s+/i.test(original);
    const isUpdate = /^UPDATE\s+/i.test(original);
    const isDelete = /^DELETE\s+/i.test(original);
    const query = (isInsert || isUpdate || isDelete) && !/\bRETURNING\b/i.test(original)
      ? `${original} RETURNING id`
      : original;
    this._enqueue(() => this._query(query, params || []))
      .then(rows => {
        const ctx = {
          changes: rows.length,
          lastID: rows[0] && rows[0].id != null ? Number(rows[0].id) : undefined
        };
        this._callback(callback, null, ctx, ctx);
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

let db;
if (usePostgres) {
  db = new PostgresCompat(process.env.DATABASE_URL);
  db.mode = 'postgres';
} else {
  db = new sqlite3.Database(path.join(__dirname, 'database.db'));
  db.mode = 'sqlite';
  db.ready = Promise.resolve(true);
}

module.exports = db;
