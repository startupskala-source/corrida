'use strict';
// ---------- Config ----------
const MAX_ACCURACY = 65;      // m — descarta leituras de GPS piores que isso
const MIN_STEP = 2;           // m — ignora "tremidas" do GPS parado
const KF_Q = 3;               // m/s — quanto a posição pode mudar por segundo (corrida)
const MAX_SPEED = 12;         // m/s (~43 km/h) — descarta saltos impossíveis
const PACE_WINDOW = 20;       // s — janela para o pace atual
const SAVE_KEY = 'corrida_atual';
// Dentro do app Android o GPS é medido pelo serviço nativo (js/native.js); aqui só no navegador.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// ---------- Estado ----------
let state = 'idle';           // idle | running | paused
let points = [];              // {lat, lon, t, d} d = distância acumulada
let distance = 0;             // metros
let elapsedMs = 0, runStart = 0;
let splits = [];              // {km, ms}
let lastSplitMs = 0, lastSplitDist = 0;
let watchId = null, wakeLock = null, tick = null;
let lastFix = null;           // último ponto aceito (para filtros)
let segBreak = false;         // próximo ponto inicia novo trecho (após pausa)
let steps = [];               // timestamps de passos (acelerômetro)

const $ = id => document.getElementById(id);

// ---------- Formatação ----------
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}
function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
const fmtNum = (n, d) => n.toFixed(d).replace('.', ',');

// ---------- Geo ----------
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function currentElapsed() {
  return state === 'running' ? elapsedMs + (Date.now() - runStart) : elapsedMs;
}

function setGps(cls, txt) {
  $('gps').className = cls; $('gps').querySelector('span').textContent = txt;
}

// Filtro de Kalman simples (posição + incerteza), igual ao usado em apps de corrida:
// leituras precisas pesam mais, leituras ruins pesam menos; tira o "zigue-zague" do GPS.
const kf = {
  v: -1, lat: 0, lon: 0, ts: 0,
  reset() { this.v = -1; },
  step(lat, lon, acc, ts) {
    acc = Math.max(acc, 1);
    if (this.v < 0) { this.lat = lat; this.lon = lon; this.v = acc * acc; this.ts = ts; return; }
    const dt = (ts - this.ts) / 1000;
    if (dt > 0) { this.v += dt * KF_Q * KF_Q; this.ts = ts; }
    const k = this.v / (this.v + acc * acc);
    this.lat += k * (lat - this.lat); this.lon += k * (lon - this.lon);
    this.v = (1 - k) * this.v;
  }
};
const diag = { recv: 0, used: 0, acc: NaN, why: '', coarse: 0 };
let gpsSpeeds = [];           // {ts, v} velocidade Doppler do chip GPS (m/s)
let lastTs = 0;               // timestamp (relógio do GPS) do último ponto contado
let prevV = null;             // última velocidade Doppler {ts, v}

function showDiag() {
  const el = $('diag');
  if (diag.coarse >= 3) {
    el.className = 'diag bad';
    el.textContent = `Precisão ±${Math.round(diag.acc)} m: o celular está dando localização APROXIMADA. ` +
      `Ative "Localização precisa" para este site/navegador nas permissões do celular.`;
    return;
  }
  el.className = 'diag';
  el.textContent = `Leituras: ${diag.recv} · usadas: ${diag.used}` +
    (isFinite(diag.acc) ? ` · ±${Math.round(diag.acc)} m` : '') + (diag.why ? ` · ${diag.why}` : '');
}

function onPosition(pos) {
  const { latitude: lat, longitude: lon, accuracy, speed } = pos.coords;
  const ts = pos.timestamp || Date.now();
  diag.acc = accuracy;
  diag.coarse = accuracy >= 100 ? diag.coarse + 1 : 0;
  if (accuracy <= 15) setGps('ok', `GPS ±${Math.round(accuracy)} m`);
  else setGps('weak', `GPS ±${Math.round(accuracy)} m`);
  if (accuracy < 1000) MapView.setPosition(lat, lon, accuracy);
  if (state !== 'running') { showDiag(); return; }
  diag.recv++;

  if (accuracy > MAX_ACCURACY) { diag.why = 'sinal fraco, ignorada'; showDiag(); return; }

  if (speed != null && isFinite(speed) && accuracy <= 30) {
    gpsSpeeds.push({ ts, v: speed });
    while (gpsSpeeds.length && ts - gpsSpeeds[0].ts > 10000) gpsSpeeds.shift();
  }

  if (segBreak) { kf.reset(); prevV = null; }
  kf.step(lat, lon, accuracy, ts);
  const t = currentElapsed();
  const p = { lat: kf.lat, lon: kf.lon, t, d: distance, brk: false };

  if (!lastFix || segBreak) {
    p.brk = segBreak && !!lastFix; segBreak = false;
    if (speed != null && isFinite(speed)) prevV = { ts, v: speed };
    lastFix = p; lastTs = ts; points.push(p); diag.used++; diag.why = 'início'; showDiag(); draw(); return;
  }
  const hasV = speed != null && isFinite(speed) && accuracy <= 40;
  let stepM;
  if (hasV) {
    // Modo principal: integra a velocidade Doppler (não soma o "tremido" da posição)
    const pv = prevV; prevV = { ts, v: speed };
    const dtv = pv ? (ts - pv.ts) / 1000 : 0;
    const vAvg = pv ? (speed + pv.v) / 2 : speed;
    if (!pv || dtv <= 0 || dtv > 10) { diag.why = 'aguardando'; showDiag(); return; }
    if (vAvg < 0.5) { diag.why = 'parado'; showDiag(); return; }
    if (vAvg > MAX_SPEED) { diag.why = 'salto, ignorada'; showDiag(); return; }
    stepM = vAvg * dtv;
  } else {
    // Reserva (aparelho sem velocidade): posição filtrada, só conta passos maiores que o ruído
    prevV = null;
    stepM = haversine(lastFix, p);
    const dt = (ts - lastTs) / 1000;
    if (stepM < Math.max(MIN_STEP, accuracy)) { diag.why = 'parado'; showDiag(); return; }
    if (dt > 0 && stepM / dt > MAX_SPEED) { diag.why = 'salto, ignorada'; showDiag(); return; }
  }

  distance += stepM;
  p.d = distance;
  lastFix = p; lastTs = ts;
  points.push(p);
  diag.used++; diag.why = '';
  showDiag();
  checkSplit(t);
  render();
  draw();
  save();
}

function onGeoError(err) {
  const msg = { 1: 'Permissão de GPS negada', 2: 'GPS indisponível', 3: 'GPS sem sinal' }[err.code] || 'Erro de GPS';
  setGps('', msg);
}

function startGps() {
  if (NATIVE) return;
  if (!('geolocation' in navigator)) { setGps('', 'Sem GPS neste aparelho'); return; }
  if (watchId !== null) return;
  setGps('weak', 'Procurando GPS…');
  watchId = navigator.geolocation.watchPosition(onPosition, onGeoError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

// ---------- Splits ----------
function checkSplit(t) {
  while (distance - lastSplitDist >= 1000) {
    // interpola o instante exato em que cruzou o km
    const target = lastSplitDist + 1000;
    let tCross = t, cLat = null, cLon = null;
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i - 1], b = points[i];
      if (a.d <= target && b.d >= target) {
        const f = (target - a.d) / (b.d - a.d || 1);
        tCross = a.t + (b.t - a.t) * f;
        cLat = a.lat + (b.lat - a.lat) * f; cLon = a.lon + (b.lon - a.lon) * f; break;
      }
    }
    const ms = tCross - lastSplitMs;
    splits.push({ km: splits.length + 1, ms, lat: cLat, lon: cLon });
    lastSplitMs = tCross; lastSplitDist = target;
    announce(splits.length, ms);
    renderSplits();
  }
}

function announce(km, ms) {
  if (!$('optVoice').checked || !('speechSynthesis' in window)) return;
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), ss = s % 60;
  const avg = currentElapsed() / 1000 / (distance / 1000);
  const am = Math.floor(avg / 60), as = Math.round(avg % 60);
  const u = new SpeechSynthesisUtterance(
    `${km} quilômetro${km > 1 ? 's' : ''}. Parcial ${m} minutos e ${ss} segundos. Pace médio ${am} e ${as}.`);
  u.lang = 'pt-BR';
  speechSynthesis.speak(u);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// ---------- Cálculos ----------
function paceNow() {
  // 1º: velocidade Doppler do chip GPS (últimos 6 s) — a mais estável
  const lastT = gpsSpeeds.length ? gpsSpeeds[gpsSpeeds.length - 1].ts : 0;
  const recent = gpsSpeeds.filter(s => lastT - s.ts <= 6000);
  if (recent.length >= 2 && Date.now() - lastT < 8000) {
    const v = recent.reduce((a, s) => a + s.v, 0) / recent.length;
    return v > 0.5 ? 1000 / v : NaN;
  }
  // 2º: distância percorrida na janela recente
  if (points.length < 2) return NaN;
  const last = points[points.length - 1];
  const now = currentElapsed();
  if (now - last.t > 10000) return NaN;  // sem movimento recente
  let i = points.length - 1;
  while (i > 0 && last.t - points[i - 1].t <= PACE_WINDOW * 1000 && !points[i].brk) i--;
  const first = points[i];
  const dd = last.d - first.d, dt = (last.t - first.t) / 1000;
  if (dd < 10 || dt < 3) return NaN;
  return dt / (dd / 1000);
}

// ---------- Cadência (acelerômetro) ----------
let accLast = 0, accHigh = false, accFilt = 9.8;
function onMotion(e) {
  if (state !== 'running') return;
  const a = e.accelerationIncludingGravity; if (!a) return;
  const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  accFilt = accFilt * 0.8 + mag * 0.2;
  const now = performance.now();
  if (!accHigh && accFilt > 11.5 && now - accLast > 250) { accHigh = true; accLast = now; steps.push(now); }
  else if (accHigh && accFilt < 10) accHigh = false;
  while (steps.length && now - steps[0] > 15000) steps.shift();
}
function cadence() {
  if (steps.length < 6) return NaN;
  const span = (steps[steps.length - 1] - steps[0]) / 60000;
  return span > 0 ? (steps.length - 1) / span : NaN;
}
async function enableMotion() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      if (await DeviceMotionEvent.requestPermission() !== 'granted') return;
    }
    window.addEventListener('devicemotion', onMotion);
  } catch (_) {}
}

// ---------- Render ----------
function render() {
  const el = currentElapsed();
  $('time').textContent = fmtTime(el);
  const km = distance / 1000;
  $('dist').innerHTML = `${fmtNum(km, 2)}<small>km</small>`;
  const avg = km > 0.02 ? (el / 1000) / km : NaN;
  $('paceAvg').innerHTML = `${fmtPace(avg)}<small>/km</small>`;
  const now = paceNow();
  $('paceNow').innerHTML = `${fmtPace(now)}<small>/km</small>`;
  $('speed').innerHTML = `${fmtNum(isFinite(now) ? 3600 / now : 0, 1)}<small>km/h</small>`;
  const lapD = distance - lastSplitDist, lapT = (el - lastSplitMs) / 1000;
  $('paceLap').innerHTML = `${fmtPace(lapD > 20 ? lapT / (lapD / 1000) : NaN)}<small>/km</small>`;
  $('mfTime').textContent = fmtTime(el);
  $('mfDist').textContent = fmtNum(km, 2);
  $('mfPace').textContent = fmtPace(now);
  const c = cadence();
  $('cadence').innerHTML = `${isFinite(c) ? Math.round(c) : '--'}<small>spm</small>`;

  // barra de ritmo: atual vs média (verde = mais rápido, laranja = mais lento)
  const bar = $('rhythmBar'), txt = $('rhythmTxt');
  if (isFinite(now) && isFinite(avg)) {
    const diff = avg - now; // >0 = mais rápido que a média
    const pct = Math.max(-50, Math.min(50, diff / avg * 250));
    bar.style.background = diff >= 0 ? 'var(--acc)' : 'var(--warn)';
    bar.style.left = pct >= 0 ? '50%' : `${50 + pct}%`;
    bar.style.width = `${Math.abs(pct)}%`;
    const sec = Math.round(Math.abs(diff));
    txt.textContent = sec < 3 ? 'No ritmo da média' :
      `${sec}s/km ${diff > 0 ? 'mais rápido' : 'mais lento'} que a média`;
  } else { bar.style.width = '0'; txt.textContent = ''; }
}

function renderSplits() {
  if (!splits.length) { $('splitsWrap').innerHTML = '<div class="empty">Os parciais aparecem a cada quilômetro.</div>'; return; }
  const best = Math.min(...splits.map(s => s.ms));
  let total = 0;
  const rows = splits.map(s => {
    total += s.ms;
    return `<tr><td>${s.km}</td><td class="${s.ms === best && splits.length > 1 ? 'best' : ''}">${fmtPace(s.ms / 1000)}</td><td>${fmtTime(total)}</td></tr>`;
  }).reverse().join('');
  $('splitsWrap').innerHTML = `<table><tr><th>Km</th><th>Pace</th><th>Acumulado</th></tr>${rows}</table>`;
}

function draw() {
  if (MapView.map) { MapView.update(points, splits); return; }
  drawCanvas();
}
function drawCanvas() {
  let cv = $('mapCanvas');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'mapCanvas'; $('map').appendChild(cv); }
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (points.length < 1) {
    ctx.fillStyle = '#8a92a3'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('O trajeto aparece aqui', w / 2, h / 2); return;
  }
  const lat0 = points[0].lat, k = Math.cos(lat0 * Math.PI / 180);
  const xs = points.map(p => p.lon * k), ys = points.map(p => p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 16, span = Math.max(maxX - minX, maxY - minY, 0.0005);
  const sc = Math.min((w - pad * 2), (h - pad * 2)) / span;
  const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
  const X = i => ox + (xs[i] - minX) * sc, Y = i => h - (oy + (ys[i] - minY) * sc);

  ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#3ddc84';
  ctx.beginPath();
  points.forEach((p, i) => { if (i === 0 || p.brk) ctx.moveTo(X(i), Y(i)); else ctx.lineTo(X(i), Y(i)); });
  ctx.stroke();
  const dot = (i, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(i), Y(i), 6, 0, 7); ctx.fill(); };
  dot(0, '#e9ecf1'); dot(points.length - 1, '#3ddc84');
}

// ---------- Persistência (recupera se o navegador fechar) ----------
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      points, distance, elapsedMs: currentElapsed(), splits, lastSplitMs, lastSplitDist, savedAt: Date.now()
    }));
  } catch (_) {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || Date.now() - s.savedAt > 6 * 3600 * 1000) return;
    if (!confirm(`Há uma corrida não finalizada (${fmtNum(s.distance / 1000, 2)} km). Continuar?`)) {
      localStorage.removeItem(SAVE_KEY); return;
    }
    ({ points, distance, elapsedMs, splits, lastSplitMs, lastSplitDist } = s);
    lastFix = points[points.length - 1] || null; segBreak = true;
    state = 'paused'; setButtons(); render(); renderSplits(); draw(); startGps();
  } catch (_) {}
}

// ---------- Wake lock ----------
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'running') keepAwake();
});

// ---------- Controles ----------
function setButtons() {
  $('btnStart').classList.toggle('hidden', state === 'running');
  $('btnStart').textContent = state === 'paused' ? 'CONTINUAR' : 'INICIAR';
  $('btnPause').classList.toggle('hidden', state !== 'running');
  $('btnStop').classList.toggle('hidden', state !== 'paused');
}

$('btnStart').onclick = () => {
  if (state === 'idle') {
    points = []; distance = 0; elapsedMs = 0; splits = []; lastSplitMs = 0; lastSplitDist = 0;
    lastFix = null; segBreak = false; steps = []; gpsSpeeds = []; kf.reset(); prevV = null;
    Object.assign(diag, { recv: 0, used: 0, why: '' });
    renderSplits(); enableMotion();
  } else segBreak = true;
  state = 'running'; runStart = Date.now();
  startGps(); keepAwake();
  clearInterval(tick); tick = setInterval(render, 500);
  setButtons(); render();
};

$('btnPause').onclick = () => {
  elapsedMs = currentElapsed(); state = 'paused';
  clearInterval(tick); render(); save(); setButtons();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
};

$('btnStop').onclick = () => {
  if (!confirm('Finalizar a corrida?')) return;
  state = 'idle';
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  setGps('', 'GPS desligado');
  localStorage.removeItem(SAVE_KEY);
  setButtons();
  finishRun({ distance, elapsed: elapsedMs, splits, points });
};

// Salva a corrida terminada e abre o resumo (usado pela versão web e pela nativa)
function finishRun(r) {
  if (document.body.classList.contains('mapfull')) toggleFull();
  const run = {
    id: Math.round(Date.now() - r.elapsed),        // início aproximado (ms) — também é a chave
    distance: r.distance, elapsed: r.elapsed, splits: r.splits,
    points: r.points.map(p => ({ lat: +(+p.lat).toFixed(6), lon: +(+p.lon).toFixed(6), t: Math.round(p.t), d: Math.round(p.d * 10) / 10, brk: p.brk || undefined }))
  };
  MapView.fit(r.points);
  if (r.distance < 50) { alert('Corrida muito curta (menos de 50 m) — não foi salva.'); return; }
  Store.saveRun(run)
    .then(() => { renderHistory(); openSummary(run); })
    .catch(() => alert('Não consegui salvar a corrida no aparelho.'));
};

// ---------- Mapa: centralizar / tela cheia ----------
function toggleFull() {
  const on = document.body.classList.toggle('mapfull');
  $('btnFull').textContent = on ? '✕' : '⛶';
  MapView.invalidate();
}
$('btnCenter').onclick = () => MapView.recenter();
$('btnFull').onclick = toggleFull;

// ---------- Abas ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== b.dataset.view));
  document.body.dataset.view = b.dataset.view;
  if (b.dataset.view === 'viewHistory') renderHistory(); else MapView.invalidate();
});

window.addEventListener('resize', draw);
if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
MapView.init($('map'));
draw(); render();
if (!NATIVE) restore();
// liga o GPS já ao abrir (se a permissão já foi dada) para o sinal estar firme ao iniciar
if (!NATIVE && navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startGps(); }).catch(() => {});
