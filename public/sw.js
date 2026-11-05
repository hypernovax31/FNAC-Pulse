/* Fnac Pulse: app shell and Web Push. Works at a domain root or under /FNAC-Pulse/.
   The backend remains necessary; sales are never queued offline. */
const CACHE = 'fnac-pulse-shell-v49';
const APP_URL = new URL(self.registration.scope);
const APP_PATH = APP_URL.pathname;
const appAsset = path => new URL(path, APP_URL).pathname;
const SHELL = ['', 'manifest.webmanifest', 'icons/icon-192-v3.png', 'icons/icon-512-v3.png', 'icons/icon-maskable-512-v3.png', 'icons/apple-touch-icon-v3.png', 'icons/icon-192.png', 'fnac.svg', 'FNAC - SIGNATURE.mp3'].map(appAsset);
// La requête versionnée contourne aussi le cache v43 encore installé.
SHELL.splice(1, 0, `${appAsset('auth-action-v1.js')}?v=2`);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // The first page load happens before the worker controls it. Cache the
    // built JS/CSS referenced by the HTML, including a GitHub Pages base path.
    const htmlResponse = await cache.match(APP_PATH);
    if (htmlResponse) {
      const html = await htmlResponse.text();
      const assets = [...html.matchAll(/(?:src|href)="([^"?#]+)"/g)]
        .map(match => new URL(match[1], APP_URL))
        .filter(url => url.origin === APP_URL.origin && url.pathname.startsWith(appAsset('assets/')))
        .map(url => url.pathname);
      if (assets.length) await cache.addAll([...new Set(assets)]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('fnac-pulse-shell-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== APP_URL.origin || !url.pathname.startsWith(APP_PATH) || url.pathname.startsWith(appAsset('api/'))) return;
  // Ne jamais mettre en cache l'URL d'un lien secret. Hors ligne, la copie
  // générique de la page peut toutefois afficher une erreur explicite.
  if (request.mode === 'navigate' && url.searchParams.has('oobCode')) {
    event.respondWith(fetch(request, {cache:'no-store'}).catch(() => caches.open(CACHE).then(cache => cache.match(APP_PATH))));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(APP_PATH, response.clone()));
      return response;
    }).catch(() => caches.match(APP_PATH)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && url.pathname.startsWith(appAsset('assets/'))) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() }; }
  let target = APP_URL.href;
  try {
    const candidate = new URL(payload.url || '.', APP_URL);
    if (candidate.origin === APP_URL.origin && candidate.pathname.startsWith(APP_PATH)) target = candidate.href;
  } catch {}
  event.waitUntil((async () => {
    let visible = false;
    try {
      const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
      visible = clients.some(client => {
        try { const url = new URL(client.url); return client.visibilityState === 'visible' && url.origin === APP_URL.origin && url.pathname.startsWith(APP_PATH); }
        catch { return false; }
      });
    } catch {} // Si l'état du client est inconnu, conserver l'alerte système normale.
    await self.registration.showNotification(payload.title || 'Fnac Pulse', {
      body: payload.body || 'Une nouvelle vente vient d’être enregistrée.',
      icon: appAsset('icons/icon-192-v3.png'),
      badge: appAsset('icons/icon-192-v3.png'),
      tag: payload.tag || `sale-${Date.now()}`,
      // Au premier plan, l'application joue le MP3 : éviter un second son.
      // En arrière-plan, laisser le système choisir son son et sa vibration.
      ...(visible ? {silent:true} : {vibrate:[70,70,70,70,70]}),
      data: { url: target },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const client = clients.find(c => {
      const url = new URL(c.url);
      return url.origin === APP_URL.origin && url.pathname.startsWith(APP_PATH);
    });
    if (client) return client.focus();
    return self.clients.openWindow(event.notification.data?.url || APP_URL.href);
  }));
});
