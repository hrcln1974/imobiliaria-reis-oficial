#!/usr/bin/env node
/**
 * Smoke test funcional da API (V6.3).
 *
 * Sobe o servidor em um banco SQLite temporário, cria um corretor de teste e
 * valida os fluxos críticos: login, proteção do painel, autorização das rotas,
 * validação de entrada, CSRF por origem, CRUD de imóvel, upload de foto
 * (MIME permitido e bloqueado), vídeo por URL e registro de lead.
 *
 * Uso: npm run test:smoke
 * Nenhum dado real do cliente é utilizado ou alterado (banco isolado em /tmp).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.SMOKE_PORT || 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'smoke.test@local.invalid';
const SENHA = 'SenhaSmokeTest12345';
const root = path.resolve(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabiano-smoke-'));

const env = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: 'test',
  JWT_SECRET: 'smoke-test-secret-nao-usar-em-producao',
  SQLITE_FILE: path.join(tmpDir, 'database.db'),
  DATABASE_URL: ''
};
delete env.DATABASE_URL;

let falhas = 0;
let total = 0;
function check(label, condicao, detalhe) {
  total++;
  if (!condicao) falhas++;
  console.log(`[${condicao ? '✓' : '✗'}] ${label}${condicao || detalhe === undefined ? '' : ` → ${detalhe}`}`);
}

let cookie = '';
async function api(method, url, { body, headers = {}, form, auth = false } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (form) init.body = form;
  if (auth && cookie) init.headers.Cookie = cookie;
  const res = await fetch(`${BASE}${url}`, init);
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

async function esperarServidor(proc) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/corretor`);
      if (res.ok) return true;
    } catch (_) {}
    if (proc.exitCode !== null) throw new Error('O servidor encerrou antes de responder.');
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Servidor não respondeu no tempo esperado.');
}

async function main() {
  const server = spawn(process.execPath, [path.join(root, 'server.js')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  server.stdout.on('data', d => logs.push(String(d)));
  server.stderr.on('data', d => logs.push(String(d)));

  try {
    await esperarServidor(server);

    // Corretor de teste
    const admin = spawn(process.execPath, [path.join(root, 'scripts', 'create-admin.js')], {
      env: { ...env, ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: SENHA, ADMIN_NAME: 'Corretor Smoke Test' },
      cwd: root,
      stdio: 'ignore'
    });
    await new Promise(resolve => admin.on('exit', resolve));

    const loginRuim = await api('POST', '/api/login', { body: { email: EMAIL, senha: 'senhaerrada' } });
    check('login com senha incorreta retorna 401', loginRuim.status === 401, loginRuim.status);

    const login = await api('POST', '/api/login', { body: { email: EMAIL, senha: SENHA } });
    check('login válido retorna 200', login.status === 200, login.status);
    const setCookie = login.headers.get('set-cookie') || '';
    check('sessão usa cookie HttpOnly', /HttpOnly/i.test(setCookie));
    check('token não é devolvido no corpo da resposta', !login.data || login.data.token === undefined);
    cookie = setCookie.split(';')[0];

    const painelSemAuth = await api('GET', '/dashboard.html');
    check('painel sem sessão redireciona', painelSemAuth.status === 302, painelSemAuth.status);
    const painelComAuth = await api('GET', '/dashboard.html', { auth: true });
    check('painel com sessão é servido', painelComAuth.status === 200, painelComAuth.status);

    check('GET /api/leads sem sessão retorna 401', (await api('GET', '/api/leads')).status === 401);
    check('GET /api/admin/imoveis sem sessão retorna 401', (await api('GET', '/api/admin/imoveis')).status === 401);

    const csrf = await api('POST', '/api/leads', { body: {}, headers: { Origin: 'https://origem-nao-autorizada.invalid' } });
    check('POST de origem externa é bloqueado (403)', csrf.status === 403, csrf.status);

    const invalido = await api('POST', '/api/imoveis', { auth: true, body: { titulo: 'x', preco: -1, tipo: 'inexistente', operacao: 'x' } });
    check('cadastro de imóvel inválido retorna 400', invalido.status === 400, JSON.stringify(invalido.data));

    const criado = await api('POST', '/api/imoveis', {
      auth: true,
      body: {
        titulo: 'Imóvel de teste automatizado',
        descricao: 'Registro criado apenas pelo smoke test.',
        preco: 250000, tipo: 'casa', operacao: 'venda',
        endereco: 'Rua de Teste', numero: '100', bairro: 'Centro', cidade: 'Rio de Janeiro',
        quartos: 2, banheiros: 1, area: 90, garagem: 1, destaque: 1
      }
    });
    check('cadastro de imóvel válido retorna id', criado.status === 200 && Number(criado.data?.id) > 0, JSON.stringify(criado.data));
    const imovelId = criado.data?.id;

    const lista = await api('GET', '/api/imoveis');
    check('listagem pública traz o imóvel ativo', Array.isArray(lista.data?.imoveis) && lista.data.imoveis.some(i => i.id === imovelId));

    const semAuthCriar = await api('POST', '/api/imoveis', { body: { titulo: 'sem auth', preco: 1, tipo: 'casa', operacao: 'venda', endereco: 'a', bairro: 'b', cidade: 'c' } });
    check('cadastro de imóvel sem sessão retorna 401', semAuthCriar.status === 401, semAuthCriar.status);

    // Upload de foto (JPEG mínimo válido) e formato bloqueado
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBIgACEQEDEQH/xABKAAEBAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AA//2Q==', 'base64');
    const formFoto = new FormData();
    formFoto.append('imagens', new Blob([jpeg], { type: 'image/jpeg' }), 'teste.jpg');
    const upFoto = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formFoto });
    check('upload de foto JPEG aceito', upFoto.status === 200, JSON.stringify(upFoto.data));

    const formRuim = new FormData();
    formRuim.append('imagens', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'malicioso.exe');
    const upRuim = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formRuim });
    check('upload de formato não permitido é recusado', upRuim.status === 400, upRuim.status);

    // V7.1 — extensão executável disfarçada de imagem (MIME válido, extensão perigosa).
    const formPhp = new FormData();
    formPhp.append('imagens', new Blob([Buffer.from('<?php echo 1; ?>')], { type: 'image/jpeg' }), 'shell.php');
    const upPhp = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formPhp });
    check('upload com extensão executável (.php) é recusado', upPhp.status === 400, upPhp.status);

    // V7.1.1 — conteúdo real do arquivo precisa corresponder ao MIME declarado.
    const formFake = new FormData();
    formFake.append('imagens', new Blob([Buffer.from('<?php echo 1; ?>')], { type: 'image/jpeg' }), 'fake.jpg');
    const upFake = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formFake });
    check('imagem com conteúdo falsificado (magic bytes) é recusada', upFake.status === 400, upFake.status);

    // V7.1.1 — arquivo vazio com MIME válido também é recusado.
    const formVazio = new FormData();
    formVazio.append('imagens', new Blob([Buffer.alloc(0)], { type: 'image/png' }), 'vazio.png');
    const upVazio = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formVazio });
    check('imagem vazia é recusada', upVazio.status === 400, upVazio.status);

    // V7.1 — path traversal no nome do arquivo é neutralizado.
    const formTrav = new FormData();
    formTrav.append('imagens', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), '../../../../etc/passwd.jpg');
    const upTrav = await api('POST', `/api/imoveis/${imovelId}/fotos`, { auth: true, form: formTrav });
    const caminhoTrav = String((upTrav.data?.imagens || [])[0] || '');
    check(
      'path traversal no nome do arquivo é neutralizado',
      upTrav.status === 200 && caminhoTrav.startsWith('/uploads/imagens/') && !caminhoTrav.includes('..'),
      caminhoTrav
    );

    const video = await api('POST', `/api/imoveis/${imovelId}/videos/url`, { auth: true, body: { url: 'https://www.youtube.com/watch?v=exemplo1234' } });
    check('vídeo por URL cadastrado', video.status === 200, JSON.stringify(video.data));
    const videoInvalido = await api('POST', `/api/imoveis/${imovelId}/videos/url`, { auth: true, body: { url: 'javascript:alert(1)' } });
    check('URL de vídeo inválida recusada', videoInvalido.status === 400, videoInvalido.status);

    const midias = await api('GET', `/api/imoveis/${imovelId}/midias`);
    check('mídias do imóvel listadas (foto + vídeo)', (midias.data?.midias || []).length >= 2, JSON.stringify(midias.data).slice(0, 120));

    const leadRuim = await api('POST', '/api/leads', { body: { nome: 'a', email: 'invalido', telefone: '1', mensagem: 'x' } });
    check('lead inválido recusado', leadRuim.status === 400, leadRuim.status);
    const lead = await api('POST', '/api/leads', {
      body: { nome: 'Lead de Teste', email: 'lead@local.invalid', telefone: '2199999999', mensagem: 'Mensagem de teste automatizado.', imovel_id: imovelId }
    });
    check('lead válido registrado', lead.status === 200, JSON.stringify(lead.data));
    const leads = await api('GET', '/api/leads', { auth: true });
    check('corretor lista leads', leads.status === 200 && (leads.data?.leads || []).length >= 1);

    const statusInvalido = await api('PUT', '/api/leads/1', { auth: true, body: { status: 'qualquer' } });
    check('status de lead inválido recusado', statusInvalido.status === 400, statusInvalido.status);

    const desativado = await api('PUT', `/api/imoveis/${imovelId}`, { auth: true, body: { ativo: 0 } });
    check('imóvel pode ser desativado', desativado.status === 200, JSON.stringify(desativado.data));
    const listaPos = await api('GET', '/api/imoveis');
    check('imóvel inativo sai da listagem pública', !(listaPos.data?.imoveis || []).some(i => i.id === imovelId));

    const headers = (await api('GET', '/')).headers;
    check('cabeçalho X-Content-Type-Options presente', headers.get('x-content-type-options') === 'nosniff');
    check('cabeçalho X-Frame-Options presente', Boolean(headers.get('x-frame-options')));
    check('X-Powered-By ausente', !headers.get('x-powered-by'));
    check('Content-Security-Policy presente', Boolean(headers.get('content-security-policy')));

    // V7.1 — health check da aplicação + banco, sem vazar segredos.
    const health = await api('GET', '/health');
    const healthTexto = JSON.stringify(health.data || {});
    check('health check /health responde ok', health.status === 200 && health.data?.ok === true, healthTexto);
    check('health check não expõe segredos', !/postgres:\/\/|JWT|senha|password/i.test(healthTexto), healthTexto);
  } catch (err) {
    falhas++;
    console.error('\nERRO no smoke test:', err.message);
    console.error(logs.join(''));
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${total - falhas}/${total} verificações aprovadas.`);
  if (falhas) {
    console.error('SMOKE TEST FALHOU.');
    process.exit(1);
  }
  console.log('SMOKE TEST OK.');
}

main();
