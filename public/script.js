// URLs da API
const API_BASE = '/api';
let usuarioTipo = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}


// ============= INICIALIZAR =============
document.addEventListener('DOMContentLoaded', () => {
  const ano = document.getElementById('ano-atual');
  if (ano) ano.textContent = String(new Date().getFullYear());
  carregarImoveis();
  configurarFormularios();
  verificarLogin();
  if (new URLSearchParams(window.location.search).get('login') === '1') {
    setTimeout(mostrarLogin, 100);
  }
});

// ============= FUNÇÕES DE AUTENTICAÇÃO =============
async function mostrarLogin() {
  // O botão "Acesso do Corretor" sempre exige nova autenticação.
  // Se já existir uma sessão, encerramos a sessão antes de mostrar o formulário.
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
  document.getElementById('loginModal').style.display = 'block';
  setTimeout(() => email?.focus(), 50);
}

function fecharLogin() {
  document.getElementById('loginModal').style.display = 'none';
}

async function verificarLogin() {
  // Não transforma o botão em acesso direto ao painel.
  // A navegação pública deve sempre abrir o formulário de login.
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
      document.getElementById('msgLogin').style.color = 'green';
      document.getElementById('msgLogin').textContent = '✅ Login realizado! Redirecionando...';
      
      setTimeout(() => {
        if (data.tipo === 'corretor') {
          window.location.href = 'dashboard.html';
        } else {
          window.location.reload();
        }
      }, 1500);
    } else {
      document.getElementById('msgLogin').style.color = 'red';
      document.getElementById('msgLogin').textContent = '❌ ' + data.erro;
    }
  } catch (err) {
    document.getElementById('msgLogin').style.color = 'red';
    document.getElementById('msgLogin').textContent = '❌ Erro ao conectar';
  }
});

// ============= CARREGAR IMÓVEIS =============
async function carregarImoveis() {
  try {
    const res = await fetch(`${API_BASE}/imoveis`);
    const data = await res.json();
    
    const container = document.getElementById('imoveis-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (data.imoveis && data.imoveis.length > 0) {
      for (const imovel of data.imoveis) {
        const card = await criarCartaoImovel(imovel);
        container.appendChild(card);
      }
    } else {
      container.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Nenhum imóvel encontrado</p>';
    }
  } catch (err) {
    console.error('Erro ao carregar imóveis:', err);
  }
}

async function criarCartaoImovel(imovel) {
  const card = document.createElement('div');
  card.className = 'imovel-card';

  const preco = Number(imovel.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const descricao = imovel.descricao ? imovel.descricao.substring(0, 100) + '...' : '';
  const midias = await carregarMidiasImovel(imovel.id);
  const imagens = midias.filter(m => m.tipo === 'imagem');
  const videos = midias.filter(m => m.tipo === 'video');
  const principal = imagens.find(i => Number(i.principal) === 1) || imagens[0];

  const midiasGaleria = [...midias].sort((a,b) => {
    if (Number(a.principal) !== Number(b.principal)) return Number(b.principal) - Number(a.principal);
    return Number(a.ordem || 0) - Number(b.ordem || 0);
  });
  const galeriaHTML = midiasGaleria.length > 0 ? `
    <div class="galeria-imagens">
      <div class="galeria-titulo">📷 Mídias (${imagens.length} foto${imagens.length===1?'':'s'}${videos.length ? ` + ${videos.length} vídeo${videos.length===1?'':'s'}` : ''})</div>
      <div class="imagens-grid">
        ${midiasGaleria.slice(0, 6).map(media => media.tipo === 'video' ? `
          <div class="imagem-thumb" onclick="abrirVideoModal('${escapeAttr(media.arquivo || media.url_externa)}', '${escapeAttr(imovel.titulo)}', '${escapeAttr(preco)}')" style="position:relative;cursor:pointer;">
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#111827;color:white;font-size:34px;">▶️</div>
            <div class="imagem-overlay">🎬 Ver vídeo</div>
          </div>
        ` : `
          <div class="imagem-thumb" onclick="abrirImagemModal('${escapeAttr(media.arquivo || media.url_externa)}', '${escapeAttr(imovel.titulo)}', '${escapeAttr(preco)}')">
            <img src="${escapeAttr(media.arquivo || media.url_externa)}" alt="Foto do imóvel" onerror="this.style.opacity=.25">
            <div class="imagem-overlay">🔍 Ver</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  card.innerHTML = `
    <div class="imovel-imagem">
      ${imovel.destaque ? '<div class="badge-destaque">⭐ Destaque</div>' : ''}
      <div class="badge-tipo">${escapeHtml(imovel.tipo)}</div>
      ${principal ? `<img src="${escapeAttr(principal.arquivo || principal.url_externa)}" alt="${escapeAttr(imovel.titulo)}" style="width:100%;height:100%;object-fit:cover;">` : '📸'}
    </div>
    <div class="imovel-info">
      <div class="imovel-titulo">${escapeHtml(imovel.titulo)}</div>
      <div class="imovel-endereco">📍 ${escapeHtml(imovel.bairro)}, ${escapeHtml(imovel.cidade)}</div>
      <div class="imovel-preco">${preco}</div>
      <div class="imovel-operacao">${escapeHtml(imovel.operacao)}</div>

      <div class="imovel-caracteristicas">
        ${imovel.quartos ? `<div class="imovel-caracteristica">🛏️ ${imovel.quartos}</div>` : ''}
        ${imovel.banheiros ? `<div class="imovel-caracteristica">🚿 ${imovel.banheiros}</div>` : ''}
        ${imovel.area ? `<div class="imovel-caracteristica">📐 ${imovel.area}m²</div>` : ''}
        ${imovel.garagem ? `<div class="imovel-caracteristica">🚗 ${imovel.garagem}</div>` : ''}
      </div>

      <div class="imovel-descricao">${escapeHtml(descricao)}</div>
      ${galeriaHTML}

      <div class="imovel-botoes">
        <button class="btn-info" onclick="abrirDetalhes(${Number(imovel.id)})">Ver Detalhes</button>
        <button class="btn-contatar" onclick="mostrarFormularioContato(${Number(imovel.id)}, '${escapeAttr(imovel.titulo)}')">Interessado</button>
      </div>
    </div>
  `;

  return card;
}

// ============= BUSCA E FILTROS =============
async function buscarImoveis() {
  const cidade = document.getElementById('searchCidade')?.value || '';
  const operacao = document.getElementById('searchOperacao')?.value || '';
  const tipo = document.getElementById('searchTipo')?.value || '';
  const precoMax = document.getElementById('precoMax')?.value || '';

  const params = new URLSearchParams();
  if (cidade) params.append('cidade', cidade);
  if (operacao) params.append('operacao', operacao);
  if (tipo) params.append('tipo', tipo);
  if (precoMax) params.append('preco_max', precoMax);

  try {
    const res = await fetch(`${API_BASE}/imoveis?${params}`);
    const data = await res.json();
    const container = document.getElementById('imoveis-container');
    if (!container) return;

    container.innerHTML = '';
    if (data.imoveis?.length) {
      for (const imovel of data.imoveis) {
        container.appendChild(await criarCartaoImovel(imovel));
      }
    } else {
      container.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:40px;">Nenhum imóvel encontrado com esses filtros</p>';
    }
  } catch (err) {
    console.error('Erro ao buscar:', err);
    const container = document.getElementById('imoveis-container');
    if (container) container.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:40px;">Não foi possível realizar a busca agora.</p>';
  }
}

// ============= DETALHES DO IMÓVEL =============
async function abrirDetalhes(id) {
  try {
    const res = await fetch(`${API_BASE}/imoveis/${id}`);
    const data = await res.json();
    if (!res.ok || !data.imovel) throw new Error(data.erro || 'Imóvel não encontrado');
    const imovel = data.imovel;
    const midias = imovel.midias || [];
    const imagens = midias.filter(m => m.tipo === 'imagem');
    const videos = midias.filter(m => m.tipo === 'video');
    const principal = imagens.find(m => Number(m.principal) === 1) || imagens[0];
    const preco = Number(imovel.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const midiasOrdenadas = [...midias].sort((a,b) => {
      if (Number(a.principal) !== Number(b.principal)) return Number(b.principal) - Number(a.principal);
      return Number(a.ordem || 0) - Number(b.ordem || 0) || Number(a.id || 0) - Number(b.id || 0);
    });
    const primeiraMidia = midiasOrdenadas[0];

    const galeria = midiasOrdenadas.length ? `
      <div class="detalhes-galeria-completa">
        <div class="detalhes-media-principal">
          ${primeiraMidia.tipo === 'video'
            ? videoEmbedHTML(primeiraMidia.arquivo || primeiraMidia.url_externa, imovel.titulo)
            : `<img src="${escapeAttr(primeiraMidia.arquivo || primeiraMidia.url_externa)}" alt="${escapeAttr(imovel.titulo)}">`}
        </div>
        <div class="detalhes-media-grade">
          ${midiasOrdenadas.slice(0, 8).map((media, index) => media.tipo === 'video' ? `
            <button type="button" class="detalhes-media-thumb video" onclick="abrirVideoModal('${escapeAttr(media.arquivo || media.url_externa)}','${escapeAttr(imovel.titulo)}','${escapeAttr(preco)}')" aria-label="Reproduzir vídeo ${index + 1}">
              <span class="media-play">▶</span>
              <span>🎬 Vídeo</span>
            </button>
          ` : `
            <button type="button" class="detalhes-media-thumb" onclick="abrirImagemModal('${escapeAttr(media.arquivo || media.url_externa)}','${escapeAttr(imovel.titulo)}','${escapeAttr(preco)}')" aria-label="Abrir foto ${index + 1}">
              <img src="${escapeAttr(media.arquivo || media.url_externa)}" alt="Foto do imóvel" loading="lazy">
            </button>
          `).join('')}
        </div>
        <div class="detalhes-media-contagem">📷 ${imagens.length} foto${imagens.length === 1 ? '' : 's'}${videos.length ? ` · 🎬 ${videos.length} vídeo${videos.length === 1 ? '' : 's'}` : ''}</div>
      </div>
    ` : '<div class="detalhes-galeria">📸 Galeria do Imóvel</div>';

    const detalhesHTML = `
      <section class="detalhes-section">
        <div class="container">
          <a href="#imoveis" class="btn-primary" style="display:inline-block;margin-bottom:20px;width:auto;padding:10px 30px;" onclick="location.reload();return false;">← Voltar</a>
          <div class="detalhes-container">
            <div class="detalhes-header">
              ${galeria}
              <div class="detalhes-dados">
                <h1>${escapeHtml(imovel.titulo)}</h1>
                <div class="imovel-operacao">${escapeHtml(imovel.operacao)}</div>
                <div class="detalhes-preco">${preco}</div>
                <div class="detalhes-caracteristicas">
                  ${imovel.quartos ? `<div class="detalhe-item"><strong>🛏️ Quartos</strong>${imovel.quartos}</div>` : ''}
                  ${imovel.banheiros ? `<div class="detalhe-item"><strong>🚿 Banheiros</strong>${imovel.banheiros}</div>` : ''}
                  ${imovel.area ? `<div class="detalhe-item"><strong>📐 Área</strong>${imovel.area}m²</div>` : ''}
                  ${imovel.garagem ? `<div class="detalhe-item"><strong>🚗 Garagem</strong>${imovel.garagem}</div>` : ''}
                </div>
                <div class="detalhe-item">
                  <strong>📍 Localização</strong>
                  ${escapeHtml(imovel.endereco)}${imovel.numero ? ', ' + escapeHtml(imovel.numero) : ''}<br>
                  ${escapeHtml(imovel.bairro)}, ${escapeHtml(imovel.cidade)}${imovel.cep ? ' - ' + escapeHtml(imovel.cep) : ''}
                </div>
                <button class="btn-contatar" onclick="mostrarFormularioContato(${Number(imovel.id)}, '${escapeAttr(imovel.titulo)}')" style="width:100%;margin-top:20px;">💬 Quero conhecer esse imóvel</button>
              </div>
            </div>

            <div style="background:white;padding:30px;border-radius:10px;margin-bottom:20px;">
              <h2>Descrição Completa</h2>
              <p style="line-height:1.8;color:#666;">${escapeHtml(imovel.descricao || 'Descrição não informada.')}</p>
            </div>


            <div style="background:white;padding:30px;border-radius:10px;">
              <h2>Entre em Contato com Fabiano</h2>
              <p>Quer saber mais sobre este imóvel? Fabiano Reis está pronto para atendê-lo!</p>
              <a href="https://wa.me/5521972664423?text=${encodeURIComponent('Tenho interesse no imóvel: ' + imovel.titulo)}" target="_blank" rel="noopener noreferrer" class="btn-primary">📱 Chamar no WhatsApp</a>
            </div>
          </div>
        </div>
      </section>
    `;

    const app = document.querySelector('main') || document.body;
    app.innerHTML = detalhesHTML;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('Erro ao carregar detalhes:', err);
    alert('Não foi possível carregar os detalhes deste imóvel.');
  }
}

// ============= FORMULÁRIO DE CONTATO =============
function mostrarFormularioContato(imovelId, imovelTitulo) {
  const nome = prompt('Qual é seu nome?');
  if (!nome) return;
  
  const email = prompt('Qual é seu email?');
  if (!email) return;
  
  const telefone = prompt('Qual é seu telefone?');
  if (!telefone) return;
  
  const whatsapp = prompt('WhatsApp (opcional):', telefone);
  
  const mensagem = prompt('Sua mensagem (opcional):', `Tenho interesse no imóvel: ${imovelTitulo}`);
  
  enviarLead(nome, email, telefone, whatsapp, mensagem, imovelId);
}

async function enviarLead(nome, email, telefone, whatsapp, mensagem, imovelId) {
  try {
    const res = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        email,
        telefone,
        whatsapp: whatsapp || telefone,
        mensagem: mensagem || `Interessado no imóvel`,
        imovel_id: imovelId,
        tipo_interesse: 'consulta'
      })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      alert('✅ Seu interesse foi registrado! Fabiano entrará em contato em breve.');
      
      // Abrir WhatsApp automaticamente
      const msg = `Olá! Meu nome é ${nome} e tenho interesse no imóvel. Poderia entrar em contato?`;
      window.open(`https://wa.me/5521972664423?text=${encodeURIComponent(msg)}`);
    } else {
      alert('❌ Erro ao registrar interesse: ' + data.erro);
    }
  } catch (err) {
    console.error('Erro ao enviar lead:', err);
    alert('❌ Erro ao registrar seu interesse');
  }
}

// ============= FORMULÁRIO DE CONTATO GERAL =============
function configurarFormularios() {
  const formContato = document.getElementById('formContato');
  if (!formContato) return;
  
  formContato.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const nome = document.getElementById('nomeLead').value;
    const email = document.getElementById('emailLead').value;
    const telefone = document.getElementById('telefoneLead').value;
    const whatsapp = document.getElementById('whatsappLead').value;
    const mensagem = document.getElementById('mensagemLead').value;
    
    try {
      const res = await fetch(`${API_BASE}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          telefone,
          whatsapp: whatsapp || telefone,
          mensagem,
          imovel_id: null,
          tipo_interesse: 'contato_geral'
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        const msgDiv = document.getElementById('msgContato');
        msgDiv.style.color = 'green';
        msgDiv.textContent = '✅ ' + data.mensagem;
        formContato.reset();
      } else {
        const msgDiv = document.getElementById('msgContato');
        msgDiv.style.color = 'red';
        msgDiv.textContent = '❌ Erro: ' + data.erro;
      }
    } catch (err) {
      const msgDiv = document.getElementById('msgContato');
      msgDiv.style.color = 'red';
      msgDiv.textContent = '❌ Erro ao enviar mensagem';
    }
  });
}

// ============= MODAIS DE MÍDIA =============
function videoEmbedHTML(src, titulo) {
  const safeSrc = String(src || '');
  const yt = safeSrc.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${escapeAttr(yt[1])}" title="${escapeAttr(titulo)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;"></iframe>`;
  const vm = safeSrc.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `<iframe src="https://player.vimeo.com/video/${escapeAttr(vm[1])}" title="${escapeAttr(titulo)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;"></iframe>`;
  return `<video controls autoplay playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:12px;background:#000;"><source src="${escapeAttr(safeSrc)}">Seu navegador não suporta vídeo.</video>`;
}

function abrirImagemModal(src, titulo, preco) {
  const modal = document.getElementById('imagemModal');
  const img = document.getElementById('imagemAmpliada');
  const info = document.getElementById('infoImagem');
  if (!modal || !img) return;
  img.src = src;
  info.innerHTML = `<strong>${escapeHtml(titulo)}</strong><br>${escapeHtml(preco)}`;
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
  info.innerHTML = `<strong>${escapeHtml(titulo)}</strong><br>${escapeHtml(preco)}`;
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
  }
});

document.getElementById('imagemModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'imagemModal') fecharImagemModal();
});
document.getElementById('videoModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') fecharVideoModal();
});

// ============= CARREGAR MÍDIAS DO IMÓVEL =============
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

// ============= FECHAR MODAL DE LOGIN =============
window.onclick = function(event) {
  const modal = document.getElementById('loginModal');
  if (event.target == modal) {
    modal.style.display = 'none';
  }
}
