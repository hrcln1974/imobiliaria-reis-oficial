// =====================================================================
// Fabiano Reis Imóveis — script público (V7)
// Evolução do arquivo original: mesmas funções globais, agora com
// filtros completos, cards profissionais, modal de interesse e menos
// requisições (a listagem já traz o resumo das mídias).
// =====================================================================

const API_BASE = '/api';
// V7.1 Premium: valor de fallback. A fonte de verdade é GET /api/corretor
// (configurável por WHATSAPP_NUMBER no ambiente); aplicarContatoGlobal()
// sincroniza todos os botões e links do site com esse número.
let WHATSAPP_CORRETOR = '5521991822134';
let usuarioTipo = null;
let ultimoFoco = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function rotuloOperacao(operacao) {
  return ({ venda: 'Venda', aluguel: 'Aluguel', 'venda-aluguel': 'Venda ou aluguel' })[String(operacao || '').toLowerCase()] || operacao || '';
}
function urlImovel(imovel) {
  if (imovel.url) return imovel.url;
  return `/imovel/${imovel.id}`;
}

// ============= INICIALIZAR =============
document.addEventListener('DOMContentLoaded', () => {
  const ano = document.getElementById('ano-atual');
  if (ano) ano.textContent = String(new Date().getFullYear());
  carregarImoveis();
  configurarFormularios();
  configurarFiltros();
  carregarDepoimentos();
  verificarLogin();
  if (new URLSearchParams(window.location.search).get('login') === '1') {
    setTimeout(mostrarLogin, 100);
  }
});

// ============= AUTENTICAÇÃO =============
async function mostrarLogin() {
  // O botão "Acesso do Corretor" sempre exige nova autenticação.
  try {
    await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  } catch (_) {}

  usuarioTipo = null;
  const email = document.getElementById('emailLogin');
  const senha = document.getElementById('senhaLogin');
  const msg = document.getElementById('msgLogin');
  if (email) email.value = '';
  if (senha) senha.value = '';
  if (msg) msg.textContent = '';
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'block';
  setTimeout(() => email?.focus(), 50);
}

function fecharLogin() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'none';
}

async function verificarLogin() {
  usuarioTipo = null;
  const nav = document.getElementById('nav-admin');
  if (nav) {
    nav.innerHTML = '<a href="#" onclick="mostrarLogin(); return false;" title="Acesso do Corretor">🔒 Acesso do Corretor</a>';
  }
}

document.getElementById('formLogin')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('emailLogin').value;
  const senha = document.getElementById('senhaLogin').value;
  const msg = document.getElementById('msgLogin');

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const data = await res.json();

    if (res.ok) {
      usuarioTipo = data.tipo;
      localStorage.removeItem('token');
      localStorage.removeItem('usuarioTipo');
      localStorage.removeItem('usuario');
      msg.style.color = 'green';
      msg.textContent = '✅ Login realizado! Redirecionando...';
      setTimeout(() => {
        if (data.tipo === 'corretor') window.location.href = 'dashboard.html';
        else window.location.reload();
      }, 1200);
    } else {
      msg.style.color = 'red';
      msg.textContent = '❌ ' + (data.erro || 'Não foi possível entrar.');
    }
  } catch (err) {
    msg.style.color = 'red';
    msg.textContent = '❌ Erro ao conectar';
  }
});

// ============= LISTAGEM DE IMÓVEIS =============
function esqueletos(qtd = 6) {
  return Array.from({ length: qtd }, () => '<div class="fr-skeleton" aria-hidden="true"></div>').join('');
}

async function carregarImoveis(params = null) {
  const container = document.getElementById('imoveis-container');
  if (!container) return;
  container.innerHTML = esqueletos();

  try {
    const query = params ? `?${params}` : '';
    const res = await fetch(`${API_BASE}/imoveis${query}`);
    const data = await res.json();
    renderizarImoveis(data.imoveis || []);
  } catch (err) {
    console.error('Erro ao carregar imóveis:', err);
    container.innerHTML = '<div class="fr-vazio"><strong>Não foi possível carregar os imóveis agora.</strong><p>Tente novamente em instantes ou fale pelo WhatsApp.</p></div>';
    atualizarContador(null);
  }
}

function renderizarImoveis(imoveis) {
  const container = document.getElementById('imoveis-container');
  if (!container) return;

  if (!imoveis.length) {
    container.innerHTML = `
      <div class="fr-vazio">
        <strong>Nenhum imóvel encontrado com esses filtros.</strong>
        <p style="margin:8px 0 16px;">Ajuste a busca ou fale com o corretor: ele pode ter opções ainda não publicadas.</p>
        <button type="button" class="fr-btn fr-btn-ghost" onclick="limparFiltros()">Limpar filtros</button>
      </div>`;
    atualizarContador(0);
    return;
  }

  container.innerHTML = imoveis.map(criarCartaoImovelHTML).join('');
  atualizarContador(imoveis.length);
}

function atualizarContador(total) {
  const el = document.getElementById('contadorResultados');
  if (!el) return;
  if (total === null) { el.textContent = ''; return; }
  el.textContent = total === 1 ? '1 imóvel encontrado' : `${total} imóveis encontrados`;
}

function criarCartaoImovelHTML(imovel) {
  const preco = moeda(imovel.preco);
  const link = urlImovel(imovel);
  const foto = imovel.foto_principal || '';
  const fotos = Number(imovel.total_fotos || 0);
  const videos = Number(imovel.total_videos || 0);
  const alt = `${imovel.titulo} — ${imovel.tipo} em ${imovel.bairro}, ${imovel.cidade}`;

  const specs = [
    imovel.quartos ? `<span>🛏 ${imovel.quartos} quarto${imovel.quartos > 1 ? 's' : ''}</span>` : '',
    imovel.banheiros ? `<span>🚿 ${imovel.banheiros} banheiro${imovel.banheiros > 1 ? 's' : ''}</span>` : '',
    imovel.garagem ? `<span>🚗 ${imovel.garagem} vaga${imovel.garagem > 1 ? 's' : ''}</span>` : '',
    imovel.area ? `<span>📐 ${imovel.area} m²</span>` : '',
    Number(imovel.piscina) ? '<span>🏊 Piscina</span>' : ''
  ].filter(Boolean).join('');

  return `
  <article class="fr-card">
    <a class="fr-card__media" href="${escapeAttr(link)}" aria-label="Ver detalhes de ${escapeAttr(imovel.titulo)}">
      <div class="fr-badges">
        ${Number(imovel.destaque) ? '<span class="fr-badge fr-badge--destaque">⭐ Destaque</span>' : ''}
        <span class="fr-badge fr-badge--operacao">${escapeHtml(rotuloOperacao(imovel.operacao))}</span>
        <span class="fr-badge">${escapeHtml(imovel.tipo)}</span>
      </div>
      ${foto
        ? `<img src="${escapeAttr(foto)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" width="600" height="450" onerror="this.onerror=null;this.src='/img/placeholder.svg';">`
        : '<div class="fr-card__sem-foto">📷 Fotos em breve</div>'}
      <div class="fr-card__midia-info">
        ${fotos ? `<span class="fr-chip-media">📷 ${fotos}</span>` : ''}
        ${videos ? `<span class="fr-chip-media">🎬 ${videos}</span>` : ''}
      </div>
    </a>
    <div class="fr-card__body">
      <h3 class="fr-card__titulo"><a href="${escapeAttr(link)}" style="color:inherit;text-decoration:none;">${escapeHtml(imovel.titulo)}</a></h3>
      <div class="fr-card__local">📍 ${escapeHtml(imovel.bairro)} — ${escapeHtml(imovel.cidade)}</div>
      <div class="fr-card__preco">${preco}${String(imovel.operacao).includes('aluguel') ? ' <small>/mês</small>' : ''}</div>
      ${specs ? `<div class="fr-specs">${specs}</div>` : ''}
      <div class="fr-card__acoes">
        <a class="fr-btn fr-btn-primary" href="${escapeAttr(link)}">Ver imóvel</a>
        <button type="button" class="fr-btn fr-btn-ghost" onclick="mostrarFormularioContato(${Number(imovel.id)}, '${escapeAttr(imovel.titulo)}')">Interesse</button>
      </div>
    </div>
  </article>`;
}

// ============= BUSCA E FILTROS =============
function coletarFiltros() {
  const params = new URLSearchParams();
  const add = (chave, valor) => {
    const v = String(valor ?? '').trim();
    if (v) params.append(chave, v);
  };
  add('operacao', document.getElementById('searchOperacao')?.value);
  add('tipo', document.getElementById('searchTipo')?.value);
  add('cidade', document.getElementById('searchCidade')?.value);
  add('preco_max', document.getElementById('precoMax')?.value);
  add('bairro', document.getElementById('filtroBairro')?.value);
  add('preco_min', document.getElementById('filtroPrecoMin')?.value);
  add('quartos', document.getElementById('filtroQuartos')?.value);
  add('banheiros', document.getElementById('filtroBanheiros')?.value);
  add('garagem', document.getElementById('filtroGaragem')?.value);
  add('area_min', document.getElementById('filtroAreaMin')?.value);
  add('destaque', document.getElementById('filtroDestaque')?.value);
  return params;
}

async function buscarImoveis() {
  await carregarImoveis(coletarFiltros().toString());
  document.getElementById('imoveis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function limparFiltros() {
  ['searchOperacao','searchTipo','searchCidade','precoMax','filtroBairro','filtroPrecoMin',
   'filtroQuartos','filtroBanheiros','filtroGaragem','filtroAreaMin','filtroDestaque']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  carregarImoveis();
}

function configurarFiltros() {
  document.getElementById('buscaRapida')?.addEventListener('submit', e => { e.preventDefault(); buscarImoveis(); });
  document.getElementById('formFiltros')?.addEventListener('submit', e => { e.preventDefault(); buscarImoveis(); });
}

// ============= DEPOIMENTOS (apenas reais) =============
async function carregarDepoimentos() {
  const secao = document.getElementById('depoimentos');
  const container = document.getElementById('depoimentos-container');
  if (!secao || !container) return;
  try {
    const res = await fetch(`${API_BASE}/depoimentos`);
    const data = await res.json();
    const lista = data.depoimentos || [];
    if (!lista.length) { secao.hidden = true; return; }
    container.innerHTML = lista.map(d => `
      <figure class="fr-card" style="padding:22px;">
        <blockquote style="margin:0;line-height:1.7;color:var(--fr-ink-2);">"${escapeHtml(d.texto)}"</blockquote>
        <figcaption style="margin-top:14px;font-weight:700;">${escapeHtml(d.nome)}${d.cidade ? ` <span style="font-weight:500;color:var(--fr-muted);">— ${escapeHtml(d.cidade)}</span>` : ''}</figcaption>
      </figure>`).join('');
    secao.hidden = false;
  } catch (_) {
    secao.hidden = true;
  }
}

// ============= DETALHES DO IMÓVEL =============
// A partir da V7 existe página própria com URL amigável e SEO.
function abrirDetalhes(id, slugUrl) {
  window.location.href = slugUrl || `/imovel/${Number(id)}`;
}

// ============= FORMULÁRIO DE INTERESSE (modal) =============
function abrirFormularioInteresse(imovelId = null, titulo = '') {
  const modal = document.getElementById('modalInteresse');
  if (!modal) return;
  ultimoFoco = document.activeElement;
  document.getElementById('interesseImovelId').value = imovelId ? String(imovelId) : '';
  const subtitulo = document.getElementById('subtituloInteresse');
  const mensagem = document.getElementById('interesseMensagem');
  if (titulo) {
    subtitulo.textContent = `Imóvel: ${titulo}`;
    if (mensagem && !mensagem.value) mensagem.value = `Olá, Fabiano! Tenho interesse no imóvel "${titulo}". Gostaria de receber mais informações.`;
  } else {
    subtitulo.textContent = 'Preencha os dados e Fabiano entra em contato.';
  }
  limparMensagem('msgInteresse');
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('interesseNome')?.focus(), 60);
}

// Mantido por compatibilidade com chamadas existentes nos cards.
function mostrarFormularioContato(imovelId, titulo) {
  abrirFormularioInteresse(imovelId, titulo);
}

function fecharFormularioInteresse() {
  const modal = document.getElementById('modalInteresse');
  if (!modal) return;
  modal.classList.remove('is-open');
  document.body.style.overflow = '';
  ultimoFoco?.focus?.();
}

document.getElementById('modalInteresse')?.addEventListener('click', e => {
  if (e.target.id === 'modalInteresse') fecharFormularioInteresse();
});

// ============= VALIDAÇÃO =============
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function definirErro(campoId, erroId, mensagem) {
  const campo = document.getElementById(campoId);
  const erro = document.getElementById(erroId);
  if (erro) erro.textContent = mensagem || '';
  if (campo) {
    if (mensagem) campo.setAttribute('aria-invalid', 'true');
    else campo.removeAttribute('aria-invalid');
  }
  return !mensagem;
}

function validarCampos(prefixo) {
  const v = id => String(document.getElementById(id)?.value || '').trim();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const idNome = prefixo === 'interesse' ? 'interesseNome' : 'nomeLead';
  const idEmail = prefixo === 'interesse' ? 'interesseEmail' : 'emailLead';
  const idTel = prefixo === 'interesse' ? 'interesseTelefone' : 'telefoneLead';
  const idMsg = prefixo === 'interesse' ? 'interesseMensagem' : 'mensagemLead';
  const erroId = campo => prefixo === 'interesse' ? `erro${cap(campo)}`.replace('erro', 'erroInteresse') : `erro${campo}`;

  const nomeOk = definirErro(idNome, prefixo === 'interesse' ? 'erroInteresseNome' : 'erroNomeLead',
    v(idNome).length < 2 ? 'Informe seu nome completo.' : '');
  const emailOk = definirErro(idEmail, prefixo === 'interesse' ? 'erroInteresseEmail' : 'erroEmailLead',
    EMAIL_RE.test(v(idEmail)) ? '' : 'Informe um e-mail válido.');
  const telOk = definirErro(idTel, prefixo === 'interesse' ? 'erroInteresseTelefone' : 'erroTelefoneLead',
    v(idTel).replace(/\D/g, '').length < 10 ? 'Informe o telefone com DDD.' : '');
  const msgOk = definirErro(idMsg, prefixo === 'interesse' ? 'erroInteresseMensagem' : 'erroMensagemLead',
    v(idMsg).length < 5 ? 'Escreva uma mensagem com pelo menos 5 caracteres.' : (v(idMsg).length > 2000 ? 'Mensagem muito longa.' : ''));

  void erroId;
  return nomeOk && emailOk && telOk && msgOk;
}

function limparMensagem(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; el.className = ''; }
}

function mostrarMensagem(id, texto, tipo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto;
  el.className = `fr-alerta ${tipo === 'ok' ? 'fr-alerta--ok' : 'fr-alerta--erro'}`;
}

async function enviarLeadPayload(payload) {
  const res = await fetch(`${API_BASE}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Falha no envio');
  return data;
}

// Compatibilidade com versões anteriores do site.
async function enviarLead(nome, email, telefone, whatsapp, mensagem, imovelId) {
  return enviarLeadPayload({
    nome, email, telefone,
    whatsapp: whatsapp || telefone,
    mensagem: mensagem || 'Interesse em imóvel',
    imovel_id: imovelId || null,
    tipo_interesse: 'consulta'
  });
}

// ============= FORMULÁRIOS =============
function configurarFormularios() {
  const formContato = document.getElementById('formContato');
  if (formContato) {
    formContato.addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = document.getElementById('btnEnviarContato');
      if (botao?.dataset.enviando === '1') return;
      if (!validarCampos('contato')) {
        mostrarMensagem('msgContato', 'Revise os campos destacados antes de enviar.', 'erro');
        return;
      }

      botao.dataset.enviando = '1';
      botao.setAttribute('aria-busy', 'true');
      botao.disabled = true;
      const textoOriginal = botao.textContent;
      botao.textContent = 'Enviando...';

      try {
        await enviarLeadPayload({
          nome: document.getElementById('nomeLead').value.trim(),
          email: document.getElementById('emailLead').value.trim(),
          telefone: document.getElementById('telefoneLead').value.trim(),
          whatsapp: document.getElementById('whatsappLead').value.trim() || document.getElementById('telefoneLead').value.trim(),
          mensagem: document.getElementById('mensagemLead').value.trim(),
          imovel_id: null,
          tipo_interesse: 'contato_geral',
          website: document.getElementById('websiteContato')?.value || ''
        });
        mostrarMensagem('msgContato', 'Mensagem enviada com sucesso. Entraremos em contato em breve.', 'ok');
        formContato.reset();
      } catch (err) {
        mostrarMensagem('msgContato', err.message || 'Não foi possível enviar sua mensagem. Tente novamente.', 'erro');
      } finally {
        botao.dataset.enviando = '0';
        botao.removeAttribute('aria-busy');
        botao.disabled = false;
        botao.textContent = textoOriginal;
      }
    });
  }

  const formInteresse = document.getElementById('formInteresse');
  if (formInteresse) {
    formInteresse.addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = document.getElementById('btnEnviarInteresse');
      if (botao?.dataset.enviando === '1') return;
      if (!validarCampos('interesse')) {
        mostrarMensagem('msgInteresse', 'Revise os campos destacados antes de enviar.', 'erro');
        return;
      }

      botao.dataset.enviando = '1';
      botao.setAttribute('aria-busy', 'true');
      botao.disabled = true;
      const textoOriginal = botao.textContent;
      botao.textContent = 'Enviando...';

      try {
        const imovelId = Number(document.getElementById('interesseImovelId').value) || null;
        await enviarLeadPayload({
          nome: document.getElementById('interesseNome').value.trim(),
          email: document.getElementById('interesseEmail').value.trim(),
          telefone: document.getElementById('interesseTelefone').value.trim(),
          whatsapp: document.getElementById('interesseWhatsapp').value.trim() || document.getElementById('interesseTelefone').value.trim(),
          mensagem: document.getElementById('interesseMensagem').value.trim(),
          imovel_id: imovelId,
          tipo_interesse: document.getElementById('interesseTipo').value,
          orcamento: document.getElementById('interesseOrcamento').value,
          website: document.getElementById('interesseWebsite')?.value || ''
        });
        mostrarMensagem('msgInteresse', 'Mensagem enviada com sucesso. Entraremos em contato em breve.', 'ok');
        formInteresse.reset();
      } catch (err) {
        mostrarMensagem('msgInteresse', err.message || 'Não foi possível enviar sua mensagem. Tente novamente.', 'erro');
      } finally {
        botao.dataset.enviando = '0';
        botao.removeAttribute('aria-busy');
        botao.disabled = false;
        botao.textContent = textoOriginal;
      }
    });
  }
}

// ============= MODAIS DE MÍDIA =============
function videoEmbedHTML(src, titulo) {
  const safeSrc = String(src || '');
  const yt = safeSrc.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${escapeAttr(yt[1])}" title="${escapeAttr(titulo)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;"></iframe>`;
  const vm = safeSrc.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `<iframe src="https://player.vimeo.com/video/${escapeAttr(vm[1])}" title="${escapeAttr(titulo)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;"></iframe>`;
  return `<video controls autoplay playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:12px;background:#000;"><source src="${escapeAttr(safeSrc)}">Seu navegador não suporta vídeo. <a href="${escapeAttr(safeSrc)}">Baixar vídeo</a>.</video>`;
}

function abrirImagemModal(src, titulo, preco) {
  const modal = document.getElementById('imagemModal');
  const img = document.getElementById('imagemAmpliada');
  const info = document.getElementById('infoImagem');
  if (!modal || !img) return;
  img.src = src;
  img.alt = `${titulo} — foto ampliada`;
  if (info) info.innerHTML = `<strong>${escapeHtml(titulo)}</strong><br>${escapeHtml(preco)}`;
  modal.classList.add('active');
}

function fecharImagemModal() {
  document.getElementById('imagemModal')?.classList.remove('active');
}

function abrirVideoModal(src, titulo, preco) {
  const modal = document.getElementById('videoModal');
  const player = document.getElementById('videoPlayerContainer');
  const info = document.getElementById('infoVideo');
  if (!modal || !player) return;
  player.innerHTML = videoEmbedHTML(src, titulo);
  if (info) info.innerHTML = `<strong>${escapeHtml(titulo)}</strong><br>${escapeHtml(preco)}`;
  modal.classList.add('active');
}

function fecharVideoModal() {
  const modal = document.getElementById('videoModal');
  const player = document.getElementById('videoPlayerContainer');
  if (player) player.innerHTML = '';
  modal?.classList.remove('active');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    fecharImagemModal();
    fecharVideoModal();
    fecharFormularioInteresse();
  }
});

document.getElementById('imagemModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'imagemModal') fecharImagemModal();
});
document.getElementById('videoModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') fecharVideoModal();
});

// ============= MÍDIAS (mantido para compatibilidade) =============
async function carregarMidiasImovel(imovelId) {
  try {
    const res = await fetch(`${API_BASE}/imoveis/${imovelId}/midias`);
    if (!res.ok) throw new Error('Falha ao buscar mídias');
    const data = await res.json();
    return data.midias || [];
  } catch (err) {
    console.error('Erro ao carregar mídias:', err);
    return [];
  }
}

async function carregarImagensImovel(imovelId) {
  const midias = await carregarMidiasImovel(imovelId);
  return midias.filter(m => m.tipo === 'imagem');
}

// Fecha o modal de login ao clicar fora.
window.addEventListener('click', (event) => {
  const modal = document.getElementById('loginModal');
  if (modal && event.target === modal) modal.style.display = 'none';
});

// =====================================================================
// V7.1 Premium — Contato centralizado
// O número do WhatsApp, telefone e e-mail vêm de /api/corretor (que lê as
// variáveis de ambiente). Aqui eles são aplicados em TODOS os links wa.me,
// tel: e mailto: da página, eliminando divergência entre arquivos.
// =====================================================================
async function aplicarContatoGlobal() {
  try {
    const res = await fetch(`${API_BASE}/corretor`);
    if (!res.ok) return;
    const contato = await res.json();
    const numero = String(contato.whatsapp_numero || '').replace(/\D/g, '');
    if (numero) {
      WHATSAPP_CORRETOR = numero;
      document.querySelectorAll('a[href*="wa.me/"]').forEach(link => {
        link.href = link.getAttribute('href').replace(/wa\.me\/\d+/, `wa.me/${numero}`);
      });
    }
    const youtubeLink = document.querySelector('[data-youtube-link]');
    if (youtubeLink) {
      const youtubeUrl = String(contato.youtube || '').trim();
      let validYoutubeUrl = false;
      try {
        const parsed = new URL(youtubeUrl);
        validYoutubeUrl = parsed.protocol === 'https:' && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(parsed.hostname);
      } catch (_) {}
      if (validYoutubeUrl) {
        youtubeLink.href = youtubeUrl;
        youtubeLink.target = '_blank';
        youtubeLink.rel = 'noopener noreferrer';
        youtubeLink.removeAttribute('aria-disabled');
        youtubeLink.setAttribute('aria-label', 'YouTube');
        youtubeLink.title = 'YouTube';
        youtubeLink.classList.remove('is-disabled');
      } else {
        youtubeLink.href = '#';
        youtubeLink.setAttribute('aria-disabled', 'true');
        youtubeLink.setAttribute('aria-label', 'YouTube — URL não configurada');
        youtubeLink.title = 'YouTube — URL não configurada';
        youtubeLink.classList.add('is-disabled');
      }
    }

    document.querySelectorAll('[data-contato]').forEach(el => {
      const campo = el.dataset.contato;
      const valor = contato[campo];
      if (!valor) return;
      if (el.tagName === 'A' && campo === 'email') el.href = `mailto:${valor}`;
      else if (el.tagName === 'A' && campo === 'telefone') el.href = `tel:+${String(valor).replace(/\D/g, '')}`;
      el.textContent = valor;
    });
  } catch (_) {
    /* mantém os valores padrão do HTML se a API não responder */
  }
}

document.addEventListener('DOMContentLoaded', aplicarContatoGlobal);

document.addEventListener('click', event => {
  const youtubeLink = event.target.closest?.('[data-youtube-link].is-disabled');
  if (youtubeLink) event.preventDefault();
});
