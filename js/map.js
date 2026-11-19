'use strict';
// Mapa (Leaflet + OpenStreetMap, escurecido via CSS). Se o Leaflet não carregar (sem internet), MapView.ok = false
// e o tracker usa o desenho em canvas como reserva.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ROUTE_COLOR = '#a3c48a';

function makeMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, ...opts });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19, className: 'dark-tiles' }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}

// Quebra a lista de pontos em trechos (pausas viram buracos na linha)
function toSegments(points) {
  const segs = []; let cur = [];
  points.forEach((p, i) => {
    if (i > 0 && p.brk) { if (cur.length) segs.push(cur); cur = []; }
    cur.push([p.lat, p.lon]);
  });
  if (cur.length) segs.push(cur);
  return segs;
}

function kmIcon(n) {
  return L.divIcon({ className: 'km-mark', html: `<span>${n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
}

function drawRoute(map, points, splits, layer) {
  layer.clearLayers();
  if (!points.length) return;
  L.polyline(toSegments(points), { color: ROUTE_COLOR, weight: 5, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
  L.circleMarker([points[0].lat, points[0].lon], { radius: 6, color: '#131311', weight: 2, fillColor: '#eeece6', fillOpacity: 1 }).addTo(layer);
  (splits || []).forEach(s => { if (s.lat != null) L.marker([s.lat, s.lon], { icon: kmIcon(s.km), interactive: false }).addTo(layer); });
}

const MapView = {
  ok: typeof L !== 'undefined',
  map: null, route: null, me: null, meAcc: null, follow: true, lastKey: '',

  init(el) {
    if (!this.ok) return;
    this.map = makeMap(el);
    this.map.setView([-15.78, -47.93], 4);          // Brasil, até chegar a 1ª posição
    this.route = L.layerGroup().addTo(this.map);
    // arrastar o mapa = parar de seguir; ◎ volta a seguir
    this.map.on('dragstart', () => { this.follow = false; document.getElementById('btnCenter').classList.add('on'); });
  },

  setPosition(lat, lon, acc) {
    if (!this.map) return;
    const ll = [lat, lon];
    if (!this.me) {
      this.meAcc = L.circle(ll, { radius: acc, color: '#8fb7d9', weight: 1, fillColor: '#8fb7d9', fillOpacity: .12, interactive: false }).addTo(this.map);
      this.me = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#8fb7d9', fillOpacity: 1 }).addTo(this.map);
      this.map.setView(ll, 17);
    } else {
      this.me.setLatLng(ll); this.meAcc.setLatLng(ll).setRadius(acc);
      if (this.follow) this.map.panTo(ll, { animate: true, duration: .5 });
    }
  },

  update(points, splits) {
    if (!this.map) return;
    // redesenha só quando algo mudou (barato o suficiente para 1 leitura/s)
    const key = points.length + ':' + splits.length;
    if (key === this.lastKey) return;
    this.lastKey = key;
    drawRoute(this.map, points, splits, this.route);
  },

  recenter() {
    this.follow = true;
    document.getElementById('btnCenter').classList.remove('on');
    if (this.me) this.map.setView(this.me.getLatLng(), Math.max(this.map.getZoom(), 16));
  },

  fit(points) {
    if (!this.map || !points.length) return;
    this.follow = false;
    this.map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { padding: [24, 24] });
  },

  invalidate() { if (this.map) setTimeout(() => this.map.invalidateSize(), 60); }
};

// Mapa estático para o resumo / histórico (não interativo de propósito: rola a página normalmente)
function staticRouteMap(el, points, splits) {
  if (typeof L === 'undefined' || !points.length) { el.innerHTML = '<div class="empty" style="padding:16px">O mapa precisa de internet</div>'; return null; }
  const map = makeMap(el, { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
  const layer = L.layerGroup().addTo(map);
  drawRoute(map, points, splits, layer);
  const end = points[points.length - 1];
  L.circleMarker([end.lat, end.lon], { radius: 6, color: '#131311', weight: 2, fillColor: ROUTE_COLOR, fillOpacity: 1 }).addTo(layer);
  map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { padding: [20, 20] });
  setTimeout(() => { map.invalidateSize(); map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { padding: [20, 20] }); }, 80);
  return map;
}
