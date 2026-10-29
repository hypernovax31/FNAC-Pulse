/* Firebase Cloud Messaging + cache de l'application GitHub Pages. */
import { initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';
import { firebaseConfig } from './firebase-config';
const CACHE = 'fnac-pulse-shell-v12';
const APP_URL = new URL(self.registration.scope);
const APP_PATH = APP_URL.pathname;
const appAsset = path => new URL(path, APP_URL).pathname;
const SHELL = ['', 'manifest.webmanifest', 'icons/icon-192-v2.png', 'icons/icon-512-v2.png', 'icons/icon-maskable-512-v2.png', 'icons/apple-touch-icon-v2.png', 'icons/icon-192.png', 'fnac.svg'].map(appAsset);

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
// Handle clicks before Firebase's own listener so a sibling GitHub Pages site
// is never focused instead of Fnac Pulse.
self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation();
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const client=clients.find(c=>{const url=new URL(c.url);return url.origin===APP_URL.origin&&url.pathname.startsWith(APP_PATH);});
    return client?client.focus():self.clients.openWindow(APP_URL.href);
  }));
});
// The Firebase SDK displays notification payloads in the background itself;
// no second push handler is installed, avoiding duplicate notifications.
getMessaging(initializeApp(firebaseConfig));
