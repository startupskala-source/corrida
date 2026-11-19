# Tela "Salvar corrida" + título/observação no resumo e no histórico.
p = 'js/history.js'
s = open(p, encoding='utf-8').read()

def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)

rep("let summaryMap = null;", "let summaryMap = null, saveMap = null;\nconst titleOf = r => r.title || runTitle(r.id);\nconst esc = t => String(t).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));")
rep('<div><div class="sum-title">${runTitle(run.id)}</div>', '<div><div class="sum-title">${esc(titleOf(run))}</div>')
rep('      <div id="sumMap" class="sum-map"></div>\n      <div class="grid">',
    '      <div id="sumMap" class="sum-map"></div>\n      ${run.note ? `<p class="sum-note">${esc(run.note)}</p>` : \'\'}\n      <div class="grid">')
rep('<div class="ri-head"><b>${runTitle(r.id)}</b>', '<div class="ri-head"><b>${esc(titleOf(r))}</b>')

s += r'''

// ---------- Salvar corrida (logo depois de encerrar) ----------
function openSave(run) {
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

  const close = () => { if (saveMap) { saveMap.remove(); saveMap = null; } v.classList.add('hidden'); };
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
'''
open(p, 'w', encoding='utf-8').write(s)
print('ok')
