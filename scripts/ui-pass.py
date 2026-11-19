# Troca a camada de interface do tracker.js pela nova (modelo de gravação com mapa em tela cheia).
p = 'js/tracker.js'
s = open(p, encoding='utf-8').read()

def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)

rep("  if (accuracy < 1000) MapView.setPosition(lat, lon, accuracy);",
    "  if (accuracy < 1000) MapView.setPosition(lat, lon, accuracy, (speed != null && speed > 0.8) ? pos.coords.heading : null);\n  updateIdleHint(accuracy);")
rep("    announce(splits.length, ms);\n    renderSplits();", "    announce(splits.length, ms);\n    showKmToast(splits.length, ms);\n    renderSplits();")
rep("state = 'paused'; setButtons(); render(); renderSplits(); draw(); startGps();",
    "state = 'paused'; setUiState('paused'); render(); renderSplits(); draw(); startGps();")

a = s.index('// ---------- Render ----------')
b = s.index('function renderSplits()')
s = s[:a] + r'''// ---------- Render ----------
const setText = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
function render() {
  const el = currentElapsed();
  const km = distance / 1000;
  const avg = km > 0.02 ? (el / 1000) / km : NaN;
  const now = paceNow();
  const lapD = distance - lastSplitDist, lapT = (el - lastSplitMs) / 1000;
  const c = cadence();
  setText('sTime', fmtTime(el)); setText('fTime', fmtTime(el));
  setText('sDist', fmtNum(km, 2)); setText('fDist', fmtNum(km, 2));
  setText('sPace', fmtPace(now)); setText('fPace', fmtPace(now));
  setText('fAvg', fmtPace(avg));
  setText('fLap', fmtPace(lapD > 20 ? lapT / (lapD / 1000) : NaN));
  setText('fCad', isFinite(c) ? String(Math.round(c)) : '--');

  // barra de ritmo: atual vs média (sálvia = mais rápido, ocre = mais lento)
  const bar = $('rhythmBar'), txt = $('rhythmTxt');
  if (isFinite(now) && isFinite(avg)) {
    const diff = avg - now;
    const pct = Math.max(-50, Math.min(50, diff / avg * 250));
    bar.style.background = diff >= 0 ? 'var(--acc)' : 'var(--warn)';
    bar.style.left = pct >= 0 ? '50%' : `${50 + pct}%`;
    bar.style.width = `${Math.abs(pct)}%`;
    const sec = Math.round(Math.abs(diff));
    txt.textContent = sec < 3 ? 'No seu ritmo médio' : `${sec} s/km ${diff > 0 ? 'mais rápido' : 'mais lento'} que sua média`;
  } else { bar.style.width = '0'; txt.textContent = ''; }
}

// Texto da folha antes de começar, conforme o sinal
function updateIdleHint(acc) {
  const h = $('idleHint'); if (!h) return;
  h.textContent = !isFinite(acc) ? 'Esperando o sinal' : acc <= 15 ? 'Sinal bom. Pode começar.' : acc <= 40 ? 'Sinal razoável. Melhor ao ar livre.' : 'Sinal fraco. Procure um lugar aberto.';
}

// Aviso que desce do topo a cada km
let toastTimer = null;
function showKmToast(km, ms) {
  const t = $('kmToast');
  t.innerHTML = `Km ${km} <small>${fmtPace(ms / 1000)} /km</small>`;
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

''' + s[b:]

a = s.index('// ---------- Controles ----------')
b = s.index('window.addEventListener(\'resize\', draw);')
s = s[:a] + r'''// ---------- Estados da interface ----------
// idle → countdown → running ⇄ paused → (salvar) → idle. O CSS anima cada troca a partir de body[data-rec].
function setUiState(s) {
  document.body.dataset.rec = s;
  if (s === 'idle') document.body.dataset.mode = 'map';
  setTimeout(() => MapView.invalidate(), 420);
}
function setButtons() { setUiState(state); }

const COUNT_KEY = 'passada_contagem';
$('optCount').checked = localStorage.getItem(COUNT_KEY) !== '0';
$('optCount').onchange = () => localStorage.setItem(COUNT_KEY, $('optCount').checked ? '1' : '0');

// 3 · 2 · 1 com o mapa voando para a rua ao mesmo tempo
function runCountdown() {
  MapView.flyToStreet();
  if (!$('optCount').checked) return Promise.resolve();
  setUiState('countdown');
  const n = $('cdNum');
  return new Promise(resolve => {
    let i = 3;
    const step = () => {
      if (i === 0) { resolve(); return; }
      n.textContent = i; n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick');
      if (navigator.vibrate) navigator.vibrate(30);
      i--; setTimeout(step, 900);
    };
    step();
  });
}

function resetRun() {
  points = []; distance = 0; elapsedMs = 0; splits = []; lastSplitMs = 0; lastSplitDist = 0;
  lastFix = null; segBreak = false; steps = []; gpsSpeeds = []; kf.reset(); prevV = null;
  Object.assign(diag, { recv: 0, used: 0, why: '' });
  MapView.clearRoute(); renderSplits(); render();
}

$('btnStart').onclick = async () => {
  if (state !== 'idle') return;
  resetRun(); enableMotion(); startGps();
  await runCountdown();
  state = 'running'; runStart = Date.now(); keepAwake();
  clearInterval(tick); tick = setInterval(render, 500);
  setUiState('running'); render();
};

$('btnResume').onclick = () => {
  segBreak = true; state = 'running'; runStart = Date.now(); keepAwake();
  clearInterval(tick); tick = setInterval(render, 500);
  MapView.recenter(); setUiState('running'); render();
};

$('btnPause').onclick = () => {
  elapsedMs = currentElapsed(); state = 'paused';
  clearInterval(tick); render(); save(); setUiState('paused');
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
};

$('btnStop').onclick = () => {
  state = 'idle';
  localStorage.removeItem(SAVE_KEY);
  finishRun({ distance, elapsed: elapsedMs, splits, points });
};

// Encerrou: afasta o mapa e abre "Salvar corrida" (versão web e nativa)
function finishRun(r) {
  const run = {
    id: Math.round(Date.now() - r.elapsed),        // início aproximado (ms) — também é a chave
    distance: r.distance, elapsed: r.elapsed, splits: r.splits,
    points: r.points.map(p => ({ lat: +(+p.lat).toFixed(6), lon: +(+p.lon).toFixed(6), t: Math.round(p.t), d: Math.round(p.d * 10) / 10, brk: p.brk || undefined }))
  };
  MapView.fit(r.points);
  if (r.distance < 50) {
    alert('Corrida curta demais para guardar (menos de 50 m).');
    backToIdle(); return;
  }
  setTimeout(() => openSave(run), 700);              // deixa o mapa terminar de se afastar
}

// Depois de salvar ou descartar: tudo limpo, mapa volta para você
function backToIdle() {
  state = 'idle'; clearInterval(tick);
  resetRun(); setUiState('idle');
  setTimeout(() => MapView.recenter(), 450);
}

// ---------- Mapa / números ----------
$('btnCenter').onclick = () => MapView.recenter();
$('btnMode').onclick = () => {
  document.body.dataset.mode = document.body.dataset.mode === 'stats' ? 'map' : 'stats';
  if (document.body.dataset.mode === 'map') MapView.invalidate();
};
$('statsRow').onclick = () => $('btnMode').click();

// ---------- Navegação inferior ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== b.dataset.view));
  document.body.dataset.view = b.dataset.view;
  if (b.dataset.view === 'viewHistory') renderHistory(); else MapView.invalidate();
});

''' + s[b:]
s = s.replace("draw(); render();\nif (!NATIVE) restore();", "draw(); render(); setUiState('idle');\nif (!NATIVE) restore();")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
