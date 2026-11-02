import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

// Utiliser le véritable SDK Firebase embarqué, sans réseau ni appareil réel.
// Cela vérifie que le message d'arrière-plan conserve les options Web Push et
// qu'un second gestionnaire de notification n'a pas été ajouté par erreur.
test('Service worker cloud : une notification par push, motif FCM transmis au système',async()=>{
  const result=await build({entryPoints:['src/sw-cloud.js'],bundle:true,format:'iife',platform:'browser',target:'es2020',write:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}});
  const handlers=new Map(),shown=[],scope='https://example.test/FNAC-Pulse/';let networkCalls=0;
  const noNetwork=async()=>{networkCalls++;throw Error('Réseau interdit dans ce test');};
  const worker={
    location:new URL(`${scope}sw.js`),
    registration:{scope,async showNotification(title,options){shown.push({title,options});}},
    clients:{async matchAll(){return [];},async claim(){},async openWindow(){}},
    addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);},
    async skipWaiting(){},
  };
  const caches={async open(){return {async addAll(){},async match(){return undefined;}};},async keys(){return [];},async delete(){},async match(){}};
  const Notification=function(){};
  class ServiceWorkerRegistration {showNotification(){}}
  class PushSubscription {getKey(){}}
  const indexedDB={open(){const request={result:{close(){}}};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;},deleteDatabase(){}};
  Object.assign(worker,{indexedDB,Notification,PushManager:function(){}});
  vm.runInNewContext(result.outputFiles[0].text,{
    self:worker,caches,URL,Response,Date,fetch:noNetwork,Notification,ServiceWorkerRegistration,PushSubscription,indexedDB,
    setTimeout,clearTimeout,TextEncoder,TextDecoder,crypto:globalThis.crypto,
    // Le faux IndexedDB ne sert qu'au test de compatibilité du SDK ; son suivi
    // de télémétrie optionnel n'est ni exercé ni envoyé sur le réseau.
    console:{log(){},warn(){},error(){}},
  });
  assert.equal(handlers.get('push')?.length,1);
  for(const id of ['vente-fictive-1','vente-fictive-2']){
    const payload={notification:{title:'Fnac Pulse',body:'1 DMax fait par Morgan 👍',tag:`sale-${id}`,vibrate:[70,70,70,70,70]},data:{saleId:id}};
    const work=[];
    for(const handler of handlers.get('push'))handler({data:{json:()=>payload},waitUntil(promise){work.push(promise);}});
    await Promise.all(work);
  }
  assert.equal(shown.length,2);assert.equal(networkCalls,0);
  assert.deepEqual(shown.map(x=>x.options.tag),['sale-vente-fictive-1','sale-vente-fictive-2']);
  for(const notification of shown){
    assert.deepEqual(Array.from(notification.options.vibrate),[70,70,70,70,70]);
    assert.equal(notification.options.silent,undefined);
    assert.equal(notification.options.body,'1 DMax fait par Morgan 👍');
  }
});
