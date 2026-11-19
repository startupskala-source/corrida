# Modo nativo no fluxo novo (contagem, zoom na rua, aviso de km, salvar).
p = 'js/native.js'
s = open(p, encoding='utf-8').read()

def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)

rep("        MapView.setPosition(s.posLat, s.posLon, s.acc);",
    "        MapView.setPosition(s.posLat, s.posLon, s.acc, (s.speed > 0.8 && s.bearing != null) ? s.bearing : null);\n        updateIdleHint(s.acc);")
rep("      if (splits.length !== splitsLen) { splitsLen = splits.length; renderSplits(); }",
    "      if (splits.length !== splitsLen) {\n        if (splitsLen >= 0 && splits.length > splitsLen) { const l = splits[splits.length - 1]; showKmToast(l.km, l.ms); }\n        splitsLen = splits.length; renderSplits();\n      }")

a = s.index('  // ---------- botões ----------')
b = s.index('  // ---------- ao abrir o app ----------')
s = s[:a] + r'''  // ---------- botões ----------
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

''' + s[b:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
