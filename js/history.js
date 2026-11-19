'use strict';
// Resumo de uma corrida + lista do histórico. Usa fmtTime/fmtPace/fmtNum do tracker.js.
let summaryMap = null, saveMap = null;
const PENDING_KEY = 'passada_pendente';
const titleOf = r => r.title || runTitle(r.id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function runTitle(ts) {
  const h = new Date(ts).getHours();
  return h < 5 ? 'Corrida de madrugada' : h < 12 ? 'Corrida da manhã' : h < 18 ? 'Corrida da tarde' : 'Corrida da noite';
}
const avgPace = r => r.distance > 20 ? (r.elapsed / 1000) / (r.distance / 1000) : NaN;

// Gráfico de barras do pace por km (barra mais alta = km mais rápido)
function paceChart(splits) {
  if (splits.length < 2) return '';
  const paces = splits.map(s => s.ms / 1000);
  const min = Math.min(...paces), max = Math.max(...paces), range = Math.max(max - min, 10);
  const W = 100 / splits.length;
  const bars = paces.map((p, i) => {
    const h = 30 + 70 * (1 - (p - min) / range);
    const best = p === min;
    return `<div class="pc-bar${best ? ' best' : ''}" style="width:${W}%"><i style="height:${h}%"></i><b>${i + 1}</b></div>`;
  }).join('');
  return `<h2>Ritmo por km</h2><div class="pace-chart">${bars}</div>`;
}

function splitsTable(splits) {
  if (!splits.length) return '';
  const best = Math.min(...splits.map(s => s.ms));
  let total = 0;
  const rows = splits.map(s => {
    total += s.ms;
    return `<tr><td>${s.km}</td><td class="${s.ms === best && splits.length > 1 ? 'best' : ''}">${fmtPace(s.ms / 1000)}</td><td>${fmtTime(total)}</td></tr>`;
  }).join('');
  return `<h2>Quilômetros</h2><table><tr><th>Km</th><th>Ritmo</th><th>Tempo total</th></tr>${rows}</table>`;
}

function openSummary(run) {
  const v = document.getElementById('viewSummary');
  const best = run.splits.length ? fmtPace(Math.min(...run.splits.map(s => s.ms)) / 1000) : '--:--';
  v.innerHTML = `
    <div class="sum-top">
      <button class="icon-btn" id="sumClose" aria-label="Fechar">✕</button>
      <div><div class="sum-title">${esc(titleOf(run))}</div><div class="sum-date">${fmtDate(run.id)}</div></div>
    </div>
    <div class="sum-body">
      <div id="sumMap" class="sum-map"></div>
      ${run.note ? `<p class="sum-note">${esc(run.note)}</p>` : ''}
      <div class="grid">
        <div class="card"><div class="lbl">Distância</div><div class="val">${fmtNum(run.distance / 1000, 2)}<small>km</small></div></div>
        <div class="card"><div class="lbl">Tempo</div><div class="val">${fmtTime(run.elapsed)}</div></div>
        <div class="card hl"><div class="lbl">Ritmo médio</div><div class="val">${fmtPace(avgPace(run))}<small>/km</small></div></div>
        <div class="card"><div class="lbl">Melhor km</div><div class="val">${best}<small>/km</small></div></div>
      </div>
      ${paceChart(run.splits)}
      ${splitsTable(run.splits)}
      <button class="ghost-btn danger" id="sumDelete">Apagar corrida</button>
    </div>`;
  v.classList.remove('hidden');
  if (summaryMap) { summaryMap.remove(); summaryMap = null; }
  summaryMap = staticRouteMap(document.getElementById('sumMap'), run.points, run.splits);
  document.getElementById('sumClose').onclick = closeSummary;
  document.getElementById('sumDelete').onclick = async () => {
    if (!confirm('Apagar esta corrida? Ela sai do aparelho e não volta.')) return;
    await Store.deleteRun(run.id); closeSummary(); renderHistory();
  };
}
function closeSummary() {
  if (summaryMap) { summaryMap.remove(); summaryMap = null; }
  document.getElementById('viewSummary').classList.add('hidden');
}

async function renderHistory() {
  const wrap = document.getElementById('historyList');
  let runs = [];
  try { runs = await Store.listRuns(); } catch (_) {}
  const totKm = runs.reduce((a, r) => a + r.distance, 0) / 1000;
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const monthKm = runs.filter(r => r.id >= month.getTime()).reduce((a, r) => a + r.distance, 0) / 1000;
  document.getElementById('histTotals').innerHTML = `
    <div class="card"><div class="lbl">Este mês</div><div class="val">${fmtNum(monthKm, 1)}<small>km</small></div></div>
    <div class="card"><div class="lbl">Total</div><div class="val">${fmtNum(totKm, 1)}<small>km</small></div></div>
    <div class="card"><div class="lbl">Corridas</div><div class="val">${runs.length}</div></div>`;
  if (!runs.length) { wrap.innerHTML = '<div class="empty">Suas corridas ficam guardadas aqui.</div>'; return; }
  wrap.innerHTML = runs.map(r => `
    <button class="run-item" data-id="${r.id}">
      <div class="ri-head"><b>${esc(titleOf(r))}</b><span>${fmtDate(r.id)}</span></div>
      <div class="ri-stats">
        <div><small>Distância</small>${fmtNum(r.distance / 1000, 2)} km</div>
        <div><small>Ritmo</small>${fmtPace(avgPace(r))} /km</div>
        <div><small>Tempo</small>${fmtTime(r.elapsed)}</div>
      </div>
    </button>`).join('');
  wrap.querySelectorAll('.run-item').forEach(b => b.onclick = async () => {
    const run = await Store.getRun(Number(b.dataset.id)); if (run) openSummary(run);
  });
}


// ---------- Salvar corrida (logo depois de encerrar) ----------
function openSave(run) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(run)); } catch (_) {}
  const v = document.getElementById('viewSave');
  v.innerHTML = `
    <div class="sum-top">
      <div class="grow"><div class="sum-title">Salvar corrida</div><div class="sum-date">${fmtDate(run.id)}</div></div>
      <button class="go save-btn" id="saveOk">Salvar</button>
    </div>
    <div class="sum-body">
      <label class="field"><span>Título</span><input id="saveTitle" maxlength="80" value="${esc(runTitle(run.id))}"></label>
      <label class="field"><span>Como foi? (opcional)</span><textarea id="saveNote" maxlength="500" placeholder="Percurso, clima, como você se sentiu…"></textarea></label>
      <h2>Trajeto</h2>
      <div id="saveMap" class="sum-map"></div>
      <div class="grid">
        <div class="card"><div class="lbl">Distância</div><div class="val">${fmtNum(run.distance / 1000, 2)}<small>km</small></div></div>
        <div class="card"><div class="lbl">Tempo</div><div class="val">${fmtTime(run.elapsed)}</div></div>
        <div class="card hl"><div class="lbl">Ritmo médio</div><div class="val">${fmtPace(avgPace(run))}<small>/km</small></div></div>
        <div class="card"><div class="lbl">Quilômetros</div><div class="val">${run.splits.length}</div></div>
      </div>
      <button class="go wide" id="saveOk2">Salvar corrida</button>
      <button class="ghost-btn danger" id="saveDiscard">Descartar</button>
    </div>`;
  v.classList.remove('hidden');
  if (saveMap) { saveMap.remove(); saveMap = null; }
  saveMap = staticRouteMap(document.getElementById('saveMap'), run.points, run.splits);

  const close = () => { localStorage.removeItem(PENDING_KEY); if (saveMap) { saveMap.remove(); saveMap = null; } v.classList.add('hidden'); };
  const doSave = async () => {
    run.title = document.getElementById('saveTitle').value.trim() || runTitle(run.id);
    run.note = document.getElementById('saveNote').value.trim();
    try { await Store.saveRun(run); } catch (_) { alert('Não deu para guardar a corrida no aparelho.'); return; }
    close(); backToIdle(); renderHistory(); openSummary(run);
  };
  document.getElementById('saveOk').onclick = doSave;
  document.getElementById('saveOk2').onclick = doSave;
  document.getElementById('saveDiscard').onclick = () => {
    if (!confirm('Descartar esta corrida? Ela não fica guardada.')) return;
    close(); backToIdle();
  };
}

// Ao abrir o app: se ficou uma corrida encerrada e não salva, volta para a tela Salvar
function reopenPendingSave() {
  try {
    const run = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (run && run.points && run.distance >= 50) openSave(run);
    else localStorage.removeItem(PENDING_KEY);
  } catch (_) { localStorage.removeItem(PENDING_KEY); }
}
