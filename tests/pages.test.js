import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function serviceWorker(scope, windows = [], fetchImpl = fetch) {
  const handlers = new Map(), added = [], deleted = [], shown = [], stored = [];
  const base = new URL(scope).pathname;
  const cache = {
    async addAll(urls) { added.push([...urls]); },
    async match(url) {
      if (url !== base) return undefined;
      return new Response(`<html><script src="${base}assets/app.js"></script><link href="${base}assets/app.css"/><script src="https://elsewhere.invalid/assets/other.js"></script></html>`);
    },
    async put(...args) { stored.push(args); },
  };
  const worker = {
    registration: { scope, async showNotification(title, options) { shown.push({title, options}); } },
    clients: { async claim() {}, async matchAll() {return windows;}, async openWindow() {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    async skipWaiting() {},
  };
  const caches = {
    async open() { return cache; },
    async keys() { return ['fnac-pulse-shell-v3','fnac-pulse-shell-v4','fnac-pulse-shell-v5','fnac-pulse-shell-v6','fnac-pulse-shell-v7','fnac-pulse-shell-v8','fnac-pulse-shell-v9','fnac-pulse-shell-v10','fnac-pulse-shell-v11','fnac-pulse-shell-v12','fnac-pulse-shell-v13','fnac-pulse-shell-v14','fnac-pulse-shell-v15','fnac-pulse-shell-v16','fnac-pulse-shell-v17','fnac-pulse-shell-v18','fnac-pulse-shell-v19','fnac-pulse-shell-v20','fnac-pulse-shell-v21','fnac-pulse-shell-v22','fnac-pulse-shell-v23','fnac-pulse-shell-v24','fnac-pulse-shell-v25','fnac-pulse-shell-v34','fnac-pulse-shell-v35','fnac-pulse-shell-v36','fnac-pulse-shell-v37','fnac-pulse-shell-v38','fnac-pulse-shell-v39','fnac-pulse-shell-v40','fnac-pulse-shell-v41','fnac-pulse-shell-v42','fnac-pulse-shell-v43','fnac-pulse-shell-v44','fnac-pulse-shell-v45','fnac-pulse-shell-v46','fnac-pulse-shell-v47','fnac-pulse-shell-v48','fnac-pulse-shell-v49','fnac-pulse-shell-v50','fnac-pulse-shell-v51','fnac-pulse-shell-v52','fnac-pulse-shell-v53','fnac-pulse-shell-v54','another-application']; },
    async delete(key) { deleted.push(key); },
    async match() { return undefined; },
  };
  vm.runInNewContext(source,{self:worker,caches,URL,Response,Date,fetch:fetchImpl});
  return { handlers, added, deleted, shown, stored, base };
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
    assert.equal(new URL(manifest.icons[0].src,manifestUrl).pathname,`${base}icons/icon-192-v3.png`);
    const network=[];
    const sw = serviceWorker(scope,[],async(request,options)=>{network.push({request,options});return new Response('réseau');});
    await dispatch(sw.handlers.get('install'));
    assert.deepEqual(Array.from(sw.added[0]), [base,`${base}auth-action-v1.js?v=4`,`${base}manifest.webmanifest`,`${base}icons/icon-192-v3.png`,`${base}icons/icon-512-v3.png`,`${base}icons/icon-maskable-512-v3.png`,`${base}icons/apple-touch-icon-v3.png`,`${base}icons/icon-192.png`,`${base}fnac.svg`,`${base}FNAC%20-%20SIGNATURE.mp3`]);
    assert.deepEqual(Array.from(sw.added[1]), [`${base}assets/app.js`,`${base}assets/app.css`]);
    let response;
    const secretRequest={method:'GET',url:`${scope}?mode=resetPassword&oobCode=code-fictif`,mode:'navigate'};
    sw.handlers.get('fetch')({request:secretRequest,respondWith(work){response=work;}});
    assert.equal(await (await response).text(),'réseau');
    assert.equal(network[0].options.cache,'no-store');
    assert.equal(sw.stored.length,0,'un lien secret ne doit pas être stocké');
    const nestedRequest={method:'GET',url:`${scope}?link=${encodeURIComponent('https://example.test/__/auth/action?mode=signIn&oobCode=code-fictif')}`,mode:'navigate'};
    sw.handlers.get('fetch')({request:nestedRequest,respondWith(work){response=work;}});
    assert.equal(await (await response).text(),'réseau');assert.equal(network.at(-1).options.cache,'no-store');
    assert.equal(sw.stored.length,0,'une enveloppe de lien secret ne doit pas être stockée');
    const offline=serviceWorker(scope,[],async()=>{throw new TypeError('hors ligne');});
    offline.handlers.get('fetch')({request:secretRequest,respondWith(work){response=work;}});
    assert.match(await (await response).text(),/assets\/app\.js/);
    assert.equal(offline.stored.length,0,'hors ligne, seule la page générique est lue');
    await dispatch(sw.handlers.get('activate'));
    assert.deepEqual(sw.deleted,['fnac-pulse-shell-v3','fnac-pulse-shell-v4','fnac-pulse-shell-v5','fnac-pulse-shell-v6','fnac-pulse-shell-v7','fnac-pulse-shell-v8','fnac-pulse-shell-v9','fnac-pulse-shell-v10','fnac-pulse-shell-v11','fnac-pulse-shell-v12','fnac-pulse-shell-v13','fnac-pulse-shell-v14','fnac-pulse-shell-v15','fnac-pulse-shell-v16','fnac-pulse-shell-v17','fnac-pulse-shell-v18','fnac-pulse-shell-v19','fnac-pulse-shell-v20','fnac-pulse-shell-v21','fnac-pulse-shell-v22','fnac-pulse-shell-v23','fnac-pulse-shell-v24','fnac-pulse-shell-v25','fnac-pulse-shell-v34','fnac-pulse-shell-v35','fnac-pulse-shell-v36','fnac-pulse-shell-v37','fnac-pulse-shell-v38','fnac-pulse-shell-v39','fnac-pulse-shell-v40','fnac-pulse-shell-v41','fnac-pulse-shell-v42','fnac-pulse-shell-v43','fnac-pulse-shell-v44','fnac-pulse-shell-v45','fnac-pulse-shell-v46','fnac-pulse-shell-v47','fnac-pulse-shell-v48','fnac-pulse-shell-v49','fnac-pulse-shell-v50','fnac-pulse-shell-v51','fnac-pulse-shell-v52','fnac-pulse-shell-v53']);
    await dispatch(sw.handlers.get('push'),{data:{json:()=>({title:'Test', url:'https://elsewhere.invalid/'})}});
    assert.equal(sw.shown[0].options.icon,`${base}icons/icon-192-v3.png`);
    assert.deepEqual(Array.from(sw.shown[0].options.vibrate),[70,70,70,70,70]);
    assert.equal(sw.shown[0].options.silent,undefined);
    assert.equal(sw.shown[0].options.data.url,scope);
  });
}


test('Push local : silencieux au premier plan pour éviter un double son, système normal sinon',async()=>{
  const scope='https://example.test/FNAC-Pulse/',windows=[],sw=serviceWorker(scope,windows);
  const push=()=>dispatch(sw.handlers.get('push'),{data:{json:()=>({title:'Test',tag:'sale-fictive'})}});
  windows.push({url:scope,visibilityState:'visible'});await push();
  assert.equal(sw.shown.at(-1).options.silent,true);assert.equal(sw.shown.at(-1).options.vibrate,undefined);
  windows[0].visibilityState='hidden';await push();
  assert.equal(sw.shown.at(-1).options.silent,undefined);assert.deepEqual(Array.from(sw.shown.at(-1).options.vibrate),[70,70,70,70,70]);
  windows[0]={url:'https://example.test/autre-site/',visibilityState:'visible'};await push();
  assert.equal(sw.shown.at(-1).options.silent,undefined);
  windows[0]={url:'https://elsewhere.test/FNAC-Pulse/',visibilityState:'visible'};await push();
  assert.equal(sw.shown.at(-1).options.silent,undefined);
});

test('PWA : icônes versionnées, tailles, masque et compatibilité des anciennes notifications', () => {
  const iconDir = new URL('../public/icons/', import.meta.url);
  const dimensions = (name) => {
    const png=fs.readFileSync(new URL(name,iconDir));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    return [png.readUInt32BE(16),png.readUInt32BE(20)];
  };
  assert.deepEqual(dimensions('icon-192-v3.png'),[192,192]);
  assert.deepEqual(dimensions('icon-512-v3.png'),[512,512]);
  assert.deepEqual(dimensions('icon-maskable-512-v3.png'),[512,512]);
  assert.deepEqual(dimensions('apple-touch-icon-v3.png'),[180,180]);
  assert.deepEqual(dimensions('icon-192-v2.png'),[192,192]); // anciennes installations
  const approved=fs.readFileSync(new URL('../artwork/fnac-pulse-approved.png',import.meta.url));
  assert.deepEqual([approved.readUInt32BE(16),approved.readUInt32BE(20)],[1254,1254]);
  assert.equal(manifest.icons.find(icon=>icon.purpose==='maskable')?.src,'icons/icon-maskable-512-v3.png');
  assert.deepEqual(fs.readFileSync(new URL('icon-192.png',iconDir)),fs.readFileSync(new URL('icon-192-v3.png',iconDir)));
  assert.deepEqual(fs.readFileSync(new URL('icon-512.png',iconDir)),fs.readFileSync(new URL('icon-512-v3.png',iconDir)));
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/rel="icon"[^>]+icon-192-v3\.png/);
  assert.match(html,/rel="apple-touch-icon"[^>]+apple-touch-icon-v3\.png/);
  const cloudWorker=fs.readFileSync(new URL('../src/sw-cloud.js',import.meta.url),'utf8');
  assert.match(source,/fnac-pulse-shell-v54/);
  assert.match(cloudWorker,/fnac-pulse-shell-v54/);
  assert.match(cloudWorker,/request\.mode === 'navigate' && \(url\.searchParams\.has\('oobCode'\) \|\| url\.searchParams\.has\('link'\)\)/);
  for(const icon of manifest.icons)assert.ok(cloudWorker.includes(icon.src));
});
