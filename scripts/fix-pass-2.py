# Correções da revisão independente (JS). Rodar da raiz do projeto.
def edit(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8').write(s)

# ---------- tracker.js ----------
edit('js/tracker.js', [
    # cadência: o sensor era registrado de novo a cada corrida (contagem dobrava)
    ("async function enableMotion() {\n  try {",
     "let motionOn = false;\nasync function enableMotion() {\n  if (motionOn) return;\n  try {"),
    ("    window.addEventListener('devicemotion', onMotion);\n  } catch (_) {}",
     "    window.addEventListener('devicemotion', onMotion); motionOn = true;\n  } catch (_) {}"),
    # sinal perdido > 10 s: mede o trecho pela posição em vez de descartar
    ("    if (!pv || dtv <= 0 || dtv > 10) { diag.why = 'aguardando'; showDiag(); return; }",
     """    if (!pv || dtv <= 0 || dtv > 10) {
      // voltou depois de um buraco no sinal: conta o trecho pela distância em linha reta
      const gap = haversine(lastFix, p), gdt = (ts - lastTs) / 1000;
      if (gap < Math.max(MIN_STEP, accuracy) || (gdt > 0 && gap / gdt > MAX_SPEED)) { diag.why = 'aguardando'; showDiag(); return; }
      stepM = gap;
    } else {"""),
    # horário real de início guardado junto
    ("      points, distance, elapsedMs: currentElapsed(), splits, lastSplitMs, lastSplitDist, savedAt: Date.now()",
     "      points, distance, elapsedMs: currentElapsed(), splits, lastSplitMs, lastSplitDist, startedAt: runStartedAt, savedAt: Date.now()"),
    ("    ({ points, distance, elapsedMs, splits, lastSplitMs, lastSplitDist } = s);",
     "    ({ points, distance, elapsedMs, splits, lastSplitMs, lastSplitDist } = s);\n    runStartedAt = s.startedAt || (s.savedAt - s.elapsedMs);"),
    ("let starting = false;                               // evita duas contagens com toque duplo",
     "let starting = false;                               // evita duas contagens com toque duplo\nlet runStartedAt = 0;                               // hora real do início (para data e título)"),
    ("  state = 'running'; runStart = Date.now(); keepAwake();\n  clearInterval(tick); tick = setInterval(render, 500);\n  setUiState('running'); render();\n};",
     "  state = 'running'; runStart = Date.now(); runStartedAt = Date.now(); keepAwake();\n  clearInterval(tick); tick = setInterval(render, 500);\n  setUiState('running'); render();\n};"),
    # Encerrar: trava a interface na hora (sem toque duplo / Continuar depois de encerrar)
    ("""$('btnStop').onclick = () => {
  state = 'idle';""",
     """$('btnStop').onclick = () => {
  if (state !== 'paused') return;
  state = 'idle';"""),
    ("""$('btnResume').onclick = () => {
  segBreak = true;""",
     """$('btnResume').onclick = () => {
  if (state !== 'paused') return;
  enableMotion();
  segBreak = true;"""),
    ("""    id: Math.round(Date.now() - r.elapsed),        // início aproximado (ms) — também é a chave""",
     """    id: Math.round(r.startedAt || runStartedAt || (Date.now() - r.elapsed)),   // hora do início — também é a chave"""),
    ("""  MapView.fit(r.points);
  if (r.distance < 50) {""",
     """  setUiState('saving');
  MapView.fit(r.points);
  if (r.distance < 50) {"""),
    ("""  setTimeout(() => openSave(run), 700);              // deixa o mapa terminar de se afastar""",
     """  try { localStorage.setItem(PENDING_KEY, JSON.stringify(run)); } catch (_) {}   // protegido desde já
  setTimeout(() => openSave(run), 700);              // deixa o mapa terminar de se afastar"""),
])
s = open('js/tracker.js', encoding='utf-8').read()
# fecha o bloco else aberto acima (logo antes do "if (vAvg < 0.5)")
a = s.index("    if (vAvg < 0.5) { diag.why = 'parado'; showDiag(); return; }")
b = s.index("    stepM = vAvg * dtv;", a)
inner = s[a:b + len("    stepM = vAvg * dtv;")]
s = s.replace(inner, "\n".join("  " + l for l in inner.split("\n")) + "\n    }", 1)
# botão voltar do Android: fecha telas por cima, senão minimiza (nunca perde a corrida)
s += r'''
// Chamado pelo Android (MainActivity) no botão voltar. true = tratado aqui; false = minimizar o app.
window.passadaBack = () => {
  if (!$('viewSummary').classList.contains('hidden')) { closeSummary(); return true; }
  if (!$('viewSave').classList.contains('hidden')) return false;        // a corrida fica guardada como pendente
  if (document.body.dataset.mode === 'stats' && state !== 'idle') { $('btnMode').click(); return true; }
  if (document.body.dataset.view === 'viewHistory') { document.querySelector('.tab[data-view="viewRun"]').click(); return true; }
  return false;
};
'''
open('js/tracker.js', 'w', encoding='utf-8').write(s)

# ---------- history.js: PENDING_KEY precisa existir antes do tracker usar ----------
edit('js/history.js', [
    ("const PENDING_KEY = 'passada_pendente';\nfunction openSave(run) {", "function openSave(run) {"),
    ("let summaryMap = null, saveMap = null;", "let summaryMap = null, saveMap = null;\nconst PENDING_KEY = 'passada_pendente';"),
])

# ---------- store.js: erro de cota não pode deixar o Salvar mudo ----------
edit('js/store.js', [
    ("      r.onerror = () => rej(r.error);\n    });\n    return dbp;",
     "      r.onerror = () => { dbp = null; rej(r.error); };\n      r.onblocked = () => { dbp = null; rej(new Error('banco ocupado')); };\n    });\n    return dbp;"),
    ("      t.onerror = () => rej(t.error);", "      t.onerror = () => rej(t.error);\n      t.onabort = () => rej(t.error || new Error('gravação cancelada'));"),
])

# ---------- native.js ----------
edit('js/native.js', [
    # serviço morreu no meio da corrida: recupera do arquivo ou volta ao início
    ("      if (s.state === 'off') return;",
     """      if (s.state === 'off') {
        if (state !== 'idle' && !recovering) recoverLost();
        return;
      }"""),
    ("  let poll = null, splitsLen = -1, busy = false;",
     """  let poll = null, splitsLen = -1, busy = false, recovering = false;
  async function recoverLost() {
    recovering = true;
    try {
      const snap = await T.getSnapshot();
      if (snap.exists) { await T.restoreSnapshot(); showNotice('A gravação foi interrompida pelo celular. Recuperei sua corrida, pausada.'); }
      else { state = 'idle'; resetRun(); setUiState('idle'); showNotice('A gravação foi interrompida pelo celular e não deu para recuperar.'); }
    } catch (_) { state = 'idle'; setUiState('idle'); }
    recovering = false;
  }"""),
    ("    state = 'running'; nat = { elapsed: 0, at: performance.now(), paceNow: NaN };\n    setUiState('running'); startPoll();\n  }",
     "    state = 'running'; runStartedAt = Date.now(); nat = { elapsed: 0, at: performance.now(), paceNow: NaN };\n    setUiState('running'); startPoll();\n  }"),
    ("""  $('btnResume').onclick = async () => {
    await T.resume({ voice: voice() });""",
     """  $('btnResume').onclick = async () => {
    if (state !== 'paused') return;
    try { await T.resume({ voice: voice() }); } catch (e) { showNotice('Não deu para continuar: ' + (e.message || e)); pull(); return; }
    enableMotion();"""),
    ("""  $('btnPause').onclick = async () => {
    await T.pause();""",
     """  $('btnPause').onclick = async () => {
    if (state !== 'running') return;
    try { await T.pause(); } catch (_) {}"""),
    ("""  $('btnStop').onclick = async () => {
    let r;""",
     """  let stopping = false;
  $('btnStop').onclick = async () => {
    if (state !== 'paused' || stopping) return;
    stopping = true; setTimeout(() => { stopping = false; }, 1500);
    let r;"""),
    # volta para o app: religa o GPS para o ponto azul e o sinal
    ("  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderSetup(); });",
     "  document.addEventListener('visibilitychange', async () => {\n    if (document.visibilityState !== 'visible') return;\n    const st = await renderSetup();\n    if (st && st.location) T.warmup().catch(() => {});\n  });"),
])
s = open('js/native.js', encoding='utf-8').read()
s = s.replace("finishRun({ distance: r.distance, elapsed: r.elapsed, splits, points });",
              "finishRun({ distance: r.distance, elapsed: r.elapsed, splits, points, startedAt: r.startedAt });", 1)
open('js/native.js', 'w', encoding='utf-8').write(s)

# ---------- CSS: estado "saving" esconde a folha de controles ----------
edit('css/app.css', [
    ("body[data-rec=\"countdown\"] .controls { visibility: hidden; }",
     "body[data-rec=\"countdown\"] .controls, body[data-rec=\"saving\"] .controls { visibility: hidden; }"),
])
print('ok')
