/**
 * Adaptador SQLite baseado no módulo nativo do Node (`node:sqlite`).
 *
 * Serve como alternativa ao pacote `sqlite3` (que exige compilação nativa e
 * falha em máquinas/containers sem toolchain de build). A interface exposta é
 * compatível com a usada pelo projeto: get/all/run/prepare/serialize/close com
 * callbacks no estilo node-sqlite3, incluindo `this.lastID` e `this.changes`.
 *
 * Requer Node.js 22.5+ (ou 20.x com `--experimental-sqlite`).
 */
const { DatabaseSync } = require('node:sqlite');

function normalizeParams(params) {
  const list = Array.isArray(params) ? params : params == null ? [] : [params];
  return list.map(value => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value;
    if (value instanceof Uint8Array) return value;
    return String(value);
  });
}

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

class NodeSqliteStatement {
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

class NodeSqliteCompat {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.mode = 'sqlite';
    this.driver = 'node:sqlite';
    this.ready = Promise.resolve(true);
  }

  _done(callback, err, value, context) {
    if (typeof callback !== 'function') return;
    setImmediate(() => callback.call(context || null, err || null, value));
  }

  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
      const row = this.db.prepare(sql).get(...normalizeParams(params));
      this._done(callback, null, row);
    } catch (err) {
      this._done(callback, err);
    }
  }

  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
      const rows = this.db.prepare(sql).all(...normalizeParams(params));
      this._done(callback, null, rows);
    } catch (err) {
      this._done(callback, err);
    }
  }

  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
      const result = this.db.prepare(sql).run(...normalizeParams(params));
      const context = {
        lastID: toNumber(result.lastInsertRowid),
        changes: toNumber(result.changes)
      };
      this._done(callback, null, undefined, context);
    } catch (err) {
      this._done(callback, err, undefined, { lastID: undefined, changes: 0 });
    }
  }

  exec(sql, callback) {
    try {
      this.db.exec(sql);
      this._done(callback, null);
    } catch (err) {
      this._done(callback, err);
    }
  }

  prepare(sql) {
    return new NodeSqliteStatement(this, sql);
  }

  // As operações são síncronas neste driver: a ordem já é garantida.
  serialize(callback) {
    callback();
  }

  close(callback) {
    try {
      this.db.close();
      this._done(callback, null);
    } catch (err) {
      this._done(callback, err);
    }
  }
}

module.exports = NodeSqliteCompat;
