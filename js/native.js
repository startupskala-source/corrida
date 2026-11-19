'use strict';
// Modo app Android: o serviço nativo (TrackingService) mede tudo, inclusive com a tela apagada.
// Esta parte só pergunta o estado a cada 1 s e reaproveita os desenhos do tracker.js.
(function () {
  if (!NATIVE) return;
  const T = window.Capacitor.registerPlugin('Tracker');
  let nat = { elapsed: 0, at: performance.now(), paceNow: NaN };
  let poll = null, splitsLen = -1, busy = false;

  currentElapsed = () => state === 'running' ? nat.elapsed + (performance.now() - nat.at) : nat.elapsed;
  paceNow = () => nat.paceNow;

  // ---------- leitura do estado nativo ----------
  async function pull() {
    if (busy) return; busy = true;
    try {
      const s = await T.getState({ from: points.length });
      if (s.state === 'off') return;
      if (s.acc > 0 && s.posLat != null && s.posAge < 20000) {
        MapView.setPosition(s.posLat, s.posLon, s.acc);
        setGps(s.acc <= 15 ? 'ok' : 'weak', `GPS ±${Math.round(s.acc)} m · ${s.sats} sat`);
      } else setGps('weak', s.gpsOn ? 'Procurando GPS… (fique ao ar livre)' : 'GPS desligado');
      $('diag').className = 'diag';
      $('diag').textContent = `Satélites em uso: ${s.sats}/${s.satsTotal}` +
        (s.state !== 'idle' ? ` · leituras ${s.recv} · usadas ${s.used}${s.why ? ' · ' + s.why : ''}` : '');

      if (s.state === 'idle') { if (state !== 'idle') { state = 'idle'; setButtons(); } return; }
      if (s.pointCount < points.length) { points = []; splitsLen = -1; return; }   // outra corrida: recarrega tudo
      if (s.points.length) points.push(...s.points);
      distance = s.distance; splits = s.splits;
      lastSplitMs = s.lastSplitMs; lastSplitDist = s.lastSplitDist;
      nat = { elapsed: s.elapsed, at: performance.now(), paceNow: s.paceNow == null ? NaN : s.paceNow };
      if (s.state !== state) { state = s.state; setButtons(); }
      if (splits.length !== splitsLen) { splitsLen = splits.length; renderSplits(); }
      render(); draw();
    } catch (_) {
    } finally { busy = false; }
  }
  function startPoll() {
    clearInterval(poll); poll = setInterval(pull, 1000); pull();
    clearInterval(tick); tick = setInterval(render, 500);
  }
  function stopPoll() { clearInterval(poll); clearInterval(tick); poll = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startPoll(); else stopPoll();   // tela apagada: o nativo segue sozinho
  });

  // ---------- preparação: permissões, GPS, bateria ----------
  async function renderSetup() {
    let st;
    try { st = await T.checkSetup(); } catch (_) { return null; }
    const items = [];
    if (!st.location) items.push(['Localização precisa', 'Necessária para medir a corrida.', 'Permitir', 'perm']);
    if (!st.notifications) items.push(['Notificações', 'Mostra distância e pace com a tela apagada.', 'Permitir', 'perm']);
    if (!st.gpsEnabled) items.push(['GPS do celular', 'Está desligado.', 'Ligar', 'gps']);
    if (!st.batteryUnrestricted) items.push(['Bateria sem restrição', 'Evita o Android parar a gravação no meio da corrida.', 'Liberar', 'bat']);
    const box = $('setup');
    if (!items.length) { box.classList.add('hidden'); return st; }
    box.innerHTML = '<div class="setup-title">Antes de correr</div>' + items.map(([t, d, b, a]) =>
      `<div class="setup-row"><div><b>${t}</b><small>${d}</small></div><button data-a="${a}">${b}</button></div>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('button').forEach(btn => btn.onclick = async () => {
      if (btn.dataset.a === 'perm') await T.requestPermissions();
      if (btn.dataset.a === 'gps') await T.openLocationSettings();
      if (btn.dataset.a === 'bat') await T.requestBatteryUnrestricted();
      setTimeout(async () => { const s2 = await renderSetup(); if (s2 && s2.location) { await T.warmup().catch(() => {}); startPoll(); } }, 600);
    });
    return st;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderSetup(); });

  async function ready() {
    let st = await T.checkSetup();
    if (!st.location || !st.notifications) st = await T.requestPermissions();
    renderSetup();
    if (!st.location) { alert('Sem a permissão de localização o app não consegue medir a corrida.'); return false; }
    if (!st.gpsEnabled) {
      if (confirm('O GPS do celular está desligado. Abrir as configurações para ligar?')) await T.openLocationSettings();
      return false;
    }
    return true;
  }

  // ---------- botões ----------
  const voice = () => $('optVoice').checked;
  $('optVoice').onchange = () => T.setVoice({ voice: voice() }).catch(() => {});

  $('btnStart').onclick = async () => {
    if (state === 'idle') {
      if (!(await ready())) return;
      points = []; splits = []; distance = 0; splitsLen = -1; renderSplits();
      try { await T.start({ voice: voice() }); } catch (e) { alert('Não consegui iniciar: ' + (e.message || e)); return; }
      enableMotion();
    } else {
      await T.resume({ voice: voice() });
    }
    state = 'running'; nat = { elapsed: nat.elapsed, at: performance.now(), paceNow: NaN };
    setButtons(); startPoll();
  };

  $('btnPause').onclick = async () => {
    await T.pause(); state = 'paused'; setButtons(); pull();
  };

  $('btnStop').onclick = async () => {
    if (!confirm('Finalizar a corrida?')) return;
    let r;
    try { r = await T.stop(); } catch (e) { alert('Erro ao finalizar: ' + (e.message || e)); return; }
    state = 'idle'; setButtons();
    points = r.points || []; distance = r.distance; splits = r.splits || [];
    nat = { elapsed: r.elapsed, at: performance.now(), paceNow: NaN };
    render(); draw();
    finishRun({ distance: r.distance, elapsed: r.elapsed, splits, points });
  };

  // ---------- ao abrir o app ----------
  (async () => {
    const st = await renderSetup();
    let s = { state: 'off' };
    try { s = await T.getState({ from: 0 }); } catch (_) {}
    if (s.state === 'running' || s.state === 'paused') { startPoll(); return; }   // já estava gravando
    try {
      const snap = await T.getSnapshot();
      if (snap.exists && Date.now() - snap.savedAt < 6 * 3600 * 1000) {
        if (confirm(`Há uma corrida não finalizada (${fmtNum(snap.distance / 1000, 2)} km). Continuar?`)) {
          await T.restoreSnapshot(); startPoll(); return;
        }
        await T.discardSnapshot();
      }
    } catch (_) {}
    if (st && st.location) { await T.warmup().catch(() => {}); startPoll(); }
  })();
})();
