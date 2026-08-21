const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const provider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
if (provider !== 'local') {
  throw new Error(`STORAGE_PROVIDER inválido: ${provider}. Esta versão V12.1 usa armazenamento local persistente para Hostinger.`);
}

const mediaRoot = path.resolve(
  process.env.MEDIA_ROOT ||
  path.join(process.cwd(), 'storage', 'uploads')
);
const isLocal = true;

const IMAGE_MIMES = new Set(['image/jpeg','image/png','image/webp','image/gif']);
const VIDEO_MIMES = new Set(['video/mp4','video/webm','video/ogg','video/quicktime']);

function garantirDiretorios() {
  fs.mkdirSync(path.join(mediaRoot, 'imagens'), { recursive: true });
  fs.mkdirSync(path.join(mediaRoot, 'videos'), { recursive: true });
}

function validarUpload(file, tiposPermitidos = []) {
  if (!file) return 'Nenhum arquivo enviado.';
  const mime = String(file.mimetype || '').toLowerCase();
  if (!tiposPermitidos.includes(mime)) {
    return `Tipo de arquivo não permitido: ${mime || 'desconhecido'}.`;
  }
  const original = String(file.originalname || '');
  const ext = path.extname(original).toLowerCase();
  const extensoesPerigosas = new Set([
    '.php','.phtml','.phar','.js','.mjs','.cjs','.html','.htm','.svg',
    '.exe','.dll','.bat','.cmd','.ps1','.sh','.asp','.aspx','.jsp'
  ]);
  if (extensoesPerigosas.has(ext)) return 'Extensão de arquivo não permitida.';
  return null;
}

function readFileBuffer(file) {
  if (file?.buffer) return Promise.resolve(file.buffer);
  if (file?.path) return fs.promises.readFile(file.path);
  if (file?.destination && file?.filename) {
    return fs.promises.readFile(path.join(file.destination, file.filename));
  }
  return Promise.reject(new Error('Não foi possível ler o arquivo recebido.'));
}

function detectSignature(buffer, kind) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (kind === 'image') {
    const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    const gif = ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii'));
    const webp = buffer.length >= 12 && buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii') === 'WEBP';
    return jpeg || png || gif || webp;
  }
  if (kind === 'video') {
    const mp4 = buffer.length >= 12 && buffer.subarray(4,8).toString('ascii') === 'ftyp';
    const webm = buffer.length >= 4 && buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
    const ogg = buffer.subarray(0,4).toString('ascii') === 'OggS';
    return mp4 || webm || ogg;
  }
  return false;
}

async function validarConteudoRecebido(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const kind = IMAGE_MIMES.has(mime) ? 'image' : VIDEO_MIMES.has(mime) ? 'video' : null;
  if (!kind) return 'Tipo MIME não permitido.';
  try {
    const buffer = await readFileBuffer(file);
    if (!detectSignature(buffer, kind)) {
      if (file?.path) await fs.promises.unlink(file.path).catch(() => {});
      return 'O conteúdo do arquivo não corresponde ao tipo declarado.';
    }
  } catch (err) {
    return `Não foi possível validar o arquivo: ${err.message}`;
  }
  return null;
}

function safeFilename(originalName, fallbackExt = '.bin') {
  const original = String(originalName || `arquivo${fallbackExt}`);
  const ext = path.extname(original).toLowerCase() || fallbackExt;
  const base = path.basename(original, path.extname(original))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'arquivo';
  return `${Date.now()}-${crypto.randomUUID().slice(0,8)}-${base}${ext}`;
}

function multerStorage(folder) {
  garantirDiretorios();
  const multer = require('multer');
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(mediaRoot, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, safeFilename(file.originalname));
    }
  });
}

async function uploadFile(file, folder) {
  if (!file) throw new Error('Arquivo não enviado.');
  garantirDiretorios();
  if (file.path) {
    const expectedRoot = path.resolve(mediaRoot, folder) + path.sep;
    const actual = path.resolve(file.path);
    if (!actual.startsWith(expectedRoot)) throw new Error('Caminho de mídia inválido.');
    return `/uploads/${folder}/${path.basename(actual)}`;
  }
  const filename = safeFilename(file.originalname);
  const target = path.join(mediaRoot, folder, filename);
  await fs.promises.writeFile(target, file.buffer);
  return `/uploads/${folder}/${filename}`;
}

async function uploadBuffer(buffer, filename, contentType, folder) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Buffer de mídia inválido.');
  garantirDiretorios();
  const safe = path.basename(String(filename || 'arquivo.bin')).replace(/[^a-zA-Z0-9._-]/g, '_');
  await fs.promises.writeFile(path.join(mediaRoot, folder, safe), buffer);
  return `/uploads/${folder}/${safe}`;
}

async function deleteFile(asset) {
  if (!asset || /^https?:\/\//i.test(String(asset))) {
    return { removed: false, external: Boolean(asset) };
  }
  const value = String(asset);
  if (!value.startsWith('/uploads/')) return { removed: false, external: true };
  const relative = value.replace(/^\/uploads\//, '');
  const root = path.resolve(mediaRoot) + path.sep;
  const filePath = path.resolve(mediaRoot, relative);
  if (!filePath.startsWith(root)) throw new Error('Caminho de mídia inválido.');
  try {
    await fs.promises.unlink(filePath);
    return { removed: true, missing: false };
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false, missing: true };
    throw err;
  }
}

module.exports = {
  provider: 'local',
  mediaRoot,
  isLocal,
  garantirDiretorios,
  validarUpload,
  validarConteudoRecebido,
  multerStorage,
  uploadFile,
  uploadBuffer,
  deleteFile
};
