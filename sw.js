// Guarda só o app e o Leaflet; os quadradinhos do mapa NÃO (encheriam o celular).
const CACHE = 'passada-v4';
const FILES = ['./', 'index.html', 'manifest.json', 'icon.svg', 'css/app.css?v=3',
  'js/map.js?v=3', 'js/store.js?v=3', 'js/history.js?v=3', 'js/tracker.js?v=4', 'js/native.js?v=4',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mine = url.origin === location.origin || url.href.startsWith('https://unpkg.com/leaflet@1.9.4/');
  if (e.request.method !== 'GET' || !mine) return;            // mapa e demais: direto da rede
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
