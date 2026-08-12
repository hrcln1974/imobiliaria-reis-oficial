/*
 * V5.3 — Migração da base local SQLite para PostgreSQL/Neon.
 * Uso:
 *   vercel env pull .env.local
 *   set -a; source .env.local; set +a   # Linux/macOS/Git Bash
 *   npm run migrate:vercel
 *
 * A migração preserva IDs, imóveis, usuários, leads e mídias.
 * Arquivos locais referenciados por imovel_midias são enviados ao Vercel Blob.
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');

if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não está configurada.');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('ERRO: BLOB_READ_WRITE_TOKEN não está configurado.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const sqlitePath = path.join(root, 'database.db');
const sql = neon(process.env.DATABASE_URL);

function allSqlite(db, query, params = []) {
  return new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}

async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL,
    tipo TEXT DEFAULT 'cliente', ativo INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS imoveis (
    id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, descricao TEXT, preco DOUBLE PRECISION NOT NULL,
    tipo TEXT NOT NULL, operacao TEXT NOT NULL, endereco TEXT NOT NULL, numero TEXT,
    bairro TEXT NOT NULL, cidade TEXT NOT NULL, cep TEXT, quartos INTEGER, banheiros INTEGER,
    area DOUBLE PRECISION, garagem INTEGER DEFAULT 0, piscina INTEGER DEFAULT 0,
    destaque INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS imovel_midias (
    id SERIAL PRIMARY KEY, imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL, arquivo TEXT NOT NULL, url_externa TEXT, ordem INTEGER DEFAULT 0,
    principal INTEGER DEFAULT 0, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT NOT NULL,
    whatsapp TEXT, mensagem TEXT, imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL,
    tipo_interesse TEXT, status TEXT DEFAULT 'novo', criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
}

async function uploadMediaIfLocal(arquivo, tipo) {
  if (!arquivo || /^https?:\/\//i.test(arquivo)) return arquivo || '';
  if (!arquivo.startsWith('/uploads/')) return arquivo;
  const local = path.join(root, 'public', arquivo.replace(/^\//, ''));
  if (!fs.existsSync(local)) {
    console.warn(`AVISO: arquivo não encontrado, mantendo referência: ${arquivo}`);
    return arquivo;
  }
  const buffer = fs.readFileSync(local);
  const mime = tipo === 'video'
    ? ({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.ogg':'video/ogg'}[path.extname(local).toLowerCase()] || 'application/octet-stream')
    : ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.jfif':'image/jpeg'}[path.extname(local).toLowerCase()] || 'application/octet-stream');
  const folder = tipo === 'video' ? 'videos' : 'imagens';
  const pathname = `imoveis-migrados/${folder}/${path.basename(local)}`;
  const blob = await put(pathname, buffer, { access: 'public', addRandomSuffix: true, contentType: mime });
  console.log(`  mídia ${arquivo} -> ${blob.url}`);
  return blob.url;
}

async function migrateTable(rows, table, columns, valuesFor) {
  for (const row of rows) {
    const values = valuesFor(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const update = columns.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`).join(', ');
    await sql.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${update}`,
      values
    );
  }
}

async function setSequence(table) {
  await sql.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`);
}

(async () => {
  if (!fs.existsSync(sqlitePath)) throw new Error(`database.db não encontrado: ${sqlitePath}`);
  const db = new sqlite3.Database(sqlitePath);
  try {
    await ensureSchema();

    const usuarios = await allSqlite(db, 'SELECT * FROM usuarios ORDER BY id');
    const imoveis = await allSqlite(db, 'SELECT * FROM imoveis ORDER BY id');
    const leads = await allSqlite(db, 'SELECT * FROM leads ORDER BY id');
    const midias = await allSqlite(db, 'SELECT * FROM imovel_midias ORDER BY id');

    console.log(`SQLite encontrado: ${usuarios.length} usuários, ${imoveis.length} imóveis, ${midias.length} mídias, ${leads.length} leads.`);

    await migrateTable(usuarios, 'usuarios', ['id','nome','email','senha','tipo','ativo','criado_em'], r => [r.id,r.nome,r.email,r.senha,r.tipo,r.ativo,r.criado_em]);
    await migrateTable(imoveis, 'imoveis', ['id','titulo','descricao','preco','tipo','operacao','endereco','numero','bairro','cidade','cep','quartos','banheiros','area','garagem','piscina','destaque','ativo','criado_em'], r => [r.id,r.titulo,r.descricao,r.preco,r.tipo,r.operacao,r.endereco,r.numero,r.bairro,r.cidade,r.cep,r.quartos,r.banheiros,r.area,r.garagem,r.piscina,r.destaque,r.ativo,r.criado_em]);
    await migrateTable(leads, 'leads', ['id','nome','email','telefone','whatsapp','mensagem','imovel_id','tipo_interesse','status','criado_em'], r => [r.id,r.nome,r.email,r.telefone,r.whatsapp,r.mensagem,r.imovel_id,r.tipo_interesse,r.status,r.criado_em]);

    for (const r of midias) {
      const arquivo = await uploadMediaIfLocal(r.arquivo, r.tipo);
      const cols = ['id','imovel_id','tipo','arquivo','url_externa','ordem','principal','criado_em'];
      await sql.query(
        `INSERT INTO imovel_midias (${cols.join(', ')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(', ')})
         ON CONFLICT (id) DO UPDATE SET imovel_id=EXCLUDED.imovel_id,tipo=EXCLUDED.tipo,arquivo=EXCLUDED.arquivo,url_externa=EXCLUDED.url_externa,ordem=EXCLUDED.ordem,principal=EXCLUDED.principal,criado_em=EXCLUDED.criado_em`,
        [r.id,r.imovel_id,r.tipo,arquivo,r.url_externa,r.ordem,r.principal,r.criado_em]
      );
    }

    for (const table of ['usuarios','imoveis','imovel_midias','leads']) await setSequence(table);
    console.log('MIGRAÇÃO CONCLUÍDA — PostgreSQL/Neon e Vercel Blob atualizados.');
  } finally {
    db.close();
  }
})().catch(err => {
  console.error('MIGRAÇÃO FALHOU:', err.message || err);
  process.exit(1);
});
