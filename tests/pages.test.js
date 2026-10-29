import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function serviceWorker(scope) {
  const handlers = new Map(), added = [], deleted = [], shown = [];
  const base = new URL(scope).pathname;
  const cache = {
    async addAll(urls) { added.push([...urls]); },
    async match(url) {
      if (url !== base) return undefined;
      return new Response(`<html><script src="${base}assets/app.js"></script><link href="${base}assets/app.css"/><script src="https://elsewhere.invalid/assets/other.js"></script></html>`);
    },
    async put() {},
  };
  const worker = {
    registration: { scope, async showNotification(title, options) { shown.push({title, options}); } },
    clients: { async claim() {}, async matchAll() {return [];}, async openWindow() {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    async skipWaiting() {},
  };
  const caches = {
    async open() { return cache; },
    async keys() { return ['fnac-pulse-shell-v3','fnac-pulse-shell-v4','fnac-pulse-shell-v5','fnac-pulse-shell-v6','fnac-pulse-shell-v7','fnac-pulse-shell-v8','fnac-pulse-shell-v9','fnac-pulse-shell-v10','fnac-pulse-shell-v11','fnac-pulse-shell-v12','another-application']; },
    async delete(key) { deleted.push(key); },
    async match() { return undefined; },
  };
  vm.runInNewContext(source,{self:worker,caches,URL,Response,Date,fetch});
  return { handlers, added, deleted, shown, base };
}
async function dispatch(handler, values = {}) {
  let promise;
  handler({...values, waitUntil(work) { promise = work; }});
  await promise;
}

for (const scope of ['https://example.test/', 'https://example.test/FNAC-Pulse/']) {
  test(`PWA : chemins et service worker dans ${new URL(scope).pathname}`, async () => {
    const base = new URL(scope).pathname;
    const manifestUrl = new URL('manifest.webmanifest',scope);
    assert.equal(new URL(manifest.start_url,manifestUrl).pathname,base);
    assert.equal(new URL(manifest.scope,manifestUrl).pathname,base);
    assert.equal(new URL(manifest.icons[0].src,manifestUrl).pathname,`${base}icons/icon-192-v2.png`);
    const sw = serviceWorker(scope);
    await dispatch(sw.handlers.get('install'));
    assert.deepEqual(Array.from(sw.added[0]), [base,`${base}manifest.webmanifest`,`${base}icons/icon-192-v2.png`,`${base}icons/icon-512-v2.png`,`${base}icons/icon-maskable-512-v2.png`,`${base}icons/apple-touch-icon-v2.png`,`${base}icons/icon-192.png`,`${base}fnac.svg`]);
    assert.deepEqual(Array.from(sw.added[1]), [`${base}assets/app.js`,`${base}assets/app.css`]);
    await dispatch(sw.handlers.get('activate'));
    assert.deepEqual(sw.deleted,['fnac-pulse-shell-v3','fnac-pulse-shell-v4','fnac-pulse-shell-v5','fnac-pulse-shell-v6','fnac-pulse-shell-v7','fnac-pulse-shell-v8','fnac-pulse-shell-v9','fnac-pulse-shell-v10','fnac-pulse-shell-v11']);
    await dispatch(sw.handlers.get('push'),{data:{json:()=>({title:'Test', url:'https://elsewhere.invalid/'})}});
    assert.equal(sw.shown[0].options.icon,`${base}icons/icon-192-v2.png`);
    assert.equal(sw.shown[0].options.data.url,scope);
  });
}


test('PWA : icônes versionnées, tailles, masque et compatibilité des anciennes notifications', () => {
  const iconDir = new URL('../public/icons/', import.meta.url);
  const dimensions = (name) => {
    const png=fs.readFileSync(new URL(name,iconDir));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    return [png.readUInt32BE(16),png.readUInt32BE(20)];
  };
  assert.deepEqual(dimensions('icon-192-v2.png'),[192,192]);
  assert.deepEqual(dimensions('icon-512-v2.png'),[512,512]);
  assert.deepEqual(dimensions('icon-maskable-512-v2.png'),[512,512]);
  assert.deepEqual(dimensions('apple-touch-icon-v2.png'),[180,180]);
  assert.equal(manifest.icons.find(icon=>icon.purpose==='maskable')?.src,'icons/icon-maskable-512-v2.png');
  assert.deepEqual(fs.readFileSync(new URL('icon-192.png',iconDir)),fs.readFileSync(new URL('icon-192-v2.png',iconDir)));
  assert.deepEqual(fs.readFileSync(new URL('icon-512.png',iconDir)),fs.readFileSync(new URL('icon-512-v2.png',iconDir)));
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/rel="icon"[^>]+icon-192-v2\.png/);
  assert.match(html,/rel="apple-touch-icon"[^>]+apple-touch-icon-v2\.png/);
  const cloudWorker=fs.readFileSync(new URL('../src/sw-cloud.js',import.meta.url),'utf8');
  assert.match(cloudWorker,/fnac-pulse-shell-v12/);
  for(const icon of manifest.icons)assert.ok(cloudWorker.includes(icon.src));
});
