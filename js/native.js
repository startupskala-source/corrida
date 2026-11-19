'use strict';
// Modo app Android: o serviço nativo (TrackingService) mede tudo, inclusive com a tela apagada.
// Esta parte só pergunta o estado a cada 1 s e reaproveita os desenhos do tracker.js.
(function () {
  if (!NATIVE) return;
  const showErr = (msg) => { const d = $('diag'); d.className = 'diag bad'; d.textContent = msg; };
  window.addEventListener('error', e => showErr('Algo deu errado: ' + e.message));
  window.addEventListener('unhandledrejection', e => showErr('Algo deu errado: ' + ((e.reason && e.reason.message) || e.reason)));
  const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || window.Capacitor.registerPlugin;
  if (!reg) { showErr('Algo não carregou direito. Feche e abra o app de novo.'); return; }
  const T = reg('Tracker');
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
        MapView.setPosition(s.posLat, s.posLon, s.acc, (s.speed > 0.8 && s.bearing != null) ? s.bearing : null);
        updateIdleHint(s.acc);
        setGps(s.acc <= 15 ? 'ok' : 'weak', `${s.acc <= 15 ? 'Sinal bom' : 'Sinal fraco'} · ±${Math.round(s.acc)} m`);
      } else setGps('weak', s.gpsOn ? 'Procurando sinal… melhor ao ar livre' : 'Sem sinal');
      $('diag').className = 'diag';
      $('diag').textContent = `${s.sats} satélites em uso` +
        (s.state !== 'idle' ? ` · leituras ${s.recv} · usadas ${s.used}${s.why ? ' · ' + s.why : ''}` : '');

      if (s.state === 'idle') { if (state !== 'idle') { state = 'idle'; setButtons(); } return; }
      if (s.pointCount < points.length) { points = []; splitsLen = -1; return; }   // outra corrida: recarrega tudo
      if (s.points.length) points.push(...s.points);
      distance = s.distance; splits = s.splits;
      lastSplitMs = s.lastSplitMs; lastSplitDist = s.lastSplitDist;
      nat = { elapsed: s.elapsed, at: performance.now(), paceNow: s.paceNow == null ? NaN : s.paceNow };
      if (s.state !== state) { state = s.state; setButtons(); }
      if (splits.length !== splitsLen) {
        if (splitsLen >= 0 && splits.length > splitsLen) { const l = splits[splits.length - 1]; showKmToast(l.km, l.ms); }
        splitsLen = splits.length; renderSplits();
      }
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
    if (!st.location) items.push(['Localização precisa', 'É com ela que a corrida é medida.', 'Permitir', 'perm']);
    if (!st.notifications) items.push(['Notificações', 'Para ver distância e ritmo com a tela apagada.', 'Permitir', 'perm']);
    if (!st.gpsEnabled) items.push(['Localização do celular', 'Está desligada.', 'Ligar', 'gps']);
    if (!st.batteryUnrestricted) items.push(['Bateria sem restrição', 'Assim o Android não interrompe a gravação no meio do caminho.', 'Liberar', 'bat']);
    const box = $('setup');
    if (!items.length) { box.classList.add('hidden'); return st; }
    box.innerHTML = '<div class="setup-title">Antes de sair</div>' + items.map(([t, d, b, a]) =>
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
    if (!st.location) { alert('Sem a localização não dá para medir a corrida. Você pode liberar em Configurações › Apps › passada › Permissões.'); return false; }
    if (!st.gpsEnabled) {
      if (confirm('A localização do celular está desligada. Abrir as configurações para ligar?')) await T.openLocationSettings();
      return false;
    }
    return true;
  }

  // ---------- botões ----------
  const voice = () => $('optVoice').checked;
  $('optVoice').onchange = () => T.setVoice({ voice: voice() }).catch(() => {});

  $('btnStart').onclick = async () => {
    if (state !== 'idle') return;
    if (!(await ready())) return;
    T.warmup().catch(() => {});
    resetRun(); splitsLen = -1;
    await runCountdown();                       // 3·2·1 com o mapa voando para a rua
    try { await T.start({ voice: voice() }); } catch (e) { alert('Não deu para começar: ' + (e.message || e)); setUiState('idle'); return; }
    enableMotion();
    state = 'running'; nat = { elapsed: 0, at: performance.now(), paceNow: NaN };
    setUiState('running'); startPoll();
  };

  $('btnResume').onclick = async () => {
    await T.resume({ voice: voice() });
    state = 'running'; nat = { elapsed: nat.elapsed, at: performance.now(), paceNow: NaN };
    MapView.recenter(); setUiState('running'); startPoll();
  };

  $('btnPause').onclick = async () => {
    await T.pause(); state = 'paused'; setUiState('paused'); pull();
  };

  $('btnStop').onclick = async () => {
    let r;
    try { r = await T.stop(); } catch (e) { alert('Não deu para encerrar: ' + (e.message || e)); return; }
    state = 'idle';
    points = r.points || []; distance = r.distance; splits = r.splits || [];
    nat = { elapsed: r.elapsed, at: performance.now(), paceNow: NaN };
    draw();
    finishRun({ distance: r.distance, elapsed: r.elapsed, splits, points });
    T.warmup().catch(() => {});                 // mantém o ponto azul no mapa
  };

  // ---------- ao abrir o app ----------
  (async () => {
    await window.welcomeDone;
    let st0 = null;
    try { st0 = await T.checkSetup(); } catch (e) { showErr('A medição não respondeu. Feche e abra o app de novo (' + (e.message || e) + ').'); return; }
    if (!st0.location || !st0.notifications) { try { await T.requestPermissions(); } catch (_) {} }
    const st = await renderSetup();
    let s = { state: 'off' };
    try { s = await T.getState({ from: 0 }); } catch (_) {}
    if (s.state === 'running' || s.state === 'paused') { startPoll(); return; }   // já estava gravando
    try {
      const snap = await T.getSnapshot();
      if (snap.exists && Date.now() - snap.savedAt < 6 * 3600 * 1000) {
        if (confirm(`Ficou uma corrida aberta (${fmtNum(snap.distance / 1000, 2)} km). Quer continuar de onde parou?`)) {
          await T.restoreSnapshot(); startPoll(); return;
        }
        await T.discardSnapshot();
      }
    } catch (_) {}
    if (st && st.location) { await T.warmup().catch(() => {}); startPoll(); }
  })();
})();
