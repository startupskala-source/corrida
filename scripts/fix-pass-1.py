# Correções: toque duplo em Começar, corrida perdida na tela Salvar, recuperação sem confirm().
def edit(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8').write(s)

edit('js/tracker.js', [
    # recuperação: sem pergunta; volta pausada (Continuar / Encerrar decidem)
    ("""    if (!s || Date.now() - s.savedAt > 6 * 3600 * 1000) return;
    if (!confirm(`Ficou uma corrida aberta (${fmtNum(s.distance / 1000, 2)} km). Quer continuar de onde parou?`)) {
      localStorage.removeItem(SAVE_KEY); return;
    }
    ({ points, distance, elapsedMs, splits, lastSplitMs, lastSplitDist } = s);
    lastFix = points[points.length - 1] || null; segBreak = true;
    state = 'paused'; setUiState('paused'); render(); renderSplits(); draw(); startGps();""",
     """    if (!s || Date.now() - s.savedAt > 24 * 3600 * 1000) return;
    ({ points, distance, elapsedMs, splits, lastSplitMs, lastSplitDist } = s);
    lastFix = points[points.length - 1] || null; segBreak = true;
    state = 'paused'; setUiState('paused'); render(); renderSplits(); draw(); startGps();
    MapView.fit(points);
    showNotice('Sua corrida estava aberta. Continue ou encerre quando quiser.');"""),
    # toque duplo
    ("""$('btnStart').onclick = async () => {
  if (state !== 'idle') return;
  resetRun(); enableMotion(); startGps();
  await runCountdown();""",
     """let starting = false;                               // evita duas contagens com toque duplo
$('btnStart').onclick = async () => {
  if (state !== 'idle' || starting) return;
  starting = true;
  resetRun(); enableMotion(); startGps();
  try { await runCountdown(); } finally { starting = false; }"""),
    ("// Aviso que desce do topo a cada km",
     """// Aviso neutro no topo (mesmo estilo do aviso de km)
function showNotice(text, ms = 5000) {
  const t = $('kmToast');
  t.textContent = text; t.classList.add('show', 'notice');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show', 'notice'), ms);
}

// Aviso que desce do topo a cada km"""),
    ("let toastTimer = null;\nfunction showKmToast(km, ms) {\n  const t = $('kmToast');",
     "function showKmToast(km, ms) {\n  const t = $('kmToast'); t.classList.remove('notice');"),
    ("// ---------- Render ----------", "let toastTimer = null;\n// ---------- Render ----------"),
])

edit('js/native.js', [
    ("""        if (confirm(`Ficou uma corrida aberta (${fmtNum(snap.distance / 1000, 2)} km). Quer continuar de onde parou?`)) {
          await T.restoreSnapshot(); startPoll(); return;
        }
        await T.discardSnapshot();""",
     """        await T.restoreSnapshot(); startPoll();
        showNotice('Sua corrida estava aberta. Continue ou encerre quando quiser.');
        setTimeout(() => MapView.fit(points), 1500);
        return;"""),
    ("""  $('btnStart').onclick = async () => {
    if (state !== 'idle') return;
    if (!(await ready())) return;""",
     """  let starting = false;
  $('btnStart').onclick = async () => {
    if (state !== 'idle' || starting) return;
    starting = true;
    try { await startRun(); } finally { starting = false; }
  };
  async function startRun() {
    if (!(await ready())) return;"""),
    ("""    setUiState('running'); startPoll();
  };

  $('btnResume').onclick""",
     """    setUiState('running'); startPoll();
  }

  $('btnResume').onclick"""),
])

# Tela Salvar: guarda a corrida pendente até salvar ou descartar
edit('js/history.js', [
    ("function openSave(run) {\n  const v = document.getElementById('viewSave');",
     "const PENDING_KEY = 'passada_pendente';\nfunction openSave(run) {\n  try { localStorage.setItem(PENDING_KEY, JSON.stringify(run)); } catch (_) {}\n  const v = document.getElementById('viewSave');"),
    ("  const close = () => { if (saveMap) { saveMap.remove(); saveMap = null; } v.classList.add('hidden'); };",
     "  const close = () => { localStorage.removeItem(PENDING_KEY); if (saveMap) { saveMap.remove(); saveMap = null; } v.classList.add('hidden'); };"),
])
s = open('js/history.js', encoding='utf-8').read()
s += r'''
// Ao abrir o app: se ficou uma corrida encerrada e não salva, volta para a tela Salvar
function reopenPendingSave() {
  try {
    const run = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (run && run.points && run.distance >= 50) openSave(run);
    else localStorage.removeItem(PENDING_KEY);
  } catch (_) { localStorage.removeItem(PENDING_KEY); }
}
'''
open('js/history.js', 'w', encoding='utf-8').write(s)

edit('js/tracker.js', [
    ("draw(); render(); setUiState('idle');\nif (!NATIVE) restore();",
     "draw(); render(); setUiState('idle');\nreopenPendingSave();\nif (!NATIVE) restore();"),
])
edit('css/app.css', [
    (".toast small { font-weight: 600; opacity: .7; margin-left: 6px; }",
     ".toast small { font-weight: 600; opacity: .7; margin-left: 6px; }\n.toast.notice { background: var(--card2); color: var(--txt); border: 1px solid var(--line); font-size: 14px; font-weight: 600; white-space: normal; width: calc(100% - 28px); text-align: center; border-radius: 16px; }"),
])
print('ok')
