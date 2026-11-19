'use strict';
// Mapa (Leaflet + OpenStreetMap, escurecido via CSS). Se o Leaflet não carregar (sem internet), MapView.ok = false
// e o tracker usa o desenho em canvas como reserva.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ROUTE_COLOR = '#3fc45f';        // verde do trajeto (forte, lê bem sobre o mapa)
const ROUTE_CASE = 'rgba(10,12,10,.55)'; // contorno escuro fino que destaca o traço

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
  const segs = toSegments(points);
  L.polyline(segs, { color: ROUTE_CASE, weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5, interactive: false }).addTo(layer);
  L.polyline(segs, { color: ROUTE_COLOR, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5, interactive: false }).addTo(layer);
  L.circleMarker([points[0].lat, points[0].lon], { radius: 7, color: ROUTE_COLOR, weight: 3, fillColor: '#ffffff', fillOpacity: 1 }).addTo(layer);
  (splits || []).forEach(s => { if (s.lat != null) L.marker([s.lat, s.lon], { icon: kmIcon(s.km), interactive: false }).addTo(layer); });
}

const MapView = {
  ok: typeof L !== 'undefined',
  map: null, route: null, me: null, meAcc: null, follow: true, lastKey: '', lastLL: null, heading: null, flying: false,

  init(el) {
    if (!this.ok) return;
    this.map = makeMap(el);
    this.map.setView([-15.78, -47.93], 4);          // Brasil, até chegar a 1ª posição
    this.route = L.layerGroup().addTo(this.map);
    // arrastar o mapa = parar de seguir; ◎ volta a seguir
    this.map.on('dragstart', () => { this.follow = false; document.getElementById('btnCenter').classList.add('on'); });
    this.map.on('moveend', () => { this.flying = false; });
  },

  // Onde a pessoa deve aparecer: no meio da área livre entre o topo e a folha de baixo
  offsetY() {
    const el = this.map.getContainer(), h = el.clientHeight;
    const sheet = document.getElementById('sheet');
    const bottom = sheet && sheet.offsetParent ? sheet.getBoundingClientRect().top - el.getBoundingClientRect().top : h;
    const target = (64 + Math.max(120, bottom)) / 2;
    return h / 2 - target;                            // px que o centro desce para o ponto subir
  },
  centerFor(ll, zoom) {
    const z = zoom == null ? this.map.getZoom() : zoom;
    return this.map.unproject(this.map.project(L.latLng(ll), z).add([0, this.offsetY()]), z);
  },

  setPosition(lat, lon, acc, heading) {
    if (!this.map) return;
    const ll = L.latLng(lat, lon);
    // direção: do GPS quando confiável; senão, pelo deslocamento desde a última posição
    if (heading != null && isFinite(heading)) this.heading = heading;
    else if (this.lastLL && this.lastLL.distanceTo(ll) > 4) {
      const y = Math.sin((lon - this.lastLL.lng) * Math.PI / 180) * Math.cos(lat * Math.PI / 180);
      const x = Math.cos(this.lastLL.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
        Math.sin(this.lastLL.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos((lon - this.lastLL.lng) * Math.PI / 180);
      this.heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    if (!this.lastLL || this.lastLL.distanceTo(ll) > 4) this.lastLL = ll;

    if (!this.me) {
      this.meAcc = L.circle(ll, { radius: acc, color: '#8fb7d9', weight: 1, fillColor: '#8fb7d9', fillOpacity: .1, interactive: false }).addTo(this.map);
      this.me = L.marker(ll, { interactive: false, zIndexOffset: 1000, icon: L.divIcon({
        className: '', iconSize: [44, 44], iconAnchor: [22, 22],
        html: '<div class="me"><span class="ring"></span><span class="arrow"></span><span class="dot"></span></div>' }) }).addTo(this.map);
      this.map.flyTo(this.centerFor(ll, 16), 16, { duration: 1.4 });   // bairro, ao abrir
    } else {
      this.me.setLatLng(ll); this.meAcc.setLatLng(ll).setRadius(acc);
      if (this.follow && !this.flying) this.map.panTo(this.centerFor(ll), { animate: true, duration: .8, easeLinearity: .5 });
    }
    const el = this.me.getElement() && this.me.getElement().querySelector('.me');
    if (el) {
      el.classList.toggle('dir', this.heading != null);
      if (this.heading != null) el.querySelector('.arrow').style.transform = `rotate(${this.heading}deg)`;
    }
  },

  // Ao começar: voo até a rua (zoom 18) e passa a seguir
  flyToStreet() {
    if (!this.map) return;
    this.follow = true; this.flying = true;
    document.getElementById('btnCenter').classList.remove('on');
    const ll = this.me ? this.me.getLatLng() : this.map.getCenter();
    setTimeout(() => this.map.flyTo(this.centerFor(ll, 18), 18, { duration: 1.3, easeLinearity: .2 }), 60);
  },

  update(points, splits) {
    if (!this.map) return;
    // redesenha só quando algo mudou (barato o suficiente para 1 leitura/s)
    const key = points.length + ':' + splits.length;
    if (key === this.lastKey) return;
    this.lastKey = key;
    drawRoute(this.map, points, splits, this.route);
  },

  clearRoute() { if (this.route) { this.route.clearLayers(); this.lastKey = ''; } },

  recenter() {
    this.follow = true; this.flying = true;
    document.getElementById('btnCenter').classList.remove('on');
    if (this.me) { const z = Math.max(this.map.getZoom(), 16); this.map.flyTo(this.centerFor(this.me.getLatLng(), z), z, { duration: .8 }); }
  },

  // Ao encerrar: afasta para mostrar o trajeto inteiro
  fit(points) {
    if (!this.map || !points.length) return;
    this.follow = false;
    this.map.flyToBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { paddingTopLeft: [30, 80], paddingBottomRight: [30, 280], duration: 1.2 });
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
  L.circleMarker([end.lat, end.lon], { radius: 7, color: '#ffffff', weight: 3, fillColor: ROUTE_COLOR, fillOpacity: 1 }).addTo(layer);
  map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { padding: [20, 20] });
  setTimeout(() => { map.invalidateSize(); map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon])), { padding: [20, 20] }); }, 80);
  return map;
}
