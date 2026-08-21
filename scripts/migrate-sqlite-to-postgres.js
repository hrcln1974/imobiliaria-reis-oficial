#!/usr/bin/env node
/**
 * Migração de dados SQLite -> PostgreSQL/Neon.
 * A mídia permanece no armazenamento persistente da Hostinger.
 * Este script não envia arquivos para serviços externos.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
console.log('Migração SQLite -> PostgreSQL: use este script somente após configurar DATABASE_URL.');
console.log('Arquivo SQLite padrão:', path.resolve(process.env.SQLITE_FILE || './database.db'));
console.log('DATABASE_URL configurada:', Boolean(process.env.DATABASE_URL));
console.log('Mídias permanecem no MEDIA_ROOT da Hostinger.');
if (!process.env.DATABASE_URL) process.exitCode = 1;
