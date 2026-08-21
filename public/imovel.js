// =====================================================================
// Página individual do imóvel (V7)
// Usa as rotas já existentes: /api/imoveis/:id (imóvel + mídias).
// Depende de script.js (escapeHtml, moeda, modal de interesse, vídeo).
// =====================================================================

let galeriaMidias = [];
let galeriaIndice = 0;

document.addEventListener('DOMContentLoaded', () => {
  const ano = document.getElementById('ano-atual');
  if (ano) ano.textContent = String(new Date().getFullYear());
  carregarImovelPagina();
});

function idDoImovel() {
  const alvo = document.getElementById('conteudoImovel');
  const doAtributo = Number(alvo?.dataset.imovelId);
  if (Number.isFinite(doAtributo) && doAtributo > 0) return doAtributo;
  const match = window.location.pathname.match(/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

async function carregarImovelPagina() {
  const alvo = document.getElementById('conteudoImovel');
  const id = idDoImovel();
  if (!alvo || !id) return;

  try {
    const res = await fetch(`${API_BASE}/imoveis/${id}`);
    const data = await res.json();
    if (!res.ok || !data.imovel) throw new Error(data.erro || 'Imóvel não encontrado');
    renderizarImovel(data.imovel);
  } catch (err) {
    alvo.innerHTML = `
      <div class="fr-vazio">
        <strong>Imóvel não encontrado.</strong>
        <p style="margin:8px 0 16px;">Ele pode ter sido vendido, alugado ou removido do site.</p>
        <a class="fr-btn fr-btn-primary" href="/#imoveis">Ver imóveis disponíveis</a>
      </div>`;
  }
}

function renderizarImovel(imovel) {
  const midias = (imovel.midias || []).slice().sort((a, b) => {
    if (Number(a.principal) !== Number(b.principal)) return Number(b.principal) - Number(a.principal);
    return Number(a.ordem || 0) - Number(b.ordem || 0) || Number(a.id || 0) - Number(b.id || 0);
  });
  const fotos = midias.filter(m => m.tipo === 'imagem');
  const videos = midias.filter(m => m.tipo === 'video');
  galeriaMidias = fotos.map(f => f.arquivo || f.url_externa).filter(Boolean);
  galeriaIndice = 0;

  const preco = moeda(imovel.preco);
  const endereco = `${imovel.endereco}${imovel.numero ? ', ' + imovel.numero : ''} — ${imovel.bairro}, ${imovel.cidade}${imovel.cep ? ' (' + imovel.cep + ')' : ''}`;
  const mensagemWhats = `Olá, Fabiano! Tenho interesse no imóvel "${imovel.titulo}" (${preco}). Gostaria de receber mais informações.`;
  const linkWhats = `https://wa.me/${WHATSAPP_CORRETOR}?text=${encodeURIComponent(mensagemWhats)}`;

  const crumb = document.getElementById('crumbImovel');
  if (crumb) crumb.textContent = imovel.titulo;

  const caracteristicasBasicas = [
    Number(imovel.piscina) ? 'Piscina' : '',
    Number(imovel.garagem) ? `${imovel.garagem} vaga${imovel.garagem > 1 ? 's' : ''} de garagem` : '',
    imovel.area ? `${imovel.area} m² de área` : '',
    Number(imovel.destaque) ? 'Imóvel em destaque' : '',
    videos.length ? 'Vídeo disponível' : ''
  ].filter(Boolean);
  const selecionadas = new Set(Array.isArray(imovel.caracteristicas) ? imovel.caracteristicas : []);
  const gruposCaracteristicas = Object.entries(window.CARACTERISTICAS_IMOVEL || {}).map(([categoria,itens]) => {
    const ativos = itens.filter(([chave]) => selecionadas.has(chave));
    if (!ativos.length) return '';
    return `<section class="fr-carac-grupo"><h3>${escapeHtml(categoria)}</h3><div class="fr-carac-tags">${ativos.map(([,nome]) => `<span class="fr-carac-tag">✓ ${escapeHtml(nome)}</span>`).join('')}</div></section>`;
  }).filter(Boolean).join('');
  const caracteristicasHTML = (caracteristicasBasicas.length || gruposCaracteristicas) ? `
    <div class="fr-bloco">
      <h2 class="fr-h3" style="margin-bottom:12px;">Características e diferenciais</h2>
      ${caracteristicasBasicas.length ? `<div class="fr-tags" style="margin-bottom:16px;">${caracteristicasBasicas.map(c => `<span class="fr-tag">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
      ${gruposCaracteristicas ? `<div class="fr-caracteristicas-publicas">${gruposCaracteristicas}</div>` : ''}
    </div>` : '';

  const galeriaHTML = galeriaMidias.length ? `
    <div class="fr-galeria">
      <div class="fr-galeria__principal">
        <img id="fotoPrincipal" src="${escapeAttr(galeriaMidias[0])}" alt="${escapeAttr(imovel.titulo)} — foto principal"
             width="1200" height="750" fetchpriority="high" decoding="async"
             onclick="abrirLightbox(galeriaIndice)" style="cursor:zoom-in;"
             onerror="this.onerror=null;this.src='/img/placeholder.svg';">
        ${galeriaMidias.length > 1 ? `
          <button type="button" class="fr-galeria__nav fr-galeria__nav--prev" onclick="mudarFoto(-1)" aria-label="Foto anterior">‹</button>
          <button type="button" class="fr-galeria__nav fr-galeria__nav--next" onclick="mudarFoto(1)" aria-label="Próxima foto">›</button>` : ''}
        <span class="fr-galeria__contador" id="contadorFoto">1 / ${galeriaMidias.length}</span>
      </div>
      ${galeriaMidias.length > 1 ? `
      <div class="fr-thumbs" role="list">
        ${galeriaMidias.map((src, i) => `
          <button type="button" class="fr-thumb" role="listitem" aria-current="${i === 0}" onclick="selecionarFoto(${i})" aria-label="Ver foto ${i + 1}">
            <img src="${escapeAttr(src)}" alt="Foto ${i + 1} do imóvel ${escapeAttr(imovel.titulo)}" loading="lazy" decoding="async" width="200" height="200"
                 onerror="this.onerror=null;this.src='/img/placeholder.svg';">
          </button>`).join('')}
      </div>` : ''}
    </div>
  ` : `<div class="fr-vazio" style="min-height:220px;">📷 Este imóvel ainda não possui fotos publicadas. Fale com o corretor para receber o material.</div>`;

  const videosHTML = videos.length ? `
    <div class="fr-bloco">
      <h2 class="fr-h3" style="margin-bottom:14px;">🎬 Vídeo${videos.length > 1 ? 's' : ''} do imóvel</h2>
      ${videos.map(v => `<div class="fr-video" style="margin-bottom:14px;">${videoEmbedHTML(v.arquivo || v.url_externa, imovel.titulo)}</div>`).join('')}
    </div>` : '';

  document.getElementById('conteudoImovel').innerHTML = `
    <div class="fr-imovel">
      <div>
        ${galeriaHTML}
        <p style="color:var(--fr-muted);margin:10px 0 26px;">📷 ${fotos.length} foto${fotos.length === 1 ? '' : 's'}${videos.length ? ` · 🎬 ${videos.length} vídeo${videos.length === 1 ? '' : 's'}` : ''}</p>

        <div class="fr-bloco">
          <h1 class="fr-h1" style="font-size:clamp(1.6rem,3vw,2.3rem);">${escapeHtml(imovel.titulo)}</h1>
          <p class="fr-lead" style="margin-top:8px;">📍 ${escapeHtml(endereco)}</p>
          <div class="fr-datalist" style="margin-top:18px;">
            <div class="fr-dado"><strong>Operação</strong>${escapeHtml(rotuloOperacao(imovel.operacao))}</div>
            <div class="fr-dado"><strong>Tipo</strong>${escapeHtml(imovel.tipo)}</div>
            ${imovel.quartos ? `<div class="fr-dado"><strong>Quartos</strong>${imovel.quartos}</div>` : ''}
            ${imovel.banheiros ? `<div class="fr-dado"><strong>Banheiros</strong>${imovel.banheiros}</div>` : ''}
            ${imovel.area ? `<div class="fr-dado"><strong>Área</strong>${imovel.area} m²</div>` : ''}
            ${imovel.garagem ? `<div class="fr-dado"><strong>Garagem</strong>${imovel.garagem} vaga${imovel.garagem > 1 ? 's' : ''}</div>` : ''}
            <div class="fr-dado"><strong>Piscina</strong>${Number(imovel.piscina) ? 'Sim' : 'Não'}</div>
          </div>
        </div>

        <div class="fr-bloco">
          <h2 class="fr-h3">Descrição</h2>
          <p>${escapeHtml(imovel.descricao || 'Descrição não informada. Fale com o corretor para receber os detalhes completos.')}</p>
        </div>

        ${caracteristicasHTML}

        ${videosHTML}
      </div>

      <aside class="fr-painel" aria-label="Contato sobre este imóvel">
        <div class="fr-painel__preco">${preco}${String(imovel.operacao).includes('aluguel') ? ' <small style="font-size:.9rem;color:var(--fr-muted);">/mês</small>' : ''}</div>
        <p style="color:var(--fr-muted);margin:0;">Atendimento direto com Fabiano Reis — CRECI-RJ 93.426.</p>
        <a class="fr-btn fr-btn-whats fr-btn-block" href="${escapeAttr(linkWhats)}" target="_blank" rel="noopener noreferrer" onclick="registrarConversao(${Number(imovel.id)}, 'interesse')">💬 Falar no WhatsApp</a>
        <div class="fr-conversao" aria-label="Ações de atendimento">
          <button type="button" class="fr-btn fr-btn-primary fr-btn-block" onclick="acaoConversaoWhatsApp(${Number(imovel.id)}, 'interesse', '${escapeAttr(imovel.titulo)}', '${escapeAttr(imovel.cidade || '')}', '${escapeAttr(imovel.preco || '')}')">Tenho interesse</button>
          <button type="button" class="fr-btn fr-btn-ghost fr-btn-block" onclick="acaoConversaoWhatsApp(${Number(imovel.id)}, 'visita', '${escapeAttr(imovel.titulo)}', '${escapeAttr(imovel.cidade || '')}', '${escapeAttr(imovel.preco || '')}')">Agendar visita</button>
          <button type="button" class="fr-btn fr-btn-ghost fr-btn-block" onclick="acaoConversaoWhatsApp(${Number(imovel.id)}, 'proposta', '${escapeAttr(imovel.titulo)}', '${escapeAttr(imovel.cidade || '')}', '${escapeAttr(imovel.preco || '')}')">Fazer proposta</button>
          <button type="button" class="fr-btn fr-btn-ghost fr-btn-block" onclick="abrirFormularioInteresse(${Number(imovel.id)}, '${escapeAttr(imovel.titulo)}')">Enviar meus dados</button>
        </div>
        <div>
          <p style="font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--fr-muted);font-weight:700;margin:6px 0 8px;">Compartilhar</p>
          <div class="fr-share">
            <button type="button" class="fr-btn fr-btn-ghost" onclick="compartilharImovel('${escapeAttr(imovel.titulo)}')">Compartilhar</button>
            <a class="fr-btn fr-btn-ghost" target="_blank" rel="noopener noreferrer" href="https://api.whatsapp.com/send?text=${encodeURIComponent(imovel.titulo + ' — ' + window.location.href)}">WhatsApp</a>
            <a class="fr-btn fr-btn-ghost" target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}">Facebook</a>
            <a class="fr-btn fr-btn-ghost" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(imovel.titulo)}&url=${encodeURIComponent(window.location.href)}">X</a>
            <button type="button" class="fr-btn fr-btn-ghost" onclick="copiarLink(this)">Copiar link</button>
          </div>
          <p id="msgCompartilhar" role="status" aria-live="polite" style="font-size:.85rem;color:var(--fr-muted);"></p>
        </div>
      </aside>
    </div>`;
}

// ============= GALERIA =============
function selecionarFoto(indice) {
  if (!galeriaMidias.length) return;
  galeriaIndice = (indice + galeriaMidias.length) % galeriaMidias.length;
  const img = document.getElementById('fotoPrincipal');
  if (img) img.src = galeriaMidias[galeriaIndice];
  const contador = document.getElementById('contadorFoto');
  if (contador) contador.textContent = `${galeriaIndice + 1} / ${galeriaMidias.length}`;
  document.querySelectorAll('.fr-thumb').forEach((el, i) => el.setAttribute('aria-current', String(i === galeriaIndice)));
}

function mudarFoto(passo) {
  selecionarFoto(galeriaIndice + passo);
}

function abrirLightbox(indice) {
  if (!galeriaMidias.length) return;
  galeriaIndice = (indice + galeriaMidias.length) % galeriaMidias.length;
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = galeriaMidias[galeriaIndice];
  img.alt = `Foto ${galeriaIndice + 1} do imóvel`;
  document.getElementById('lightboxLegenda').textContent = `${galeriaIndice + 1} de ${galeriaMidias.length}`;
  box.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function navegarLightbox(passo) {
  abrirLightbox(galeriaIndice + passo);
  selecionarFoto(galeriaIndice);
}

function fecharLightbox() {
  document.getElementById('lightbox')?.classList.remove('is-open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  const aberto = document.getElementById('lightbox')?.classList.contains('is-open');
  if (!aberto) return;
  if (e.key === 'Escape') fecharLightbox();
  if (e.key === 'ArrowLeft') navegarLightbox(-1);
  if (e.key === 'ArrowRight') navegarLightbox(1);
});

document.getElementById('lightbox')?.addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') fecharLightbox();
});

// ============= MOTOR DE CONVERSÃO =============
function codigoImovel(imovelId) { return `FR-${String(Number(imovelId) || 0).padStart(4, '0')}`; }
function registrarConversao(imovelId, tipo) {
  if (!['interesse','visita','proposta'].includes(tipo)) return;
  fetch(`${API_BASE}/conversoes`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({imovel_id:Number(imovelId),tipo}), keepalive:true }).catch(()=>{});
}
function acaoConversaoWhatsApp(imovelId, tipo, titulo, cidade, preco) {
  const id=Number(imovelId); if(!id) return; registrarConversao(id,tipo); const codigo=codigoImovel(id); const local=cidade?`Localização: ${cidade}`:''; const precoTexto=Number(preco)>0?`Preço: ${moeda(preco)}`:''; const url=window.location.href;
  const mensagens={
    interesse:`Olá, Fabiano!\n\nTenho interesse neste imóvel:\n\n${titulo}\nCódigo: ${codigo}\n${local}${precoTexto?`\n${precoTexto}`:''}\n\nGostaria de receber mais informações.\n\n${url}`,
    visita:`Olá, Fabiano!\n\nGostaria de agendar uma visita ao imóvel ${codigo}.\n\n${titulo}\n${local}\n${url}`,
    proposta:`Olá, Fabiano!\n\nGostaria de conversar sobre uma proposta para o imóvel ${codigo}.\n\n${titulo}\n${local}\n${url}`
  };
  window.open(`https://wa.me/${WHATSAPP_CORRETOR}?text=${encodeURIComponent(mensagens[tipo]||mensagens.interesse)}`,'_blank','noopener,noreferrer');
}

// ============= COMPARTILHAMENTO =============
async function compartilharImovel(titulo) {
  const dados = { title: titulo, text: `${titulo} — Fabiano Reis Imóveis`, url: window.location.href };
  if (navigator.share) {
    try { await navigator.share(dados); return; } catch (_) { /* usuário cancelou */ }
  }
  copiarLink();
}

async function copiarLink(botao) {
  const msg = document.getElementById('msgCompartilhar');
  try {
    await navigator.clipboard.writeText(window.location.href);
    if (msg) msg.textContent = 'Link copiado para a área de transferência.';
    if (botao) { const t = botao.textContent; botao.textContent = 'Link copiado!'; setTimeout(() => { botao.textContent = t; }, 2000); }
  } catch (_) {
    if (msg) msg.textContent = window.location.href;
  }
}
