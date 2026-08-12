require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../db-adapter');

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const nome = String(process.env.ADMIN_NAME || 'Fabiano Reis').trim();

  // Produção: DATABASE_URL (Neon). Desenvolvimento: SQLite local.
  console.log(db.mode === 'postgres'
    ? 'Banco: PostgreSQL/Neon (produção).'
    : 'Banco: SQLite local (desenvolvimento). Configure DATABASE_URL para provisionar em produção.');

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error('ERRO: ADMIN_EMAIL não configurado ou inválido.');
    process.exitCode = 1;
    return;
  }

  if (password.length < 12) {
    console.error('ERRO: ADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
    process.exitCode = 1;
    return;
  }

  await db.ready;

  if (db.mode !== 'postgres') {
    // Garante o schema local antes de inserir (mesmo DDL do server.js).
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, tipo TEXT DEFAULT 'cliente', ativo INTEGER DEFAULT 1, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        err => err ? reject(err) : resolve()
      );
    });
  }

  const hash = bcrypt.hashSync(password, 12);

  const existing = await new Promise((resolve, reject) => {
    db.get('SELECT id FROM usuarios WHERE email = ?', [email], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (existing) {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE usuarios SET nome = ?, senha = ?, tipo = ?, ativo = 1 WHERE id = ?',
        [nome, hash, 'corretor', existing.id],
        err => err ? reject(err) : resolve()
      );
    });
    console.log(`Administrador atualizado com sucesso: ${email}`);
  } else {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO usuarios (nome, email, senha, tipo, ativo) VALUES (?, ?, ?, ?, 1)',
        [nome, email, hash, 'corretor'],
        err => err ? reject(err) : resolve()
      );
    });
    console.log(`Administrador criado com sucesso: ${email}`);
  }
}

main().catch(err => {
  console.error('Falha ao provisionar administrador:', err.message);
  process.exitCode = 1;
});
