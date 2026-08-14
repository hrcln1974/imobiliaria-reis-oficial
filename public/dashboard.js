const API_BASE = '/api';
let usuario = null;
let imovelEditandoId = null;
let imoveisPainelCache = [];
let leadsPainelCache = [];
let imovelAtualGerenciandoImagens = null;
let mediaConfig = { armazenamentoMidia: 'local', uploadDiretoBlob: false, maxFotoMB: 5, maxVideoMB: 50 };

async function carregarConfiguracaoMidia() {
  try {
    const res = await fetch(`${API_BASE}/config`, { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) mediaConfig = { ...mediaConfig, ...(await res.json()) };
  } catch (e) {
    console.warn('Não foi possível obter a configuração de mídia; usando upload pelo servidor.', e);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#096;'); }
function moeda(v) { return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
function formatDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR'); }


async function uploadArquivoDiretoBlob(file, kind, onProgress) {
  const { upload } = await import('https://esm.sh/@vercel/blob@2.6.1/client');
  return upload(`imoveis/${imovelAtualGerenciandoImagens}/${kind}/${file.name}`, file, {
    access: 'public',
    handleUploadUrl: `${API_BASE}/blob/upload`,
    clientPayload: JSON.stringify({ kind, imovelId: imovelAtualGerenciandoImagens }),
    multipart: file.size > 4 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage || 0))
  });
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 || response.status === 403) {
    limparSessaoEIrParaLogin(response.status === 403 ? 'Acesso não autorizado.' : 'Sua sessão expirou. Faça login novamente.');
    throw new Error('UNAUTHORIZED');
  }
  return response;
}

function limparSessaoEIrParaLogin(mensagem) {
  if (mensagem) console.warn(mensagem);
  usuario = null;
  imoveisPainelCache = [];
  leadsPainelCache = [];
  window.location.href = '/?login=1';
}

async function validarSessaoInicial() {
  try {
    const res = await fetch(`${API_BASE}/auth/check`, { credentials:'same-origin', cache:'no-store' });
    if (!res.ok) return limparSessaoEIrParaLogin('Sessão inválida.');
    const data = await res.json();
    usuario = data.usuario || null;
    return true;
  } catch (err) {
    console.error(err);
    limparSessaoEIrParaLogin('Não foi possível validar a sessão.');
    return false;
  }
}

function atualizarData() {
  const el = document.getElementById('dataAtual');
  if (el) el.textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

function abrirSecao(secaoId, navElement) {
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
  const sec = document.getElementById(secaoId);
  if (!sec) return;
  sec.classList.add('active');
  const nav = navElement || document.querySelector(`.nav-item[onclick*="'${secaoId}'"]`);
  if (nav) nav.classList.add('active');
  if (secaoId === 'inicio') carregarDashboard();
  if (secaoId === 'imoveis') carregarImoveis();
  if (secaoId === 'leads') carregarLeads();
  if (secaoId === 'novo-imovel' && !imovelEditandoId) prepararNovoImovel();
}

async function carregarDashboard() {
  try {
    const [ri, rl] = await Promise.all([apiFetch(`${API_BASE}/imoveis`), apiFetch(`${API_BASE}/leads`) ]);
    const [di, dl] = await Promise.all([ri.json(), rl.json()]);
    const imoveis = di.imoveis || [];
    const leads = dl.leads || [];
    document.getElementById('totalImoveis').textContent = imoveis.length;
    document.getElementById('totalLeads').textContent = leads.length;
    document.getElementById('leadsNovos').textContent = leads.filter(l => l.status === 'novo').length;
    document.getElementById('tabelaUltimosImoveis').innerHTML = imoveis.slice(0,3).map(i => `<tr><td><strong>${escapeHtml(i.titulo)}</strong></td><td>${escapeHtml(i.tipo)}</td><td>${moeda(i.preco)}</td></tr>`).join('') || '<tr><td colspan="3" class="table-empty">Nenhum imóvel</td></tr>';
    document.getElementById('tabelaUltimosLeads').innerHTML = leads.slice(0,3).map(l => `<tr><td>${escapeHtml(l.nome)}</td><td>${escapeHtml(l.telefone)}</td><td><span class="badge badge-${escapeAttr(l.status)}">${escapeHtml(l.status)}</span></td></tr>`).join('') || '<tr><td colspan="3" class="table-empty">Nenhum lead</td></tr>';
  } catch (err) { if (err.message !== 'UNAUTHORIZED') console.error('Erro dashboard:', err); }
}

async function carregarImoveis() {
  try {
    const res = await apiFetch(`${API_BASE}/admin/imoveis`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao carregar imóveis');
    imoveisPainelCache = data.imoveis || [];
    const ativos = imoveisPainelCache.filter(i => Number(i.ativo) === 1).length;
    document.getElementById('badgeImoveis').textContent = ativos;
    document.getElementById('imoveisAtivos').textContent = ativos;
    document.getElementById('imoveisInativos').textContent = imoveisPainelCache.length - ativos;
    filtrarImoveisPainel();
  } catch (err) {
    if (err.message !== 'UNAUTHORIZED') {
      console.error(err);
      const tbody = document.querySelector('#tabelaImoveis');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Não foi possível carregar os imóveis.</td></tr>';
    }
  }
}

function filtrarImoveisPainel() {
  const busca = (document.getElementById('buscaImovelPainel')?.value || '').trim().toLowerCase();
  const status = document.getElementById('filtroImovelStatus')?.value || '';
  const lista = imoveisPainelCache.filter(i => {
    const texto = `${i.titulo||''} ${i.cidade||''} ${i.tipo||''} ${i.operacao||''}`.toLowerCase();
    return (!busca || texto.includes(busca)) && (!status || String(i.ativo) === status);
  });
  const tbody = document.querySelector('#tabelaImoveis');
  if (!tbody) return;
  tbody.innerHTML = lista.map(i => `
    <tr>
      <td><strong>${escapeHtml(i.titulo)}</strong></td><td>${escapeHtml(i.tipo)}</td><td>${moeda(i.preco)}</td><td>${escapeHtml(i.operacao)}</td><td>${escapeHtml(i.cidade)}</td>
      <td><span class="badge ${Number(i.ativo) ? 'badge-interessado' : 'badge-contato'}">${Number(i.ativo) ? 'Ativo' : 'Inativo'}</span></td>
      <td class="table-actions">
        <button class="btn btn-light btn-compact" onclick="editarImovel(${i.id})">✏️ Editar</button>
        <button class="btn btn-light btn-compact" onclick="abrirGerenciadorImagens(${i.id})">📷 Mídias</button>
        ${Number(i.ativo) ? '<button class="btn btn-danger btn-compact" onclick="deletarImovel('+i.id+')">Desativar</button>' : '<button class="btn btn-success btn-compact" onclick="reativarImovel('+i.id+')">Reativar</button><button class="btn btn-danger btn-compact" onclick="excluirImovelDefinitivo('+i.id+')">🗑️ Excluir definitivo</button>'}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="table-empty">Nenhum imóvel encontrado.</td></tr>';
}

function coletarDadosImovel() {
  return {
    titulo: document.getElementById('titulo').value.trim(), tipo: document.getElementById('tipo').value, operacao: document.getElementById('operacao').value,
    descricao: document.getElementById('descricao').value.trim(), preco: Number(document.getElementById('preco').value), endereco: document.getElementById('endereco').value.trim(),
    numero: document.getElementById('numero').value.trim(), bairro: document.getElementById('bairro').value.trim(), cidade: document.getElementById('cidade').value.trim(), cep: document.getElementById('cep').value.trim(),
    quartos: Number(document.getElementById('quartos').value) || 0, banheiros: Number(document.getElementById('banheiros').value) || 0, area: Number(document.getElementById('area').value) || 0,
    garagem: Number(document.getElementById('garagem').value) || 0, piscina: document.getElementById('piscina').checked ? 1 : 0, destaque: document.getElementById('destaque').checked ? 1 : 0
  };
}

function prepararNovoImovel() {
  imovelEditandoId = null;
  document.getElementById('formNovoImovel')?.reset();
  const fotos = document.getElementById('fotosImovel'); if (fotos) fotos.value = '';
  const preview = document.getElementById('previewFotos'); if (preview) preview.innerHTML = '';
  document.getElementById('tituloSecaoImovel').textContent = '➕ Cadastrar Novo Imóvel';
  document.getElementById('btnSalvarImovel').textContent = '✅ Cadastrar Imóvel';
  const editPhotos = document.getElementById('btnGerenciarFotosEdicao'); if (editPhotos) editPhotos.style.display = 'none';
}

function preencherFormularioImovel(i) {
  const map = {titulo:i.titulo||'',tipo:i.tipo||'',operacao:i.operacao||'',descricao:i.descricao||'',preco:i.preco??'',endereco:i.endereco||'',numero:i.numero||'',bairro:i.bairro||'',cidade:i.cidade||'',cep:i.cep||'',quartos:i.quartos??0,banheiros:i.banheiros??0,area:i.area??0,garagem:i.garagem??0};
  Object.entries(map).forEach(([id,value]) => { const el=document.getElementById(id); if(el) el.value=value; });
  document.getElementById('piscina').checked = Boolean(i.piscina);
  document.getElementById('destaque').checked = Boolean(i.destaque);
}

async function carregarPreviewExistentes(id) {
  const grid = document.getElementById('previewFotos'); if (!grid) return;
  try {
    const res = await apiFetch(`${API_BASE}/imoveis/${id}/imagens`); const data = await res.json();
    const imagens = data.imagens || [];
    grid.innerHTML = imagens.length ? imagens.map(img => `<div class="photo-preview existing"><img src="${escapeAttr(img.arquivo || img.url_externa)}" alt="Foto do imóvel"><span>${img.principal ? '⭐ Principal' : 'Foto'}</span></div>`).join('') : '<div class="photo-empty">Nenhuma foto cadastrada. Use “Gerenciar fotos”.</div>';
  } catch (e) { console.error(e); }
}

document.getElementById('formNovoImovel')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = document.getElementById('msgFormImovel'); const dados = coletarDadosImovel(); const editando = Boolean(imovelEditandoId);
  msg.className='form-message info'; msg.textContent=editando?'⏳ Salvando alterações...':'⏳ Cadastrando imóvel...';
  try {
    const res = await apiFetch(editando ? `${API_BASE}/imoveis/${imovelEditandoId}` : `${API_BASE}/imoveis`, { method:editando?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dados) });
    const result=await res.json(); if(!res.ok) throw new Error(result.erro || 'Erro ao salvar imóvel');
    const idImovel=editando?imovelEditandoId:result.id;
    const fotos=Array.from(document.getElementById('fotosImovel')?.files || []);

    if(fotos.length && idImovel){
      const useDirectBlob = Boolean(mediaConfig.uploadDiretoBlob);

      for(let i=0;i<fotos.length;i++){
        const f=fotos[i];
        msg.textContent=`⏳ Enviando foto ${i+1}/${fotos.length}...`;

        if(useDirectBlob){
          const blob=await uploadArquivoDiretoBlob(f,'imagens',p=>{
            msg.textContent=`⏳ Enviando foto ${i+1}/${fotos.length}: ${p}%`;
          });
          const ur=await apiFetch(`${API_BASE}/imoveis/${idImovel}/imagens/blob`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({arquivo:blob.url})
          });
          const ud=await ur.json();
          if(!ur.ok) throw new Error('Imóvel salvo, mas uma foto falhou: '+(ud.erro||'erro no registro'));
        }else{
          const fd=new FormData();
          fd.append('imagens',f);
          const ur=await apiFetch(`${API_BASE}/imoveis/${idImovel}/fotos`,{method:'POST',body:fd});
          const ud=await ur.json();
          if(!ur.ok) throw new Error('Imóvel salvo, mas uma foto falhou: '+(ud.erro||'erro no upload'));
        }
      }
    }
    msg.className='form-message success'; msg.textContent=editando?'✅ Imóvel atualizado com sucesso!':'✅ Imóvel cadastrado com sucesso!';
    const destino=imovelEditandoId; prepararNovoImovel();
    setTimeout(()=>{ abrirSecao('imoveis'); carregarImoveis(); if(destino) abrirGerenciadorImagens(destino); }, 500);
  } catch(err){ if(err.message!=='UNAUTHORIZED'){ console.error(err); msg.className='form-message error'; msg.textContent='❌ '+err.message; } }
});

document.getElementById('btnLimparImovel')?.addEventListener('click',(e)=>{ e.preventDefault(); prepararNovoImovel(); abrirSecao('novo-imovel'); window.scrollTo({top:0,behavior:'smooth'}); });
document.getElementById('btnGerenciarFotosEdicao')?.addEventListener('click',()=>{ if(imovelEditandoId) abrirGerenciadorImagens(imovelEditandoId); });

async function editarImovel(id){
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${id}`); const data=await res.json(); if(!res.ok||!data.imovel) throw new Error(data.erro||'Imóvel não encontrado');
    abrirSecao('novo-imovel');
    imovelEditandoId=id;
    preencherFormularioImovel(data.imovel);
    document.getElementById('tituloSecaoImovel').textContent='✏️ Editar Imóvel';
    document.getElementById('btnSalvarImovel').textContent='💾 Salvar Alterações';
    const b=document.getElementById('btnGerenciarFotosEdicao'); if(b) b.style.display='inline-flex';
    await carregarPreviewExistentes(id);
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){ if(err.message!=='UNAUTHORIZED') alert('Não foi possível carregar o imóvel para edição: '+err.message); }
}

async function deletarImovel(id){
  if(!confirm('Desativar este imóvel? Ele continuará salvo e poderá ser reativado.')) return;
  try{ const res=await apiFetch(`${API_BASE}/imoveis/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ativo:0})}); const d=await res.json(); if(!res.ok) throw new Error(d.erro||'Falha'); await carregarImoveis(); await carregarDashboard(); }catch(e){if(e.message!=='UNAUTHORIZED') alert(e.message);}
}
async function reativarImovel(id){
  try{ const res=await apiFetch(`${API_BASE}/imoveis/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ativo:1})}); const d=await res.json(); if(!res.ok) throw new Error(d.erro||'Falha'); await carregarImoveis(); await carregarDashboard(); }catch(e){if(e.message!=='UNAUTHORIZED') alert(e.message);}
}

async function excluirImovelDefinitivo(id){
  const imovel=imoveisPainelCache.find(i=>Number(i.id)===Number(id));
  const titulo=imovel?.titulo || `ID ${id}`;
  if(!confirm(`EXCLUSÃO DEFINITIVA\n\nImóvel: ${titulo}\n\nIsso removerá o imóvel e todas as fotos/vídeos associados. Esta ação não pode ser desfeita.\n\nDeseja continuar?`)) return;
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${id}/excluir-definitivo`,{method:'POST'});
    const d=await res.json();
    if(!res.ok) throw new Error(d.erro||'Falha ao excluir imóvel');
    alert('✅ '+(d.mensagem||'Imóvel excluído definitivamente.'));
    if(Number(imovelEditandoId)===Number(id)) prepararNovoImovel();
    await carregarImoveis();
    await carregarDashboard();
  }catch(e){ if(e.message!=='UNAUTHORIZED') alert('❌ '+e.message); }
}

// LEADS
async function carregarLeads(){
  try{ const res=await apiFetch(`${API_BASE}/leads`); const data=await res.json(); if(!res.ok) throw new Error(data.erro||'Falha'); leadsPainelCache=data.leads||[]; document.getElementById('badgeLeads').textContent=leadsPainelCache.filter(l=>l.status==='novo').length; renderLeadsPainel(); }
  catch(e){if(e.message!=='UNAUTHORIZED'){console.error(e);const tb=document.querySelector('#tabelaLeads');if(tb)tb.innerHTML='<tr><td colspan="6" class="table-empty">Não foi possível carregar os leads.</td></tr>';}}
}
function filtrarLeadsPainel(){renderLeadsPainel();}
function renderLeadsPainel(){
  const filtro=document.getElementById('filtroStatus')?.value||''; const busca=(document.getElementById('buscaLead')?.value||'').trim().toLowerCase();
  const leads=leadsPainelCache.filter(l=>{const texto=`${l.nome||''} ${l.email||''} ${l.telefone||''} ${l.mensagem||''}`.toLowerCase();return(!filtro||l.status===filtro)&&(!busca||texto.includes(busca));});
  document.getElementById('leadsVisiveis').textContent=leads.length; const tb=document.querySelector('#tabelaLeads'); if(!tb)return;
  tb.innerHTML=leads.map(l=>`<tr>
    <td><strong>${escapeHtml(l.nome)}</strong><div class="lead-meta">${escapeHtml(l.email)}</div>${l.mensagem?`<div class="lead-message">${escapeHtml(l.mensagem)}</div>`:''}</td>
    <td>${escapeHtml(l.telefone)}</td><td>${escapeHtml(l.tipo_interesse||'Geral')}${l.imovel_id?`<div class="lead-meta">Imóvel #${l.imovel_id}</div>`:''}</td>
    <td><select class="status-select" onchange="atualizarLeadStatus(${l.id},this.value)"><option value="novo" ${l.status==='novo'?'selected':''}>Novo</option><option value="contato" ${l.status==='contato'?'selected':''}>Em contato</option><option value="interessado" ${l.status==='interessado'?'selected':''}>Interessado</option><option value="convertido" ${l.status==='convertido'?'selected':''}>Convertido</option></select></td>
    <td>${formatDate(l.criado_em)}</td><td class="table-actions"><button class="btn btn-light btn-compact" onclick="abrirDetalheLead(${l.id})">👁️ Ver</button><button class="btn btn-whatsapp btn-compact" onclick="abrirWhatsAppLead('${escapeAttr(l.whatsapp||l.telefone)}','${escapeAttr(l.nome)}')">💬 WhatsApp</button><button class="btn btn-light btn-compact" onclick="enviarEmailLead('${escapeAttr(l.email)}','${escapeAttr(l.nome)}')">✉️ E-mail</button><button class="btn btn-danger btn-compact" onclick="excluirLead(${l.id})">🗑️</button></td>
  </tr>`).join('')||'<tr><td colspan="6" class="table-empty">Nenhum lead encontrado.</td></tr>';
}
function abrirWhatsAppLead(telefone,nome){const numero=String(telefone||'').replace(/\D/g,'');if(!numero)return alert('Este lead não possui telefone.');window.open(`https://wa.me/${numero}?text=${encodeURIComponent(`Olá ${nome||''}, aqui é Fabiano Reis. Recebi seu contato pelo site e gostaria de falar com você.`)}`,'_blank','noopener,noreferrer');}
function enviarEmailLead(email,nome){if(!email)return alert('Este lead não possui e-mail.');window.location.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Contato — Fabiano Reis Imóveis')}&body=${encodeURIComponent(`Olá ${nome||''},\n\nAqui é Fabiano Reis. Recebi seu contato pelo site.\n\nAtenciosamente,\nFabiano Reis`)}`;}
async function atualizarLeadStatus(id,status){try{const res=await apiFetch(`${API_BASE}/leads/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});const d=await res.json();if(!res.ok)throw new Error(d.erro||'Erro');const l=leadsPainelCache.find(x=>Number(x.id)===Number(id));if(l)l.status=status;document.getElementById('badgeLeads').textContent=leadsPainelCache.filter(x=>x.status==='novo').length;renderLeadsPainel();}catch(e){if(e.message!=='UNAUTHORIZED')alert(e.message);}}
async function excluirLead(id){if(!confirm('Excluir este lead definitivamente?'))return;try{const res=await apiFetch(`${API_BASE}/leads/${id}`,{method:'DELETE'});const d=await res.json();if(!res.ok)throw new Error(d.erro||'Erro');leadsPainelCache=leadsPainelCache.filter(l=>Number(l.id)!==Number(id));document.getElementById('badgeLeads').textContent=leadsPainelCache.filter(l=>l.status==='novo').length;renderLeadsPainel();}catch(e){if(e.message!=='UNAUTHORIZED')alert(e.message);}}
function abrirDetalheLead(id){const l=leadsPainelCache.find(x=>Number(x.id)===Number(id));if(!l)return;const modal=document.getElementById('modalLead');if(!modal)return;document.getElementById('detalheLead').innerHTML=`<div class="lead-detail-grid"><div><b>Nome</b><span>${escapeHtml(l.nome)}</span></div><div><b>E-mail</b><span>${escapeHtml(l.email)}</span></div><div><b>Telefone</b><span>${escapeHtml(l.telefone)}</span></div><div><b>WhatsApp</b><span>${escapeHtml(l.whatsapp||l.telefone)}</span></div><div><b>Interesse</b><span>${escapeHtml(l.tipo_interesse||'Geral')}</span></div><div><b>Imóvel</b><span>${l.imovel_id?'#'+escapeHtml(l.imovel_id):'Não informado'}</span></div></div><div class="lead-detail-message"><b>Mensagem</b><p>${escapeHtml(l.mensagem||'Sem mensagem.')}</p></div><div class="lead-detail-actions"><button class="btn btn-whatsapp" onclick="abrirWhatsAppLead('${escapeAttr(l.whatsapp||l.telefone)}','${escapeAttr(l.nome)}')">💬 WhatsApp</button><button class="btn btn-primary" onclick="enviarEmailLead('${escapeAttr(l.email)}','${escapeAttr(l.nome)}')">✉️ E-mail</button></div>`;modal.classList.add('active');}
function fecharModalLead(){document.getElementById('modalLead')?.classList.remove('active');}

// MÍDIAS (FOTOS + VÍDEOS)
function escapeJsAttr(value){ return String(value ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function videoPreviewHtml(media){
  const src = media.arquivo || media.url_externa || '';
  const safe = escapeAttr(src);
  if (!src) return '';
  const yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${escapeAttr(yt[1])}" title="Vídeo do imóvel" loading="lazy" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px;"></iframe>`;
  const vm = src.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `<iframe src="https://player.vimeo.com/video/${escapeAttr(vm[1])}" title="Vídeo do imóvel" loading="lazy" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px;"></iframe>`;
  return `<video controls preload="metadata" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#0f172a;"><source src="${safe}">Seu navegador não suporta vídeo.</video>`;
}

async function abrirGerenciadorImagens(id){
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${id}`);
    const d=await res.json();
    if(!res.ok)throw new Error(d.erro||'Erro');
    imovelAtualGerenciandoImagens=id;
    document.getElementById('infoImovelImagens').innerHTML=
      `<strong>${escapeHtml(d.imovel.titulo)}</strong><br>${escapeHtml(d.imovel.endereco)}, ${escapeHtml(d.imovel.cidade)}<br>
       <span class="media-help">Gerencie fotos e vídeos: adicionar, excluir e manter a apresentação do imóvel atualizada.</span>`;
    await Promise.all([carregarListaImagens(id), carregarListaVideos(id)]);
    document.getElementById('modalImagens').classList.add('active');
  }catch(e){if(e.message!=='UNAUTHORIZED')alert('Erro ao abrir gerenciador: '+e.message);}
}

function fecharModalImagens(){
  document.getElementById('modalImagens')?.classList.remove('active');
  ['fotosModal','videosModal'].forEach(id=>{const i=document.getElementById(id);if(i)i.value='';});
  ['urlNovaImagem','urlNovoVideo'].forEach(id=>{const i=document.getElementById(id);if(i)i.value='';});
  imovelAtualGerenciandoImagens=null;
}

async function carregarListaImagens(id){
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${id}/imagens`);
    const d=await res.json();
    const imagens=d.imagens||[];
    const c=document.getElementById('listaImagens');
    c.innerHTML=imagens.length?imagens.map(img=>
      `<div class="media-card ${img.principal?'is-main':''}">
        <img src="${escapeAttr(img.arquivo||img.url_externa)}" alt="Foto do imóvel" onerror="this.style.opacity=.3">
        <div class="media-card-actions">
          ${img.principal?'<span class="main-badge">⭐ Principal</span>':'<button class="btn btn-light btn-compact" onclick="definirImagemPrincipal('+id+','+img.id+')">⭐ Principal</button>'}
          <button class="btn btn-danger btn-compact" onclick="deletarImagem('+id+','+img.id+')">🗑️ Excluir</button>
        </div>
      </div>`).join(''):
      '<p style="grid-column:1/-1;text-align:center;color:#64748b;padding:25px;">Nenhuma foto cadastrada.</p>';
  }catch(e){console.error(e);}
}

async function carregarListaVideos(id){
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${id}/videos`);
    const d=await res.json();
    const videos=d.videos||[];
    const c=document.getElementById('listaVideos');
    if(!c)return;
    c.innerHTML=videos.length?videos.map(v=>
      `<div class="media-card video-media-card">
        ${videoPreviewHtml(v)}
        <div style="padding:10px 0 0;">
          <small style="display:block;color:#64748b;word-break:break-all;margin-bottom:8px;">${escapeHtml(v.url_externa||v.arquivo||'Vídeo')}</small>
          <button class="btn btn-danger btn-compact" onclick="deletarVideo(${id},${v.id})">🗑️ Excluir vídeo</button>
        </div>
      </div>`).join(''):
      '<p style="grid-column:1/-1;text-align:center;color:#64748b;padding:20px;">Nenhum vídeo cadastrado.</p>';
  }catch(e){console.error(e);}
}

async function enviarFotosModal() {
  const input = document.getElementById('fotosModal');
  const msg = document.getElementById('msgImagens');

  if (!input?.files?.length) {
    if (msg) {
      msg.className = 'form-message error';
      msg.textContent = '❌ Selecione pelo menos uma foto.';
    }
    return;
  }

  if (!imovelAtualGerenciandoImagens) {
    if (msg) {
      msg.className = 'form-message error';
      msg.textContent = '❌ Nenhum imóvel selecionado.';
    }
    return;
  }

  try {
    const files = Array.from(input.files);

    if (files.length > 12) {
      throw new Error('Você pode enviar no máximo 12 fotos por vez.');
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!file.type.startsWith('image/')) {
        throw new Error(
          `"${file.name}" não é uma imagem válida.`
        );
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error(
          `"${file.name}" ultrapassa o limite de 5 MB.`
        );
      }

      if (msg) {
        msg.className = 'form-message info';
        msg.textContent =
          `⏳ Enviando foto ${i + 1} de ${files.length}...`;
      }

      const formData = new FormData();
      formData.append('imagens', file);

      const res = await apiFetch(
        `${API_BASE}/imoveis/${imovelAtualGerenciandoImagens}/fotos`,
        {
          method: 'POST',
          body: formData
        }
      );

      let data = {};

      try {
        data = await res.json();
      } catch (_) {}

      if (!res.ok) {
        throw new Error(
          data.erro ||
          `Falha no upload da foto ${i + 1}.`
        );
      }
    }

    input.value = '';

    await carregarListaImagens(
      imovelAtualGerenciandoImagens
    );

    if (Number(imovelEditandoId) ===
        Number(imovelAtualGerenciandoImagens)) {
      await carregarPreviewExistentes(
        imovelAtualGerenciandoImagens
      );
    }

    if (msg) {
      msg.className = 'form-message success';
      msg.textContent =
        `✅ ${files.length} foto(s) enviada(s) com sucesso!`;
    }

  } catch (err) {
    console.error('[DASHBOARD] upload fotos:', err);

    if (err.message === 'UNAUTHORIZED') return;

    if (msg) {
      msg.className = 'form-message error';
      msg.textContent =
        '❌ ' + (err.message || 'Falha no upload.');
    }
  }
}

async function adicionarImagem(){
  const url=document.getElementById('urlNovaImagem').value.trim(),msg=document.getElementById('msgImagens');
  if(!url||!imovelAtualGerenciandoImagens){msg.className='form-message error';msg.textContent='❌ Informe uma URL e selecione um imóvel.';return;}
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${imovelAtualGerenciandoImagens}/imagens`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url_externa:url})});
    const d=await res.json();if(!res.ok)throw new Error(d.erro||'Falha');
    document.getElementById('urlNovaImagem').value='';await carregarListaImagens(imovelAtualGerenciandoImagens);
    msg.className='form-message success';msg.textContent='✅ Imagem adicionada!';
  }catch(e){if(e.message!=='UNAUTHORIZED'){msg.className='form-message error';msg.textContent='❌ '+e.message;}}
}

async function enviarVideosModal(){
  const input=document.getElementById('videosModal'),msg=document.getElementById('msgImagens');
  if(!input?.files?.length||!imovelAtualGerenciandoImagens){
    msg.className='form-message error';msg.textContent='❌ Selecione pelo menos um vídeo.';return;
  }
  try{
    const files=Array.from(input.files);
    msg.className='form-message info';msg.textContent=`⏳ Enviando ${files.length} vídeo(s)...`;
    try{
      for(let i=0;i<files.length;i++){
        const f=files[i];
        msg.textContent=`⏳ Enviando vídeo ${i+1}/${files.length}...`;
        const blob=await uploadArquivoDiretoBlob(f,'videos',p=>{msg.textContent=`⏳ Enviando vídeo ${i+1}/${files.length}: ${p}%`;});
        const reg=await apiFetch(`${API_BASE}/imoveis/${imovelAtualGerenciandoImagens}/videos/blob`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({arquivo:blob.url})});
        const rd=await reg.json();if(!reg.ok)throw new Error(rd.erro||'Falha ao registrar vídeo');
      }
    }catch(blobErr){
      if(location.hostname.includes('vercel.app')) throw blobErr;
      const fd=new FormData();files.forEach(f=>fd.append('videos',f));
      const res=await apiFetch(`${API_BASE}/imoveis/${imovelAtualGerenciandoImagens}/videos`,{method:'POST',body:fd});
      const d=await res.json();if(!res.ok)throw new Error(d.erro||'Falha no upload');
    }
    input.value='';await carregarListaVideos(imovelAtualGerenciandoImagens);
    msg.className='form-message success';msg.textContent='✅ Vídeos enviados com sucesso!';
  }catch(e){if(e.message!=='UNAUTHORIZED'){msg.className='form-message error';msg.textContent='❌ '+e.message;}}
}

async function adicionarVideoUrl(){
  const url=document.getElementById('urlNovoVideo').value.trim(),msg=document.getElementById('msgImagens');
  if(!url||!imovelAtualGerenciandoImagens){msg.className='form-message error';msg.textContent='❌ Informe a URL do vídeo e selecione um imóvel.';return;}
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${imovelAtualGerenciandoImagens}/videos/url`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})
    });
    const d=await res.json();if(!res.ok)throw new Error(d.erro||'Falha');
    document.getElementById('urlNovoVideo').value='';await carregarListaVideos(imovelAtualGerenciandoImagens);
    msg.className='form-message success';msg.textContent='✅ Vídeo adicionado por URL!';
  }catch(e){if(e.message!=='UNAUTHORIZED'){msg.className='form-message error';msg.textContent='❌ '+e.message;}}
}

async function definirImagemPrincipal(imovelId,imagemId){
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${imovelId}/imagens/${imagemId}/principal`,{method:'PUT'});
    const d=await res.json();if(!res.ok)throw new Error(d.erro||'Falha');
    await carregarListaImagens(imovelId);
    if(imovelEditandoId===imovelId)await carregarPreviewExistentes(imovelId);
  }catch(e){if(e.message!=='UNAUTHORIZED')alert(e.message);}
}

async function deletarImagem(imovelId, imagemId) {
  if (!imovelId || !imagemId) {
    alert('Dados da foto inválidos.');
    return;
  }

  const confirmar = confirm(
    'Excluir esta foto do imóvel?\n\n' +
    'A foto será removida definitivamente.'
  );

  if (!confirmar) return;

  const msg = document.getElementById('msgImagens');

  try {
    if (msg) {
      msg.className = 'form-message info';
      msg.textContent = '⏳ Excluindo foto...';
    }

    const res = await apiFetch(
      `${API_BASE}/imoveis/${imovelId}/imagens/${imagemId}/excluir`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    let data = {};

    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }

    if (!res.ok) {
      throw new Error(
        data.erro ||
        `Falha ao excluir foto (HTTP ${res.status})`
      );
    }

    // Atualiza imediatamente a lista
    await carregarListaImagens(imovelId);

    // Atualiza o preview do formulário de edição
    if (Number(imovelEditandoId) === Number(imovelId)) {
      await carregarPreviewExistentes(imovelId);
    }

    if (msg) {
      msg.className = 'form-message success';
      msg.textContent =
        '✅ ' +
        (data.mensagem || 'Foto excluída com sucesso.');
    }

  } catch (err) {
    console.error('[DASHBOARD] excluir imagem:', err);

    if (err.message === 'UNAUTHORIZED') return;

    if (msg) {
      msg.className = 'form-message error';
      msg.textContent =
        '❌ ' + (err.message || 'Erro ao excluir foto.');
    } else {
      alert(err.message || 'Erro ao excluir foto.');
    }
  }
}
async function deletarVideo(imovelId,videoId){
  if(!confirm('Excluir este vídeo do imóvel?'))return;
  try{
    const res=await apiFetch(`${API_BASE}/imoveis/${imovelId}/videos/${videoId}`,{method:'DELETE'});
    const d=await res.json();if(!res.ok)throw new Error(d.erro||'Falha');
    await carregarListaVideos(imovelId);
  }catch(e){if(e.message!=='UNAUTHORIZED')alert(e.message);}
}

async function logout(){try{await fetch(`${API_BASE}/logout`,{method:'POST',credentials:'same-origin'});}finally{window.location.href='/?login=1';}}

document.getElementById('modalImagens')?.addEventListener('click',e=>{if(e.target.id==='modalImagens')fecharModalImagens();});
document.getElementById('modalLead')?.addEventListener('click',e=>{if(e.target.id==='modalLead')fecharModalLead();});
document.getElementById('fotosImovel')?.addEventListener('change',function(){const grid=document.getElementById('previewFotos');if(!grid)return;Array.from(this.files||[]).forEach(file=>{if(!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=e=>{const item=document.createElement('div');item.className='photo-preview';item.innerHTML=`<img src="${e.target.result}" alt="Pré-visualização"><span>${escapeHtml(file.name)}</span>`;grid.appendChild(item);};reader.readAsDataURL(file);});});

document.addEventListener('DOMContentLoaded',async()=>{atualizarData();await carregarConfiguracaoMidia();const ok=await validarSessaoInicial();if(ok)carregarDashboard();});
