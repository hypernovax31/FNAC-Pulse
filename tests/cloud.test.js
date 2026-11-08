import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.js';
import {digestBase64,pinMac} from '../worker/firebase.js';
import {pinProof} from '../src/pin.js';
import {summarize,periodStarts,earliestDate,parisToday} from '../src/cloud-stats.js';
import {saleAdditionFingerprintInput,saleCorrectionFingerprintInput} from '../src/sale-history.js';
import {LEGACY_STORE_ID,sellersForStore,orderServices} from '../src/catalog.js';
import {createSaleAnnouncer} from '../src/live-sales.js';
import legacyLocations from '../server/locations.json' with {type:'json'};
import directorySnapshot from '../server/fnac-directory.json' with {type:'json'};

class MemoryDb {
  docs=new Map();n=0;
  async get(path){const d=this.docs.get(path);return d?structuredClone(d):null;}
  async getMany(paths){return Promise.all(paths.map(path=>this.get(path)));}
  write(path,data,currentDocument){return {path,data:structuredClone(data),currentDocument};}
  delete(path,currentDocument){return {path,del:true,currentDocument};}
  verify(path,currentDocument){return {path,check:true,currentDocument};}
  async commit(writes){
    for(const w of writes){const old=this.docs.get(w.path),c=w.currentDocument;
      if((c?.exists===false&&old)||(c?.exists===true&&!old)||(c?.updateTime&&old?.updateTime!==c.updateTime)) {const e=new Error('conflict');e.status=409;throw e;}}
    for(const w of writes){if(w.check)continue;if(w.del)this.docs.delete(w.path);else this.docs.set(w.path,{id:w.path.split('/').pop(),name:w.path,data:structuredClone(w.data),updateTime:String(++this.n)});}
  }
  async query(path,field,op,value,limit=1000){return [...this.docs].filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(([,v])=>structuredClone(v)).filter(x=>!field||(op==='EQUAL'?x.data[field]===value:x.data[field]>=value)).slice(0,limit);}
  async page(path,{field,op='EQUAL',value,limit=20,after=''}={}) {
    return [...this.docs].filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/'))
      .map(([,v])=>structuredClone(v)).filter(x=>(!field||(op==='EQUAL'?x.data[field]===value:op==='IN'?value.includes(x.data[field]):x.data[field]>=value))&&x.id>after)
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(0,limit);
  }
  async salesPeriodPage(path,{start,end,limit=200,afterDate='',afterId=''}={}) {
    return [...this.docs].filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/'))
      .map(([,v])=>structuredClone(v)).filter(x=>typeof x.data.businessDate==='string'&&x.data.businessDate>=start&&x.data.businessDate<=end&&
        (!afterDate||x.data.businessDate<afterDate||(x.data.businessDate===afterDate&&x.id<afterId)))
      .sort((a,b)=>b.data.businessDate.localeCompare(a.data.businessDate)||b.id.localeCompare(a.id)).slice(0,limit);
  }
}
function makeMessage(body){return {body,acked:false,retried:false,ack(){this.acked=true},retry(){this.retried=true}};}
async function activateSeller(req,storeId,sellerId,newProof,adminToken) {
  const status=await req('/api/auth/status','POST',{storeId,sellerId});assert.equal(status.status,200);
  if(!status.body.needsPin){const reset=await req('/api/admin/pin-reset','POST',{storeId,sellerId},adminToken);assert.equal(reset.status,200);}
  const result=await req('/api/auth/claim','POST',{storeId,sellerId,newProof});
  assert.equal(result.status,200);return result;
}

test('Cloud : PIN, isolation, corrections, administration et notifications en file',async()=>{
  const db=new MemoryDb(), sent=[], queued=[], identities=new Map(), waits=[];
  const worker=createWorker({
    createDb:()=>db,
    verifyIdToken:async(_env,token)=>{const x=identities.get(token);if(!x)throw Error('invalid');return x;},
    makeCustomToken:async(_env,sub,claims)=>{identities.set('seller-token',{sub,...claims});return 'custom-test-token';},
    sendFcm:async(_env,token,sale)=>sent.push({token,sale}),
  });
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'admin-uid',ALLOWED_ORIGIN:'https://example.test',APP_URL:'https://example.test/FNAC-Pulse/',
    PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}},
    PULSE_QUEUE:{async sendBatch(messages){queued.push(...messages.map(x=>x.body));}}};
  identities.set('admin-token',{sub:'admin-uid'});
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token,origin) {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{}) ,...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  assert.equal((await req('/api/bootstrap','GET',undefined,undefined,'https://evil.test')).status,403);
  const base=(await req('/api/bootstrap')).body;
  assert.equal(base.sellers.length,12);assert.equal(base.services.length,11);
  const store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  assert.equal(sellersForStore(base.sellers,store).length,12);assert.equal(sellersForStore(base.sellers,other).length,0);
  assert.deepEqual(base.sellers.map(x=>x.name),[...base.sellers].sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'})).map(x=>x.name));
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId:other,sellerId:1},'admin-token')).status,400);
  assert.equal((await req('/api/admin/entities/sellers','POST',{name:'Morgan',storeId:other},'admin-token')).status,200);
  assert.equal((await req('/api/admin/entities/sellers','POST',{name:'morgan',storeId:other},'admin-token')).status,409);
  assert.equal((await req('/api/admin/entities/sellers','POST',{name:'Nouveau'},'admin-token')).status,400);
  const orderedIds=base.services.map(x=>x.id);[orderedIds[0],orderedIds[4]]=[orderedIds[4],orderedIds[0]];
  assert.equal((await req('/api/admin/services/order','POST',{storeId:store,serviceIds:orderedIds})).status,401);
  assert.equal((await req('/api/admin/services/order','POST',{storeId:store,serviceIds:orderedIds.slice(1)},'admin-token')).status,400);
  assert.equal((await req('/api/admin/services/order','POST',{storeId:store,serviceIds:orderedIds},'admin-token')).status,200);
  assert.equal((await req(`/api/bootstrap?storeId=${store}`)).body.services[0].id,5);
  assert.equal((await req(`/api/bootstrap?storeId=${other}`)).body.services[0].id,1);
  assert.equal((await req(`/api/admin/counts?storeId=${other}&sellerId=1`,'GET',undefined,'admin-token')).status,400);
  const proof=await pinProof('demo-fnac',store,1,'73628519');
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId:store,sellerId:1})).status,401);
  assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:1,proof},'admin-token')).status,404);
  await activateSeller(req,store,1,proof,'admin-token');
  assert.equal((await req('/api/auth/login','POST',{storeId:other,sellerId:1,proof})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof})).body.customToken,'custom-test-token');
  const claims=identities.get('seller-token');assert.equal(claims.storeId,store);
  const token='a-very-long-firebase-registration-token-01',peerToken='a-valid-colleague-notification-token-02';
  assert.equal((await req('/api/push/subscribe','POST',{token},'seller-token')).status,200);
  await db.commit([db.write('pulseAccess/fixture-peer',{active:true,storeId:store,sellerId:2,version:'peer-v1'}),
    db.write(`pulseTokens/${await digestBase64(peerToken)}`,{token:peerToken,uid:'fixture-peer',storeId:store,accessVersion:'peer-v1'})]);
  const requestId='test-sale-00000001',originTokenId=await digestBase64(token);
  let r=await req('/api/sales','POST',{storeId:other,sellerId:12,serviceId:1,requestId,clientId:'one',originTokenId},'seller-token');
  assert.equal(r.status,200);assert.equal(r.body.id,requestId);
  await Promise.all(waits.splice(0));assert.equal(queued.length,1);
  const created=await db.get(`pulseStores/${store}/sales/${requestId}`);assert.equal(created.data.storeId,store);assert.equal(created.data.sellerId,1);
  assert.equal(created.data.originTokenId,undefined);assert.equal((await db.get(`pulseOutbox/${requestId}`)).data.originTokenId,originTokenId);
  assert.equal(queued[0].tokenId,await digestBase64(peerToken));
  assert.equal(await db.get(`pulseStores/${other}/sales/${requestId}`),null);
  r=await req('/api/sales','POST',{serviceId:1,requestId},'seller-token');assert.equal(r.body.duplicate,true);await Promise.all(waits.splice(0));assert.equal(queued.length,1);
  const message=makeMessage(queued[0]);await worker.queue({messages:[message]},env);assert.equal(message.acked,true);assert.equal(sent.length,1);
  assert.equal(sent[0].token,peerToken);assert.equal(sent[0].sale.sellerName,'Morgan');assert.equal(sent[0].sale.serviceName,'DMax');
  const same=makeMessage(queued[0]);await worker.queue({messages:[same]},env);assert.equal(same.acked,true);assert.equal(sent.length,1);
  assert.equal((await req('/api/sales/test-sale-00000001','DELETE',{},'seller-token')).status,200);
  assert.equal((await req('/api/sales/test-sale-00000001','DELETE',{},'seller-token')).status,409);
  assert.equal((await req('/api/admin/adjust','POST',{storeId:store,sellerId:1,serviceId:1,count:3},'admin-token')).status,200);
  const counts=(await req(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,'admin-token')).body;
  assert.equal(counts.counts[0].count,3);
  assert.equal((await req('/api/sales/remove','POST',{serviceId:1},'seller-token')).status,200);
  assert.equal((await req('/api/admin/adjust','POST',{storeId:store,sellerId:1,serviceId:1,count:0},'admin-token')).status,200);
  assert.equal((await req(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,'admin-token')).body.counts.length,0);
  const newProof=await pinProof('demo-fnac',store,1,'59386271');
  const reset=await req('/api/admin/pin-reset','POST',{storeId:store,sellerId:1},'admin-token');assert.equal(reset.status,200);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'test-sale-00000002'},'seller-token')).status,403);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof,openPinFlow:true})).status,401);
  assert.equal((await req('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof})).status,200);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof})).status,200);
  assert.equal((await req('/api/admin/entities/sellers/1','PATCH',{active:false},'admin-token')).status,200);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'test-sale-00000003'},'seller-token')).status,403);
});

test('Notifications : auteur exclu sur tous appareils, anciens messages et changement de profil',async()=>{
  const db=new MemoryDb(),queued=[],sent=[],waits=[],store=LEGACY_STORE_ID;
  const claims={role:'seller',sub:'author',storeId:store,sellerId:1,accessVersion:'v1'};
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>claims,sendFcm:async(_env,token)=>sent.push(token)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',PULSE_QUEUE:{async sendBatch(messages){queued.push(...messages.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  const base=await (await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx)).json();
  const other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const catalog=(await db.get('pulse/catalog')).data;
  catalog.sellers.find(s=>s.id===3).departmentId='editorial';
  catalog.sellers.find(s=>s.id===4).storeId=other;catalog.sellerStores.s4=other;
  await db.commit([db.write('pulse/catalog',catalog),
    db.write('pulseAccess/author',{active:true,storeId:store,sellerId:1,version:'v1'}),
    db.write('pulseAccess/peer',{active:true,storeId:store,sellerId:2,version:'v2'}),
    db.write('pulseAccess/editorial',{active:true,storeId:store,sellerId:3,version:'v3'}),
    db.write('pulseAccess/other',{active:true,storeId:other,sellerId:4,version:'v4'})]);
  const tokens={phone:'notification-token-author-phone-123456',tablet:'notification-token-author-tablet-123456',peer1:'notification-token-peer-phone-123456',peer2:'notification-token-peer-tablet-123456',editorial:'notification-token-editorial-123456',other:'notification-token-other-store-123456'};
  const ids=Object.fromEntries(await Promise.all(Object.entries(tokens).map(async([k,v])=>[k,await digestBase64(v)])));
  for(const [key,uid,version,targetStore] of [['phone','author','v1',store],['tablet','author','v1',store],['peer1','peer','v2',store],['peer2','peer','v2',store],['editorial','editorial','v3',store],['other','other','v4',other]])
    await db.commit([db.write(`pulseTokens/${ids[key]}`,{token:tokens[key],uid,storeId:targetStore,accessVersion:version})]);
  async function add(requestId,originTokenId) {
    const request=new Request('https://worker.test/api/sales',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer author'},body:JSON.stringify({serviceId:1,requestId,clientId:'phone',originTokenId})});
    const res=await worker.fetch(request,env,ctx);assert.equal(res.status,200);await Promise.all(waits.splice(0));
  }
  const saleId='notify-author-00001';await add(saleId,ids.phone);
  assert.deepEqual(queued.map(m=>m.tokenId).sort(),[ids.peer1,ids.peer2].sort());
  const consume=async body=>{const m=makeMessage(body);await worker.queue({messages:[m]},env);assert(m.acked);return m;};
  // Un ancien message déjà en file pour un autre appareil de l'auteur est ignoré.
  await consume({saleId,tokenId:ids.tablet,storeId:store});assert.deepEqual(sent,[]);
  await consume(queued.find(m=>m.tokenId===ids.peer1));assert.deepEqual(sent,[tokens.peer1]);
  // Un appareil destiné au collègue a changé de profil et appartient désormais à l'auteur.
  await db.commit([db.write(`pulseTokens/${ids.peer2}`,{token:tokens.peer2,uid:'author',storeId:store,accessVersion:'v1'})]);
  await consume(queued.find(m=>m.tokenId===ids.peer2));assert.deepEqual(sent,[tokens.peer1]);
  // L'appareil qui a saisi la vente est confié à un collègue avant réception.
  await db.commit([db.write(`pulseTokens/${ids.phone}`,{token:tokens.phone,uid:'peer',storeId:store,accessVersion:'v2'})]);
  await consume({saleId,tokenId:ids.phone,storeId:store});assert.deepEqual(sent,[tokens.peer1]);
  // Impossible d'exclure le téléphone d'un collègue en forgeant son empreinte.
  queued.length=0;await add('notify-forged-0001',ids.peer1);
  assert.equal((await db.get('pulseOutbox/notify-forged-0001')).data.originTokenId,undefined);
  assert(queued.some(m=>m.tokenId===ids.peer1));
  // Reprise d'une outbox ancienne sans sellerId : l'auteur est lu dans la vente.
  queued.length=0;
  await db.commit([db.write(`pulseStores/${store}/sales/legacy-notify-0001`,{id:'legacy-notify-0001',storeId:store,sellerId:1}),
    db.write('pulseOutbox/legacy-notify-0001',{saleId:'legacy-notify-0001',storeId:store,departmentId:'tech',status:'pending',createdAt:Date.now()})]);
  await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
  assert(queued.some(m=>m.saleId==='legacy-notify-0001'&&m.tokenId===ids.peer1));
  assert(!queued.some(m=>[ids.tablet,ids.peer2,ids.editorial,ids.other].includes(m.tokenId)));
  await consume({saleId:'legacy-notify-0001',tokenId:ids.tablet,storeId:store});assert.deepEqual(sent,[tokens.peer1]);
});

test('Cloud : verrouillage durable après cinq PIN erronés',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)},makeCustomToken:async()=> 'ok'});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,11).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}};
  const ctx={waitUntil(){}};
  async function req(path,method='GET',body,token) {const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  const store=LEGACY_STORE_ID;
  const good=await pinProof('demo-fnac',store,2,'90473512');
  await activateSeller(req,store,2,good,'admin');
  const bad=await pinProof('demo-fnac',store,2,'00000000');
  for(let n=0;n<5;n++)assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:2,proof:bad})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:2,proof:good})).status,429);
  const uid=`seller-${(await digestBase64(`${store}:2`)).slice(0,28)}`;
  assert((await db.get(`pulseAttempts/${uid}`)).data.lockUntil>Date.now());
});

test('Bilans : semaine sur deux mois, vendeur et suppressions',()=>{
  const catalog={sellers:[{id:1,name:'Morgan',active:true},{id:2,name:'Alice',active:true}],services:[{id:1,name:'DMax',icon:'play',active:true}]};
  const sale=(id,date,seller,deleted=false)=>({id,businessDate:date,createdAt:`${date}T12:00:00.000Z`,sellerId:seller,serviceId:1,source:'sale',deletedAt:deleted?'x':null});
  const sales=[sale('a','2026-10-31',1),sale('b','2026-11-01',1),sale('c','2026-11-01',2),sale('d','2026-11-01',2,true)];
  const out=summarize(catalog,sales,1,'2026-11-01');
  assert.deepEqual(periodStarts('2026-11-01'),{day:'2026-11-01',week:'2026-10-26',month:'2026-11-01'});
  assert.equal(earliestDate('2026-11-01'),'2026-10-26');
  assert.equal(out.day.total,2);assert.equal(out.week.total,3);assert.equal(out.month.total,2);assert.equal(out.mineTotal,1);assert.equal(out.leaderboard[0].name,'Alice');
});

test('Cloud : reprise FCM, limitation des doublons et profil archivé',async()=>{
  const db=new MemoryDb(), sent=[];
  let failures=1;
  const worker=createWorker({createDb:()=>db,sendFcm:async(_env,token,sale)=>{if(failures-- >0)throw Error('FCM temporairement indisponible');sent.push({token,sale});}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac'};
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,{waitUntil(){}});
  const catalog=(await db.get('pulse/catalog')).data,store=LEGACY_STORE_ID;
  const uid='seller-test',token='a-valid-firebase-device-token-123456',tokenId=await digestBase64(token);
  await db.commit([
    db.write(`pulseAccess/${uid}`,{active:true,storeId:store,sellerId:1,version:'v1'}),
    db.write(`pulseTokens/${tokenId}`,{token,uid,storeId:store,accessVersion:'v1'}),
    db.write(`pulseStores/${store}/sales/sale-test-0001`,{id:'sale-test-0001',storeId:store,sellerId:2}),
    db.write('pulseOutbox/sale-test-0001',{saleId:'sale-test-0001',storeId:store,status:'queued',createdAt:Date.now()})
  ]);
  const first=makeMessage({saleId:'sale-test-0001',storeId:store,tokenId});
  const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
  try {await worker.queue({messages:[first]},env);} finally {console.warn=warn;}
  assert.deepEqual(warnings,[['PULSE_PUSH_DIAG','fcm',0,'']]); // Aucun message d'erreur ni jeton personnel.
  assert.equal(first.retried,true);assert.equal(first.acked,false);
  const second=makeMessage(first.body);await worker.queue({messages:[second]},env);assert.equal(second.acked,true);assert.equal(sent.length,1);
  const again=makeMessage(first.body);await worker.queue({messages:[again]},env);assert.equal(again.acked,true);assert.equal(sent.length,1);
  catalog.sellers.find(x=>x.id===1).active=false;catalog.sellerFlags.s1=false;
  await db.commit([db.write('pulse/catalog',catalog),db.write(`pulseStores/${store}/sales/sale-test-0002`,{id:'sale-test-0002',storeId:store,sellerId:2}),db.write('pulseOutbox/sale-test-0002',{saleId:'sale-test-0002',storeId:store,status:'queued',createdAt:Date.now()})]);
  const archived=makeMessage({saleId:'sale-test-0002',storeId:store,tokenId});
  await worker.queue({messages:[archived]},env);assert.equal(archived.acked,true);assert.equal(sent.length,1);
});

test('Fuseau Paris : minuit et changement d’heure',()=>{
  assert.equal(parisDate('2026-03-28T22:59:59.000Z'),'2026-03-28');
  assert.equal(parisDate('2026-03-28T23:00:00.000Z'),'2026-03-29');
  assert.equal(parisDate('2026-06-30T21:59:59.000Z'),'2026-06-30');
  assert.equal(parisDate('2026-06-30T22:00:00.000Z'),'2026-07-01');
});
function parisDate(iso) {return parisToday(new Date(iso));}

test('Migration cloud atomique : sauvegarde, conflit, identifiants, ventes et PIN préservés',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db});
  const env={FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  const call=()=>worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  assert.equal((await call()).status,200);
  const fresh=(await db.get('pulse/catalog')).data;
  const legacy={...fresh};delete legacy.catalogVersion;delete legacy.sellerStores;delete legacy.serviceOrders;
  legacy.sellers=legacy.sellers.map(({storeId,...s})=>s);
  legacy.services=legacy.services.map(({priorityCode,...s})=>s);
  const pin={active:true,storeId:LEGACY_STORE_ID,sellerId:1,version:'old-version',pinMac:'secret-hash-unchanged'};
  const sale={id:'historic-sale',storeId:LEGACY_STORE_ID,sellerId:1,serviceId:1,businessDate:'2026-10-01'};
  await db.commit([db.write('pulse/catalog',legacy),db.write('pulseAccess/old-seller',pin),db.write(`pulseStores/${LEGACY_STORE_ID}/sales/historic-sale`,sale)]);
  // Simule un administrateur qui modifie le catalogue après la lecture mais avant le commit.
  const originalCommit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseBackups/catalog-before-store-scoping-v1')) {
      raced=true;const concurrent=(await db.get('pulse/catalog')).data;
      concurrent.sellers.push({id:13,name:'Clara',active:true});concurrent.nextSellerId=14;
      await originalCommit([db.write('pulse/catalog',concurrent)]);
    }
    return originalCommit(writes);
  };
  assert.equal((await call()).status,200);assert.equal(raced,true);
  const migrated=(await db.get('pulse/catalog')).data,backup=(await db.get('pulseBackups/catalog-before-store-scoping-v1')).data.catalog;
  assert.equal(backup.sellers.length,13);assert.equal(backup.sellers[12].name,'Clara');
  assert.equal(migrated.sellers.length,13);assert.equal(migrated.nextSellerId,14);
  assert(migrated.sellers.every(s=>s.storeId===LEGACY_STORE_ID));
  assert.equal(migrated.sellerStores.s1,LEGACY_STORE_ID);assert.equal(migrated.services.find(s=>s.id===1).priorityCode,'dmax');
  assert.deepEqual((await db.get('pulseAccess/old-seller')).data,pin);
  assert.deepEqual((await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/historic-sale`)).data,sale);
  const backupTime=(await db.get('pulseBackups/catalog-before-store-scoping-v1')).updateTime;
  assert.equal((await call()).status,200);assert.equal((await db.get('pulseBackups/catalog-before-store-scoping-v1')).updateTime,backupTime);
});

test('Classement : total, DMax, FVD, puis ordre alphabétique',()=>{
  const catalog={sellers:[{id:1,name:'Alice'},{id:2,name:'Zoé'},{id:3,name:'Clara'},{id:4,name:'Amélie'},{id:5,name:'Noah'}],
    services:[{id:1,name:'DMax',priorityCode:'dmax',active:true},{id:5,name:'FVD',priorityCode:'fvd',active:true},{id:9,name:'Autre',active:true}]};
  let n=0;const sales=[];
  function add(sellerId,serviceId,count){for(let i=0;i<count;i++)sales.push({id:String(++n),sellerId,serviceId,businessDate:'2026-10-27',createdAt:'2026-10-27T12:00:00Z',source:'sale',deletedAt:null});}
  add(1,1,1);add(1,5,1);add(1,9,2);
  add(2,1,2);add(2,9,2);
  add(3,1,2);add(3,5,1);add(3,9,1);
  add(4,1,2);add(4,5,1);add(4,9,1);
  add(5,9,5);
  const result=summarize(catalog,sales,1,'2026-10-27');
  assert.deepEqual(result.day.bySeller.map(x=>x.name),['Noah','Amélie','Clara','Zoé','Alice']);
  assert.deepEqual(result.leaderboard.map(x=>x.name),['Noah','Amélie','Clara']);
  assert.deepEqual(result.day.bySeller[1],{id:4,name:'Amélie',count:4,dmax:2,fvd:1});
});

test('Toast temps réel : attend le catalogue et utilise les derniers prénoms',()=>{
  const seen=[],announcer=createSaleAnnouncer(s=>seen.push(s));
  announcer.add({sellerId:1,serviceId:5});assert.equal(seen.length,0);
  announcer.setCatalog({sellers:[{id:1,name:'Morgan'}],services:[{id:5,name:'FVD'}]});
  assert.equal(seen[0].sellerName,'Morgan');assert.equal(seen[0].serviceName,'FVD');
  announcer.setCatalog({sellers:[{id:1,name:'Alice'}],services:[{id:5,name:'FVD'}]});
  announcer.add({sellerId:1,serviceId:5});assert.equal(seen[1].sellerName,'Alice');
});

test('Ordre des services indépendant par magasin, y compris les nouveaux services',()=>{
  const services=[{id:1},{id:2},{id:3},{id:4}],orders={A:[3,1,2],B:[2,3,1]};
  assert.deepEqual(orderServices(services,orders,'A').map(s=>s.id),[3,1,2,4]);
  assert.deepEqual(orderServices(services,orders,'B').map(s=>s.id),[2,3,1,4]);
  assert.deepEqual(orderServices(services,orders,'C').map(s=>s.id),[1,2,3,4]);
});

test('Objectifs cloud : confidentialité, vendeur/admin, simultanéité et changement de PIN',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin-token',{sub:'administrator'}]]);
  const worker=createWorker({
    createDb:()=>db,
    verifyIdToken:async(_env,t)=>{const claims=identities.get(t);if(!claims)throw Error('invalid');return claims;},
    makeCustomToken:async(_env,uid,claims)=>{const token=`seller-${claims.sellerId}-token`;identities.set(token,{sub:uid,...claims});return token;},
  });
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,9).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}};
  const ctx={waitUntil(){}};
  async function request(path,method='GET',body,token) {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  const base=(await request('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const target={storeId:store,sellerId:1,serviceId:1,values:{day:2,week:10,month:40},revision:null};
  assert.equal((await request('/api/goals')).status,401);
  assert.equal((await request('/api/goals','POST',target)).status,401);
  assert.equal((await request('/api/admin/goals','POST',target)).status,401);
  assert.equal((await request('/api/admin/goals','POST',{...target,storeId:other},'admin-token')).status,400);
  // L'admin peut préparer les objectifs avant l'activation du PIN, sans créer d'accès vendeur.
  let saved=await request('/api/admin/goals','POST',target,'admin-token');assert.equal(saved.status,200);
  const uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  assert.equal((await db.get(`pulseStatus/${uid}`)),null);
  assert.equal((await db.get(`pulseAccess/${uid}`)),null);
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.week,10);
  const proof1=await pinProof('demo-fnac',store,1,'73628519'),proof2=await pinProof('demo-fnac',store,2,'59386271');
  for(const [id,proof] of [[1,proof1],[2,proof2]]) {
    await activateSeller(request,store,id,proof,'admin-token');
    assert.equal((await request('/api/auth/login','POST',{storeId:store,sellerId:id,proof})).body.customToken,`seller-${id}-token`);
  }
  assert.equal((await request('/api/goals','GET',undefined,'seller-1-token')).body.goals.s1.day,2);
  assert.deepEqual((await request('/api/goals','GET',undefined,'seller-2-token')).body.goals,{});
  const rev=saved.body.goals.s1.revision;
  // Une sélection devenue périmée après changement de profil est refusée ; le jeton fait foi.
  const spoof=await request('/api/goals','POST',{...target,storeId:other,sellerId:2,revision:rev,values:{day:3,week:11,month:44}},'seller-1-token');
  assert.equal(spoof.status,403);
  assert.equal((await request(`/api/goals?storeId=${store}&sellerId=2`,'GET',undefined,'seller-1-token')).status,403);
  assert.equal((await request(`/api/goals?storeId=${other}&sellerId=1`,'GET',undefined,'seller-1-token')).status,403);
  assert.deepEqual((await request('/api/goals','GET',undefined,'seller-2-token')).body.goals,{});
  const valid=await request('/api/goals','POST',{...target,revision:rev,values:{day:3,week:11,month:44}},'seller-1-token');
  assert.equal(valid.status,200);assert.equal(valid.body.goals.s1.day,3);
  const currentRev=valid.body.goals.s1.revision;
  for(const values of [{day:-1,week:1,month:2},{day:1.5,week:1,month:2},{day:10000,week:1,month:2},{day:'4',week:1,month:2},{day:1,week:1}]) {
    assert.equal((await request('/api/goals','POST',{serviceId:1,values,revision:currentRev},'seller-1-token')).status,400);
  }
  assert.equal((await request('/api/goals','POST',{serviceId:999,values:{day:1,week:1,month:1},revision:null},'seller-1-token')).status,400);
  assert.equal((await request('/api/goals','POST',{serviceId:1,values:{day:2,week:2,month:2},revision:rev},'seller-1-token')).status,409);
  const statusBefore=(await db.get(`pulseStatus/${uid}`)).data;
  const race=await Promise.all([
    request('/api/goals','POST',{serviceId:1,values:{day:4,week:12,month:48},revision:currentRev},'seller-1-token'),
    request('/api/admin/goals','POST',{...target,values:{day:5,week:15,month:50},revision:currentRev},'admin-token'),
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  const after=(await db.get(`pulseStatus/${uid}`)).data;
  assert.notEqual(after.goalsRevision,statusBefore.goalsRevision);
  assert.equal(after.version,statusBefore.version);assert.equal('pinMac' in after,false);assert.equal('goals' in after,false);
  // Deux services modifiés en même temps ne s'écrasent pas.
  const separate=await Promise.all([
    request('/api/goals','POST',{serviceId:5,values:{day:1,week:3,month:10},revision:null},'seller-1-token'),
    request('/api/admin/goals','POST',{...target,serviceId:6,values:{day:null,week:6,month:20},revision:null},'admin-token'),
  ]);
  assert.deepEqual(separate.map(x=>x.status),[200,200]);
  let actual=(await request('/api/goals','GET',undefined,'seller-1-token')).body.goals;
  assert.equal(actual.s5.week,3);assert.equal(actual.s6.month,20);
  const changed=await pinProof('demo-fnac',store,1,'82467913');
  const reset=await request('/api/admin/pin-reset','POST',{storeId:store,sellerId:1},'admin-token');assert.equal(reset.status,200);
  assert.equal((await request('/api/goals','GET',undefined,'seller-1-token')).status,403);
  assert.equal((await request('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:changed})).status,200);
  assert.equal((await request('/api/auth/login','POST',{storeId:store,sellerId:1,proof:changed})).status,200);
  actual=(await request('/api/goals','GET',undefined,'seller-1-token')).body.goals;
  assert.equal(actual.s5.week,3);assert.equal(actual.s6.month,20);
  assert.equal((await request('/api/admin/entities/sellers/1','PATCH',{active:false,storeId:store},'admin-token')).status,200);
  assert.equal((await request('/api/goals','GET',undefined,'seller-1-token')).status,403);
});

test('Objectifs : activation du PIN simultanée à la première cible signale le changement',async()=>{
  const db=new MemoryDb();
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  const store=LEGACY_STORE_ID,uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  const statusPath=`pulseStatus/${uid}`,original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===statusPath&&w.del&&w.currentDocument?.exists===false)) {
      raced=true;
      await original([db.write(statusPath,{active:true,storeId:store,sellerId:1,version:'pin-created-concurrently'})]);
    }
    return original(writes);
  };
  const request=new Request('https://worker.test/api/admin/goals',{method:'POST',headers:{authorization:'Bearer admin','content-type':'application/json'},body:JSON.stringify({
    storeId:store,sellerId:1,serviceId:1,values:{day:3,week:9,month:30},revision:null,
  })});
  const result=await worker.fetch(request,env,ctx);assert.equal(result.status,200);assert.equal(raced,true);
  const status=(await db.get(statusPath)).data;
  assert.equal(status.version,'pin-created-concurrently');assert(status.goalsRevision);
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.day,3);
});

test('Jours personnels cloud : admin seul, isolation, conservation et modifications simultanées',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,
    verifyIdToken:async(_env,t)=>{const claims=identities.get(t);if(!claims)throw Error('invalid');return claims;},
    makeCustomToken:async(_env,uid,claims)=>{const token=`seller-${claims.sellerId}`;identities.set(token,{sub:uid,...claims});return token;},
  });
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,9).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token) {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  const base=(await req('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const schedule={storeId:store,sellerId:1,workdays:[1,2,3,4,6],revision:null};
  assert.equal((await req('/api/admin/workdays','POST',schedule)).status,401);
  assert.equal((await req('/api/admin/workdays','POST',{...schedule,storeId:other},'admin')).status,400);
  for(const days of [[],[1,1,2,3,4],[-1,0,1],[7],['1',2,3,4,5],[0,1,2,3,4,5,6,0]])assert.equal((await req('/api/admin/workdays','POST',{...schedule,workdays:days},'admin')).status,400);
  const before=(await req(`/api/admin/goals?storeId=${store}&sellerId=1`,'GET',undefined,'admin')).body;
  assert.deepEqual(before.workdays,[1,2,3,4,5]);assert.equal(before.workdaysRevision,null);
  const prepared=await req('/api/admin/workdays','POST',schedule,'admin');assert.equal(prepared.status,200);
  const uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  assert.equal(await db.get(`pulseStatus/${uid}`),null);assert.equal(await db.get(`pulseAccess/${uid}`),null);
  const proof1=await pinProof('demo-fnac',store,1,'73628519'),proof2=await pinProof('demo-fnac',store,2,'59386271');
  for(const [id,proof] of [[1,proof1],[2,proof2]]) {
    await activateSeller(req,store,id,proof,'admin');
    assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:id,proof})).status,200);
  }
  assert.deepEqual((await req('/api/goals','GET',undefined,'seller-1')).body.workdays,[1,2,3,4,6]);
  assert.deepEqual((await req('/api/goals','GET',undefined,'seller-2')).body.workdays,[1,2,3,4,5]);
  assert.equal((await req('/api/admin/workdays','POST',schedule,'seller-1')).status,403);
  const statusBefore=(await db.get(`pulseStatus/${uid}`)).data;
  // Le vendeur et l'admin modifient en parallèle un objectif et le planning : rien n'est perdu.
  const [goal,plan]=await Promise.all([
    req('/api/goals','POST',{serviceId:1,values:{day:5,week:null,month:null},revision:null},'seller-1'),
    req('/api/admin/workdays','POST',{...schedule,workdays:[2,3,4,5,6],revision:prepared.body.workdaysRevision},'admin'),
  ]);
  assert.equal(goal.status,200);assert.equal(plan.status,200);
  const after=(await req('/api/goals','GET',undefined,'seller-1')).body;
  assert.equal(after.goals.s1.day,5);assert.deepEqual(after.workdays,[2,3,4,5,6]);
  const statusAfter=(await db.get(`pulseStatus/${uid}`)).data;
  assert.notEqual(statusAfter.goalsRevision,statusBefore.goalsRevision);
  assert.equal(statusAfter.version,statusBefore.version);assert.equal('workdays' in statusAfter,false);assert.equal('goals' in statusAfter,false);
  // Deux administrateurs avec la même révision ne peuvent pas s'écraser.
  const race=await Promise.all([
    req('/api/admin/workdays','POST',{...schedule,workdays:[1,3,4,5,6],revision:after.workdaysRevision},'admin'),
    req('/api/admin/workdays','POST',{...schedule,workdays:[1,2,4,5,6],revision:after.workdaysRevision},'admin'),
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  const final=(await req('/api/goals','GET',undefined,'seller-1')).body;
  assert.equal(final.goals.s1.day,5);
  assert.deepEqual((await req('/api/goals','GET',undefined,'seller-2')).body.workdays,[1,2,3,4,5]);
  const allDays=await req('/api/admin/workdays','POST',{...schedule,workdays:[0,1,2,3,4,5,6],revision:final.workdaysRevision},'admin');
  assert.equal(allDays.status,200);assert.deepEqual(allDays.body.workdays,[1,2,3,4,5,6,0]);
  const sunday=await req('/api/admin/workdays','POST',{...schedule,workdays:[0],revision:allDays.body.workdaysRevision},'admin');
  assert.equal(sunday.status,200);assert.deepEqual(sunday.body.workdays,[0]);assert.equal(sunday.body.goals.s1.day,5);
  assert.deepEqual((await req('/api/goals','GET',undefined,'seller-1')).body.workdays,[0]);
  const newProof=await pinProof('demo-fnac',store,1,'82467913');
  const reset=await req('/api/admin/pin-reset','POST',{storeId:store,sellerId:1},'admin');assert.equal(reset.status,200);
  assert.equal((await req('/api/goals','GET',undefined,'seller-1')).status,403);
  assert.equal((await req('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof})).status,200);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof})).status,200);
  assert.deepEqual((await req('/api/goals','GET',undefined,'seller-1')).body.workdays,[0]);
});

test('Planning : création du PIN simultanée signale la modification',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  const store=LEGACY_STORE_ID,uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  const statusPath=`pulseStatus/${uid}`,original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===statusPath&&w.del&&w.currentDocument?.exists===false)) {
      raced=true;await original([db.write(statusPath,{active:true,storeId:store,sellerId:1,version:'pin-created-concurrently'})]);
    }
    return original(writes);
  };
  const request=new Request('https://worker.test/api/admin/workdays',{method:'POST',headers:{authorization:'Bearer admin','content-type':'application/json'},body:JSON.stringify({storeId:store,sellerId:1,workdays:[2,3,4,5,6],revision:null})});
  const result=await worker.fetch(request,env,ctx);assert.equal(result.status,200);assert.equal(raced,true);
  const status=(await db.get(statusPath)).data;assert.equal(status.version,'pin-created-concurrently');assert(status.goalsRevision);
  assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data.workdays,[2,3,4,5,6]);
});

test('Cloud départements : affectations, agrégats privés, historique et notifications ciblées',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]),sent=[],queued=[],waits=[];
  const worker=createWorker({createDb:()=>db,
    verifyIdToken:async(_env,t)=>{const c=identities.get(t);if(!c)throw Error('invalid');return c;},
    makeCustomToken:async(_env,uid,claims)=>{const t=`seller-${claims.sellerId}`;identities.set(t,{sub:uid,...claims});return t;},
    sendFcm:async(_env,t,sale)=>sent.push({token:t,sale})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,9).toString('base64url'),
    LOGIN_LIMITER:{async limit(){return {success:true}}},PULSE_QUEUE:{async sendBatch(messages){queued.push(...messages.map(m=>m.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token) {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  async function flush(){await Promise.all(waits.splice(0));const messages=queued.splice(0).map(makeMessage);await worker.queue({messages},env);assert(messages.every(m=>m.acked));return messages.length;}
  const base=(await req('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  assert(base.sellers.every(s=>s.storeId===store&&s.departmentId==='tech'));
  assert.equal((await req('/api/admin/departments','POST',{storeId:store,name:'Univers photo'})).status,401);
  const added=await req('/api/admin/departments','POST',{storeId:store,name:'Univers photo'},'admin');assert.equal(added.status,200);
  assert.equal((await req('/api/admin/departments','POST',{storeId:store,name:'univers PHOTO'},'admin')).status,409);
  assert.equal((await req(`/api/admin/departments/${added.body.id}`,'PATCH',{storeId:store,name:'Image'},'admin')).status,200);
  assert.equal((await req('/api/admin/entities/sellers/2','PATCH',{storeId:store,departmentId:'editorial'},'admin')).status,200);
  assert.equal((await req('/api/admin/entities/sellers/4','PATCH',{storeId:store,departmentId:'editorial'},'admin')).status,200);
  assert.equal((await req('/api/admin/departments/editorial','PATCH',{storeId:store,active:false},'admin')).status,409);
  assert.equal((await req('/api/admin/entities/sellers/3','PATCH',{storeId:other,departmentId:'editorial'},'admin')).status,400);
  assert.equal((await req('/api/admin/entities/sellers','POST',{storeId:other,name:'Autre équipe',departmentId:'tech'},'admin')).status,200);
  const otherSeller=(await req(`/api/bootstrap?storeId=${other}`)).body.sellers.find(s=>s.storeId===other).id;
  const pins={1:'73628519',2:'59386271',3:'67289415',4:'78234691',[otherSeller]:'48275196'};
  for(const [id,pin] of Object.entries(pins)) {
    const sid=Number(id),targetStore=sid===otherSeller?other:store,proof=await pinProof('demo-fnac',targetStore,sid,pin);
    await activateSeller(req,targetStore,sid,proof,'admin');
    if(sid===2)assert.equal((await req('/api/auth/login','POST',{storeId:targetStore,sellerId:sid,departmentId:'tech',proof})).status,401);
    assert.equal((await req('/api/auth/login','POST',{storeId:targetStore,sellerId:sid,departmentId:sid===2||sid===4?'editorial':'tech',proof})).status,200);
    assert.equal((await req('/api/push/subscribe','POST',{token:`registration-token-for-seller-${sid}-123456`},`seller-${sid}`)).status,200);
  }
  for(const [sid,month] of [[1,10],[2,20]])assert.equal((await req('/api/admin/goals','POST',{
    storeId:store,sellerId:sid,serviceId:1,values:{day:null,week:null,month},revision:null
  },'admin')).status,200);
  assert.equal((await req('/api/goals','POST',{serviceId:2,values:{day:null,week:null,month:0},revision:null},'seller-1')).status,200);
  const marker=(await db.get(`pulseStores/${store}/sales/~summary-goals~`)).data;
  assert.deepEqual(Object.keys(marker),['revision']);
  assert.equal((await req('/api/summary-goals')).status,401);
  assert.equal((await req(`/api/summary-goals?storeId=${other}`,'GET',undefined,'seller-1')).status,403);
  const aggregate=await req(`/api/summary-goals?storeId=${store}`,'GET',undefined,'seller-1');assert.equal(aggregate.status,200);
  assert.equal(aggregate.body.store.byService.s1.month,30);
  assert.equal(aggregate.body.store.byService.s2.month,0);
  assert.equal(aggregate.body.departments.tech.byService.s1.month,10);
  assert.equal(aggregate.body.departments.editorial.byService.s1.month,20);
  assert(!JSON.stringify(aggregate.body).includes('workdays'));assert(!JSON.stringify(aggregate.body).includes('Morgan'));
  assert.equal((await req(`/api/goals?storeId=${store}&sellerId=2`,'GET',undefined,'seller-1')).status,403);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'tech-sale-000001'},'seller-1')).status,200);
  assert.equal(await flush(),1);assert.deepEqual(sent.map(x=>x.token),['registration-token-for-seller-3-123456']);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'editorial-sale-00001'},'seller-2')).status,200);
  assert.equal(await flush(),1);assert.equal(sent.at(-1).token,'registration-token-for-seller-4-123456');
  assert.equal((await db.get(`pulseStores/${store}/sales/tech-sale-000001`)).data.departmentId,'tech');
  assert.equal((await db.get(`pulseStores/${store}/sales/editorial-sale-00001`)).data.departmentId,'editorial');
  // An queued target may move before delivery; the consumer rechecks membership.
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'before-move-sale-001'},'seller-1')).status,200);
  await Promise.all(waits.splice(0));assert.equal(queued.length,1);
  assert.equal((await req('/api/admin/entities/sellers/3','PATCH',{storeId:store,departmentId:'editorial'},'admin')).status,200);
  assert.equal((await req('/api/admin/entities/sellers/1','PATCH',{storeId:store,departmentId:'editorial'},'admin')).status,200);
  const movedMessage=makeMessage(queued.shift());await worker.queue({messages:[movedMessage]},env);assert(movedMessage.acked);assert.equal(sent.length,2);
  const oldSale=(await db.get(`pulseStores/${store}/sales/tech-sale-000001`)).data;assert.equal(oldSale.departmentId,'tech');
  assert.equal((await req('/api/sales/remove','POST',{serviceId:1},'seller-1')).status,409);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'after-move-sale-0001'},'seller-1')).status,200);
  assert.equal(await flush(),3);assert.equal(sent.length,5);
  const allSales=(await db.query(`pulseStores/${store}/sales`)).map(d=>d.data).filter(s=>s.businessDate);
  const catalog=(await db.get('pulse/catalog')).data,stats=summarize(catalog,allSales,1,parisToday(),store);
  assert.equal(stats.day.total,2);assert.equal(stats.mineTotal,3); // Total personnel, y compris l'ancien département.
  assert.equal(stats.day.mineByService.find(x=>x.serviceId===1).count,3); // Objectif personnel : les ventes des deux départements.
  assert.equal(stats.summary.store.day.total,4);assert.equal(stats.summary.departments.tech.day.total,2);assert.equal(stats.summary.departments.editorial.day.total,2);
  const after=(await req(`/api/summary-goals?storeId=${store}`,'GET',undefined,'seller-1')).body;
  assert.equal(after.departments.editorial.byService.s1.month,30);assert.equal(after.departments.tech.byService.s1.month,null);
  assert.equal((await req('/api/admin/departments/editorial','PATCH',{storeId:store,active:false},'admin')).status,409);
  assert.equal((await req(`/api/admin/departments/${added.body.id}`,'PATCH',{storeId:store,active:false},'admin')).status,200);
  const untouched=(await req(`/api/bootstrap?storeId=${other}`)).body;assert.equal(untouched.departmentsByStore[other],undefined);
});

test('Initialisation actuelle : aucune remise à zéro globale, même sans marqueur historique',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{const p=identities.get(t);if(!p)throw Error();return p;},makeCustomToken:async()=> 'new-session'});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,20).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');const storeId=LEGACY_STORE_ID,sellerId=1,uid=`seller-${(await digestBase64(`${storeId}:${sellerId}`)).slice(0,28)}`;
  const proof=await pinProof('demo-fnac',storeId,sellerId,'65481902'),old={active:true,storeId,sellerId,sellerKey:'s1',version:'version-avant-update',pinMac:await pinMac(env,uid,proof),pinPersonal:true};
  identities.set('old-session',{sub:uid,role:'seller',storeId,sellerId,sellerKey:'s1',accessVersion:old.version});
  const status={active:true,storeId,sellerId,sellerKey:'s1',version:old.version,goalsRevision:'goal-tag'},goals={goals:{s1:{month:20,revision:'goal-revision'}},workdays:[1,3,5],workdaysRevision:'days-revision'},sale={id:'vente-avant-update',storeId,sellerId,serviceId:1,businessDate:'2026-10-29'};
  await db.commit([db.write(`pulseAccess/${uid}`,old),db.write(`pulseStatus/${uid}`,status),db.write(`pulseGoals/${uid}`,goals),db.write(`pulseStores/${storeId}/sales/${sale.id}`,sale)]);
  assert.equal(await db.get('pulseMigrations/open-pin-reset-2026-10-29'),null);
  assert.equal((await req('/api/auth/initialize','POST',{})).status,200);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId,sellerId})).body,{needsPin:false});
  assert.deepEqual((await db.get(`pulseAccess/${uid}`)).data,old);assert.deepEqual((await db.get(`pulseStatus/${uid}`)).data,status);
  assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data,goals);assert.deepEqual((await db.get(`pulseStores/${storeId}/sales/${sale.id}`)).data,sale);
  assert.equal((await req('/api/goals','GET',undefined,'old-session')).status,200);
  assert.equal((await req('/api/auth/login','POST',{storeId,sellerId,proof,openPinFlow:true})).status,200);
  const another=createWorker({createDb:()=>db});assert.equal((await another.fetch(new Request('https://worker.test/api/auth/initialize',{method:'POST'}),env,ctx)).status,200);
  assert.deepEqual((await db.get(`pulseAccess/${uid}`)).data,old);assert.equal(await db.get('pulseMigrations/open-pin-reset-2026-10-29'),null);
});

test('Première connexion sans code : création unique, sécurité PIN et réinitialisation administrateur',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}],['seller',{sub:'different-seller',role:'seller'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)},makeCustomToken:async()=> 'ok'});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,21).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token) {const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');const storeId=LEGACY_STORE_ID,sellerId=1;
  const proof=await pinProof('demo-fnac',storeId,sellerId,'27594068'),other=await pinProof('demo-fnac',storeId,sellerId,'12345678');
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId,sellerId})).status,401);
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId,sellerId},'seller')).status,403);
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId,sellerId,proof},'admin')).status,400);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId,sellerId})).body,{needsPin:true});
  assert.equal((await req('/api/auth/claim','POST',{storeId,sellerId,newProof:'invalid'})).status,400);
  assert.equal((await req('/api/auth/claim','POST',{storeId,sellerId,newProof:proof,departmentId:'wrong'})).status,400);
  const attempts=await Promise.all([
    req('/api/auth/claim','POST',{storeId,sellerId,newProof:proof}),
    req('/api/auth/claim','POST',{storeId,sellerId,newProof:other}),
  ]);
  assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);
  const winning=attempts[0].status===200?proof:other,losing=attempts[0].status===200?other:proof;
  assert.deepEqual((await req('/api/auth/status','POST',{storeId,sellerId})).body,{needsPin:false});
  assert.equal((await req('/api/auth/claim','POST',{storeId,sellerId,newProof:losing})).status,409);
  assert.equal((await req('/api/auth/login','POST',{storeId,sellerId,proof:losing})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId,sellerId,proof:winning})).status,200);
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId,sellerId},'admin')).status,200);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId,sellerId})).body,{needsPin:true});
  assert.equal((await req('/api/auth/claim','POST',{storeId,sellerId,newProof:losing})).status,200);
  assert.equal((await req('/api/auth/login','POST',{storeId,sellerId,proof:winning})).status,401);
});

test('Initialisation actuelle : ancien marqueur en cours laissé intact, aucun lot de reset',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db}),env={FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  const c=(await db.get('pulse/catalog')).data;
  for(let id=13;id<=325;id++)c.sellers.push({id,name:`Vendeur ${id}`,active:true,storeId:LEGACY_STORE_ID});
  c.nextSellerId=326;c.sellerFlags=Object.fromEntries(c.sellers.map(x=>[`s${x.id}`,true]));c.sellerStores=Object.fromEntries(c.sellers.map(x=>[`s${x.id}`,x.storeId]));
  const marker={state:'running',cursor:80,lockUntil:0},uid=`seller-${(await digestBase64(`${LEGACY_STORE_ID}:325`)).slice(0,28)}`,access={active:true,storeId:LEGACY_STORE_ID,sellerId:325,sellerKey:'s325',version:'preserve',pinMac:'preserve'};
  await db.commit([db.write('pulse/catalog',c),db.write('pulseMigrations/open-pin-reset-2026-10-29',marker),db.write(`pulseAccess/${uid}`,access)]);
  const response=await worker.fetch(new Request('https://worker.test/api/auth/initialize',{method:'POST'}),env,ctx);assert.equal(response.status,200);
  assert.deepEqual((await db.get('pulseMigrations/open-pin-reset-2026-10-29')).data,marker);assert.deepEqual((await db.get(`pulseAccess/${uid}`)).data,access);
});

test('Réinitialisation concurrente : aucune vente ou annulation après révocation',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{const p=identities.get(t);if(!p)throw Error();return p;},
    makeCustomToken:async(_env,uid,claims)=>{identities.set('seller',{sub:uid,...claims});return 'seller';},sendFcm:async()=>{}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,23).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}},PULSE_QUEUE:{async sendBatch(){}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token) {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  await req('/api/bootstrap');const storeId=LEGACY_STORE_ID,sellerId=1,proof=await pinProof('demo-fnac',storeId,sellerId,'17263940');
  await activateSeller(req,storeId,sellerId,proof,'admin');
  const uid=`seller-${(await digestBase64(`${storeId}:${sellerId}`)).slice(0,28)}`;
  const original=db.commit.bind(db);let shouldRace=true;
  db.commit=async writes=>{
    if(shouldRace&&writes.some(w=>w.check&&w.path===`pulseAccess/${uid}`)) {
      shouldRace=false;const a=(await db.get(`pulseAccess/${uid}`)).data,st=(await db.get(`pulseStatus/${uid}`)).data;
      await original([db.write(`pulseAccess/${uid}`,{...a,active:false,version:'reset-during-request'}),db.write(`pulseStatus/${uid}`,{...st,active:false,version:'reset-during-request'})]);
    }
    return original(writes);
  };
  const blocked=await req('/api/sales','POST',{serviceId:1,requestId:'race-sale-create-001'},'seller');
  assert.equal(blocked.status,409);assert.equal(await db.get(`pulseStores/${storeId}/sales/race-sale-create-001`),null);
  await activateSeller(req,storeId,sellerId,proof,'admin');
  const sale=await req('/api/sales','POST',{serviceId:1,requestId:'race-sale-delete-001'},'seller');assert.equal(sale.status,200);
  shouldRace=true;
  assert.equal((await req('/api/sales/race-sale-delete-001','DELETE',{},'seller')).status,409);
  assert.equal((await db.get(`pulseStores/${storeId}/sales/race-sale-delete-001`)).data.deletedAt,null);
});

test('Annuaire cloud : migration atomique, données historiques et modification administrateur simultanée',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db});
  const env={FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  const call=()=>worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  assert.equal((await call()).status,200);
  const legacy=(await db.get('pulse/catalog')).data;
  legacy.stores=legacyLocations.map(s=>({...s,active:true}));
  legacy.stores.find(s=>s.id==='osm-node-3782323705').extra='propriété préservée';
  legacy.stores.find(s=>s.name==='Fnac Nantes').active=false;
  legacy.stores.push({id:'custom-before',name:'Magasin personnalisé',active:true,lat:12,lon:5});
  legacy.sellers.push({id:13,name:'Vendeur Laval',active:true,storeId:'osm-node-3782323705',departmentId:'tech'});
  legacy.nextSellerId=14;legacy.sellerStores.s13='osm-node-3782323705';legacy.sellerFlags.s13=true;
  delete legacy.storeDirectoryVersion;delete legacy.directorySync;
  const pin={storeId:'osm-node-3782323705',sellerId:13,pinMac:'hash-défini',version:'v1',active:true};
  const sale={id:'vente-historique',storeId:LEGACY_STORE_ID,sellerId:1,serviceId:1,businessDate:'2026-10-15'};
  const goals={storeId:LEGACY_STORE_ID,sellerId:1,goals:{s1:{month:12}},workdays:[1,2,3,4,5]};
  await db.commit([db.write('pulse/catalog',legacy),db.write('pulseAccess/existing',pin),db.write('pulseGoals/existing',goals),db.write(`pulseStores/${LEGACY_STORE_ID}/sales/vente-historique`,sale)]);
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseBackups/catalog-before-fnac-directory-v1')) {
      raced=true;const concurrent=(await db.get('pulse/catalog')).data;
      concurrent.stores.push({id:'custom-race',name:'Ajout simultané',active:true,lat:1,lon:1});
      await commit([db.write('pulse/catalog',concurrent)]);
    }
    return commit(writes);
  };
  const a=await call();assert.equal(a.status,200);assert(raced);
  const repeats=await Promise.all([call(),call()]);assert(repeats.every(response=>response.status===200));
  const now=(await db.get('pulse/catalog')).data,backup=await db.get('pulseBackups/catalog-before-fnac-directory-v1');
  assert(backup.data.catalog.stores.some(s=>s.id==='custom-race'));
  assert(now.stores.some(s=>s.id==='custom-race')&&now.stores.some(s=>s.id==='custom-before'));
  assert.equal(now.stores.find(s=>s.fnacId==='cl57').id,LEGACY_STORE_ID);
  assert.deepEqual(now.directoryRegions,['Fnac Guadeloupe','Fnac La Réunion']);
  assert(now.stores.every(s=>s.directoryStatus!=='region'));
  const laval=now.stores.find(s=>s.fnacId==='cl449');assert.equal(laval.id,'osm-node-3782323705');assert.equal(laval.extra,'propriété préservée');
  assert.equal(now.stores.find(s=>s.name==='Fnac Nantes').active,false);
  assert.equal(now.sellers.find(s=>s.id===13).storeId,'osm-node-3782323705');
  assert.deepEqual((await db.get('pulseAccess/existing')).data,pin);
  assert.deepEqual((await db.get('pulseGoals/existing')).data,goals);
  assert.deepEqual((await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/vente-historique`)).data,sale);
  const saved=backup.updateTime;await call();assert.equal((await db.get('pulseBackups/catalog-before-fnac-directory-v1')).updateTime,saved);
});

test('Mentions régionales cloud : ajout atomique sans réappliquer un ancien annuaire',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db}),env={FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  const call=()=>worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  assert.equal((await call()).status,200);
  const prior=(await db.get('pulse/catalog')).data;
  prior.stores=prior.stores.filter(s=>s.directoryStatus!=='regional-choice');
  delete prior.storeRegionalChoicesVersion;delete prior.directorySync.regionalReview;delete prior.directorySync.regionalReviewCount;
  const changed=prior.stores.find(s=>s.fnacId==='cl629');changed.name='Fnac Nom plus récent';changed.directoryStatus='manual';changed.previousNames=['Fnac Carre Senart'];
  const oldPin={storeId:LEGACY_STORE_ID,sellerId:1,version:'session-conservée',pinMac:'hash-conservé'};
  const oldGoal={storeId:LEGACY_STORE_ID,sellerId:1,goals:{s1:{month:17}}};
  const oldSale={id:'historique',storeId:LEGACY_STORE_ID,sellerId:1,serviceId:1};
  await db.commit([db.write('pulse/catalog',prior),db.write('pulseAccess/pre-existing',oldPin),db.write('pulseGoals/pre-existing',oldGoal),db.write(`pulseStores/${LEGACY_STORE_ID}/sales/historique`,oldSale)]);
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseBackups/catalog-before-fnac-regional-choices-v1')) {
      raced=true;const concurrent=(await db.get('pulse/catalog')).data;
      concurrent.stores.push({id:'custom-concurrent',name:'Ajout simultané',active:true});
      await commit([db.write('pulse/catalog',concurrent)]);
    }
    return commit(writes);
  };
  assert.equal((await call()).status,200);assert(raced);
  const now=(await db.get('pulse/catalog')).data,backup=await db.get('pulseBackups/catalog-before-fnac-regional-choices-v1');
  assert(backup.data.catalog.stores.some(s=>s.id==='custom-concurrent'));
  assert.deepEqual(now.stores.find(s=>s.fnacId==='cl629'),changed,'aucun retour au nom de l’ancien instantané');
  for(const store of prior.stores)assert.deepEqual(now.stores.find(s=>s.id===store.id),store);
  assert(now.stores.some(s=>s.id==='custom-concurrent'));
  assert.deepEqual(now.stores.filter(s=>s.directoryStatus==='regional-choice').map(s=>s.name),['Fnac Guadeloupe','Fnac La Réunion']);
  assert.equal(now.directorySync.regionalReviewCount,0);assert.equal(now.directorySync.verifiedAt,prior.directorySync.verifiedAt);
  assert.deepEqual(now.sellers,prior.sellers);assert.deepEqual(now.services,prior.services);
  assert.deepEqual((await db.get('pulseAccess/pre-existing')).data,oldPin);assert.deepEqual((await db.get('pulseGoals/pre-existing')).data,oldGoal);
  assert.deepEqual((await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/historique`)).data,oldSale);
  const updated=(await db.get('pulse/catalog')).updateTime;await Promise.all([call(),call()]);assert.equal((await db.get('pulse/catalog')).updateTime,updated);
});

function simulatedFnacPage(entries,declared=entries.length+2) {
  const list=entries.map(s=>`<a href="https://www.fnac.com/ville/fiche/${s.fnacId}/w-4">${s.name.replace(/^Fnac /,'').replaceAll('&','&amp;')}</a>`).join('');
  return `<!doctype html><html><body><h1>Trouver un magasin Fnac</h1><span>${declared}</span><span>Magasins</span>${list}</body></html>`;
}
test('Annuaire cloud : refus, essai mensuel, succès simulé concurrent et liste partielle sans perte',async()=>{
  const db=new MemoryDb();let supplied=new Response('Fnac refuse les requêtes automatiques',{status:403});
  const worker=createWorker({createDb:()=>db,fetchDirectory:async()=>supplied.clone(),verifyIdToken:async(_env,t)=>{if(t!=='admin')throw Error();return {sub:'admin-uid'};}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'admin-uid'},waiting=[],ctx={waitUntil(p){waiting.push(p)}};
  const req=async(path,method='GET',token)=>{
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:token?{authorization:`Bearer ${token}`}:{}}),env,ctx);
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await req('/api/bootstrap')).status,200);
  const pin={storeId:LEGACY_STORE_ID,sellerId:1,pinMac:'hash-préservé',active:true,version:'same'};
  const sale={id:'ancienne',sellerId:1,storeId:LEGACY_STORE_ID};
  await db.commit([db.write('pulseAccess/x',pin),db.write(`pulseStores/${LEGACY_STORE_ID}/sales/ancienne`,sale)]);
  const before=(await db.get('pulse/catalog')).data;
  assert.equal((await req('/api/admin/stores/sync','POST')).status,401);
  await worker.scheduled({cron:'0 6 1 * *'},env,ctx);await Promise.all(waiting.splice(0));
  let after=(await db.get('pulse/catalog')).data;
  assert.equal(after.directorySync.lastResult,'blocked');assert.deepEqual(after.stores,before.stores);assert.deepEqual(after.sellers,before.sellers);
  assert.equal((await req('/api/admin/stores/sync','POST','admin')).body.result,'blocked');

  const fresh=directorySnapshot.stores.filter(s=>s.fnacId!=='cl124').map(s=>s.fnacId==='cl57'?{...s,name:'Fnac Labège Centrale'}:s);
  fresh.push({fnacId:'cl9999',name:'Fnac Nouvelle de test'});
  supplied=new Response(simulatedFnacPage(fresh),{status:200,headers:{'content-type':'text/html'}});
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path.startsWith('pulseBackups/catalog-before-fnac-sync-'))) {
      raced=true;const concurrent=(await db.get('pulse/catalog')).data;
      concurrent.stores.push({id:'custom-at-sync',name:'Ajout pendant la vérification',active:true});
      await commit([db.write('pulse/catalog',concurrent)]);
    }
    return commit(writes);
  };
  const ok=await req('/api/admin/stores/sync','POST','admin');assert.equal(ok.status,200);assert.equal(ok.body.ok,true);assert(raced);
  after=(await db.get('pulse/catalog')).data;
  assert.equal(after.stores.find(s=>s.fnacId==='cl57').id,LEGACY_STORE_ID);
  assert.equal(after.stores.find(s=>s.fnacId==='cl57').name,'Fnac Labège Centrale');
  assert.equal(after.stores.find(s=>s.fnacId==='cl124').directoryStatus,'historical');
  assert.equal(after.stores.find(s=>s.fnacId==='cl124').active,true);
  assert.equal(after.stores.find(s=>s.fnacId==='cl9999').id,'fnac-cl9999');
  assert(after.stores.some(s=>s.id==='custom-at-sync'));
  assert.deepEqual(after.sellers,before.sellers);
  assert.deepEqual((await db.get('pulseAccess/x')).data,pin);
  assert.deepEqual((await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/ancienne`)).data,sale);
  assert(await db.get(`pulseBackups/catalog-before-fnac-sync-${new Date().toISOString().slice(0,7)}`));

  const safe=structuredClone(after.stores);
  supplied=new Response(simulatedFnacPage(fresh.slice(0,100),191),{status:200});
  await worker.scheduled({cron:'0 6 1 * *'},env,ctx);await Promise.all(waiting.splice(0));
  after=(await db.get('pulse/catalog')).data;
  assert.equal(after.directorySync.lastResult,'incomplete');assert.deepEqual(after.stores,safe);
});

test('Reset ventes cloud : confirmation, magasin isolé, toutes dates, nouvelles ventes et reprise idempotente',async()=>{
  const db=new MemoryDb(),queued=[],sent=[],waits=[];
  const identities=new Map([['admin-reset',{sub:'administrator'}],['vendeur-reset',{sub:'seller-reset',role:'seller',storeId:LEGACY_STORE_ID,sellerId:1,accessVersion:'version-reset'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)},sendFcm:async(...args)=>sent.push(args)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(messages){queued.push(...messages.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token){
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:response.status,body:await response.json()};
  }
  const base=(await req('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id,day=parisToday();
  const uid='seller-reset',tokenId='a'.repeat(43),oldId='old-sale-00000000';
  await db.commit([
    db.write(`pulseAccess/${uid}`,{active:true,version:'version-reset',storeId:store,sellerId:1,sellerKey:'s1'}),
    db.write(`pulseStatus/${uid}`,{active:true,version:'version-reset',storeId:store,sellerId:1}),
    db.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:{month:20,revision:'revision-0001'}}}),
    db.write(`pulseStores/${store}/sales/~summary-goals~`,{revision:'goal-revision'}),
    db.write(`pulseStores/${other}/sales/other-sale-0001`,{id:'other-sale-0001',businessDate:day,storeId:other,sellerId:1,serviceId:1}),
    db.write(`pulseTokens/${tokenId}`,{token:'fake-token',uid,storeId:store,accessVersion:'version-reset'}),
  ]);
  for(let i=0;i<65;i++) {
    const id=`old-sale-${String(i).padStart(8,'0')}`;
    await db.commit([db.write(`pulseStores/${store}/sales/${id}`,{id,storeId:store,sellerId:i%2+1,departmentId:i%2?'tech':'caisse',serviceId:1,
      businessDate:i%2?day:'2025-02-10',createdAt:'2025-02-10T10:00:00.000Z',deletedAt:i%5===0?'2025-02-10T11:00:00.000Z':null,source:'sale',ownerUid:uid}),
      db.write(`pulseOutbox/${id}`,{saleId:id,storeId:store,departmentId:'tech',sellerName:'Personne test',serviceName:'DMax',createdAt:Date.now(),status:'queued'})]);
  }
  const reset={storeId:store,jobId:'reset-job-00000001',confirmation:'SUPPRIMER'};
  assert.equal((await req('/api/admin/sales/reset','POST',reset)).status,401);
  assert.equal((await req('/api/admin/sales/reset','POST',reset,'vendeur-reset')).status,403);
  assert.equal((await req('/api/admin/sales/reset','POST',{...reset,confirmation:'oui'},'admin-reset')).status,400);
  assert.equal((await req('/api/admin/sales/reset','POST',{...reset,storeId:'not-an-active-store'},'admin-reset')).status,400);
  assert.equal((await req('/api/admin/sales/reset','POST',{...reset,jobId:123456789},'admin-reset')).status,400);
  assert.equal((await req(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,'admin-reset')).body.status,'idle');
  assert.equal((await db.get(`pulseStores/${store}/sales/${oldId}`)).data.sellerId,1);
  const start=await req('/api/admin/sales/reset','POST',reset,'admin-reset');
  assert.equal(start.status,200);assert.equal(start.body.status,'running');
  assert.equal((await db.get(`pulseStores/${store}/sales/~sales-reset~`)).data.generation,reset.jobId);
  assert.equal((await req('/api/admin/sales/reset','POST',{...reset,jobId:'reset-job-other-00002'},'admin-reset')).status,409);
  assert.equal((await req('/api/admin/sales/reset','POST',{...reset,storeId:other},'admin-reset')).status,409);
  assert.equal((await req(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,'admin-reset')).body.counts.length,0);
  // Une vente créée après le marqueur est conservée et visible immédiatement.
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'000-new-sale-0001'},'vendeur-reset')).status,200);
  await Promise.all(waits.splice(0));
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:oldId},'vendeur-reset')).status,409);
  assert.equal((await req('/api/admin/adjust','POST',{storeId:store,sellerId:1,serviceId:1,count:2},'admin-reset')).status,200);
  assert.equal((await req(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,'admin-reset')).body.counts[0].count,2);
  // Une notification en attente pour une vente antérieure est annulée.
  const oldNotification=makeMessage({saleId:oldId,tokenId,storeId:store});
  await worker.queue({messages:[oldNotification]},env);assert.equal(oldNotification.acked,true);assert.equal(sent.length,0);
  const first=queued.findIndex(x=>x.kind==='sales-reset');assert(first>=0);
  const duplicate=queued.splice(first,1)[0],a=makeMessage(duplicate),b=makeMessage(duplicate);
  await Promise.all([worker.queue({messages:[a]},env),worker.queue({messages:[b]},env)]);
  if(a.retried)queued.push(a.body);if(b.retried)queued.push(b.body);
  // Ces IDs tombent respectivement avant et après le curseur de pagination.
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'aaa-new-sale-0002'},'vendeur-reset')).status,200);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'zzz-new-sale-0003'},'vendeur-reset')).status,200);
  await Promise.all(waits.splice(0));
  for(let steps=0;steps<100;steps++) {
    const status=(await req(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,'admin-reset')).body;
    if(status.status==='done')break;
    let index=queued.findIndex(x=>x.kind==='sales-reset');
    if(index<0){await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));index=queued.findIndex(x=>x.kind==='sales-reset');}
    assert(index>=0,'la reprise planifiée doit retrouver le reset');
    const message=makeMessage(queued.splice(index,1)[0]);await worker.queue({messages:[message]},env);if(message.retried)queued.push(message.body);
    if(steps===99)assert.fail('le reset aurait dû se terminer');
  }
  const done=(await req(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,'admin-reset')).body;
  assert.equal(done.status,'done');assert.equal(done.deletedSales,65);
  for(let i=0;i<65;i++) {
    const id=`old-sale-${String(i).padStart(8,'0')}`;
    assert.equal(await db.get(`pulseStores/${store}/sales/${id}`),null);
    assert.deepEqual((await db.get(`pulseOutbox/${id}`)).data,{status:'reset'});
  }
  for(const id of ['000-new-sale-0001','aaa-new-sale-0002','zzz-new-sale-0003']) {
    assert.equal((await db.get(`pulseStores/${store}/sales/${id}`)).data.generation,reset.jobId);
    assert.equal((await db.get(`pulseOutbox/${id}`)).data.generation,reset.jobId);
  }
  assert(await db.get(`pulseStores/${other}/sales/other-sale-0001`));
  assert.equal((await db.get(`pulseStores/${store}/sales/~summary-goals~`)).data.revision,'goal-revision');
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,20);
  assert.equal((await db.get(`pulseAccess/${uid}`)).data.version,'version-reset');
  assert.equal((await req('/api/admin/sales/reset','POST',reset,'admin-reset')).body.status,'done');
  assert(await db.get(`pulseStores/${store}/sales/zzz-new-sale-0003`)); // même demande rejouée : aucun nouveau reset
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:oldId},'vendeur-reset')).status,409);
  // Un reset ultérieur est distinct ; l'ancien job ne peut plus l'annuler ni le relancer.
  const second={...reset,jobId:'reset-job-00000002'};
  assert.equal((await req('/api/admin/sales/reset','POST',second,'admin-reset')).body.status,'running');
  assert.equal((await req('/api/admin/sales/reset','POST',reset,'admin-reset')).body.status,'superseded');
  assert.equal((await db.get(`pulseStores/${store}/sales/~sales-reset~`)).data.generation,second.jobId);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'new-after-second-1'},'vendeur-reset')).status,200);
  await Promise.all(waits.splice(0));queued.splice(0); // message perdu : reprise par le cron
  await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
  for(let steps=0;steps<40;steps++) {
    const state=(await req(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,'admin-reset')).body;
    if(state.status==='done')break;
    const index=queued.findIndex(x=>x.kind==='sales-reset');assert(index>=0);
    const msg=makeMessage(queued.splice(index,1)[0]);await worker.queue({messages:[msg]},env);if(msg.retried)queued.push(msg.body);
    if(steps===39)assert.fail('le second reset aurait dû se terminer');
  }
  assert.equal((await req(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,'admin-reset')).body.status,'done');
  assert.equal(await db.get(`pulseStores/${store}/sales/zzz-new-sale-0003`),null);
  assert.equal((await db.get(`pulseStores/${store}/sales/new-after-second-1`)).data.generation,second.jobId);
  assert.equal((await req('/api/admin/sales/reset','POST',reset,'admin-reset')).body.status,'superseded');
  assert(await db.get(`pulseStores/${store}/sales/new-after-second-1`));
});

test('Reset ventes cloud : une vente en cours ne traverse pas le changement de génération',async()=>{
  const db=new MemoryDb(),queued=[],waits=[];
  const claims={sub:'seller-race',role:'seller',storeId:LEGACY_STORE_ID,sellerId:1,accessVersion:'version-race'};
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>t==='admin'?{sub:'administrator'}:t==='vendeur'?claims:Promise.reject(Error())});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queued.push(...xs.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');
  await db.commit([db.write('pulseAccess/seller-race',{active:true,version:'version-race',storeId:LEGACY_STORE_ID,sellerId:1,sellerKey:'s1'})]);
  let entered,release;const enteredSale=new Promise(r=>entered=r),continueSale=new Promise(r=>release=r),original=db.commit.bind(db);
  db.commit=async writes=>{if(writes.some(w=>w.path===`pulseStores/${LEGACY_STORE_ID}/sales/racing-sale-0001`&&!w.del)){entered();await continueSale;}return original(writes);};
  const sale=req('/api/sales','POST',{serviceId:1,requestId:'racing-sale-0001'},'vendeur');
  await enteredSale;
  const reset=await req('/api/admin/sales/reset','POST',{storeId:LEGACY_STORE_ID,jobId:'racing-reset-0001',confirmation:'SUPPRIMER'},'admin');
  assert.equal(reset.status,200);release();
  assert.equal((await sale).status,409);
  assert.equal(await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/racing-sale-0001`),null);
  assert.equal(await db.get('pulseOutbox/racing-sale-0001'),null);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'next-race-sale-01'},'vendeur')).status,200);
  await Promise.all(waits.splice(0));
});

test('Reset ventes cloud : demandes administrateur simultanées et indisponibilité temporaire de la file',async()=>{
  const db=new MemoryDb(),queued=[];
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>t==='admin'?{sub:'administrator'}:Promise.reject(Error())});
  let queueFails=true;
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){if(queueFails)throw Error('queue down');queued.push(...xs.map(x=>x.body));}}};
  const waits=[],ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');
  const store=LEGACY_STORE_ID,first={storeId:store,jobId:'parallel-reset-0001',confirmation:'SUPPRIMER'},second={...first,jobId:'parallel-reset-0002'};
  const requests=await Promise.all([req('/api/admin/sales/reset','POST',first),req('/api/admin/sales/reset','POST',second)]);
  assert.deepEqual(requests.map(x=>x.status).sort(),[200,409]);
  const active=requests.find(x=>x.status===200).body;
  assert.equal(active.status,'running');assert.equal((await db.get(`pulseStores/${store}/sales/~sales-reset~`)).data.generation,active.jobId);
  assert.equal(queued.length,0);queueFails=false;
  await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
  assert(queued.some(job=>job.kind==='sales-reset'&&job.jobId===active.jobId));
});

test('Reset objectifs cloud : un département, tous services et vendeurs, plannings et ventes intacts',async()=>{
  const db=new MemoryDb(),queued=[],waits=[];
  const store=LEGACY_STORE_ID,uidOf=async(id,st=store)=>`seller-${(await digestBase64(`${st}:${id}`)).slice(0,28)}`;
  const uid=await uidOf(1),identities=new Map([
    ['admin-goals-reset',{sub:'administrator'}],
    ['seller-goals-reset',{sub:uid,role:'seller',storeId:store,sellerId:1,accessVersion:'version-1'}],
  ]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)}});
  let queueDown=false;
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(messages){if(queueDown)throw Error('file inaccessible');queued.push(...messages.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token='admin-goals-reset'){
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:response.status,body:await response.json()};
  }
  const base=(await req('/api/bootstrap')).body,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const catalog=(await db.get('pulse/catalog')).data;
  catalog.sellers.find(s=>s.id===11).departmentId='editorial';
  catalog.sellers.find(s=>s.id===12).active=false;catalog.sellerFlags.s12=false;
  catalog.sellers.push({id:13,name:'Autre magasin',storeId:other,departmentId:'tech',active:true});catalog.sellerFlags.s13=true;catalog.sellerStores.s13=other;catalog.nextSellerId=14;
  const access={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:'version-1'};
  const writes=[db.write('pulse/catalog',catalog),db.write(`pulseAccess/${uid}`,access),db.write(`pulseStatus/${uid}`,access),
    db.write(`pulseStores/${store}/sales/vente-preservee`,{storeId:store,sellerId:1,serviceId:1,businessDate:'2026-11-01'}),
    db.write(`pulseStores/${store}/sales/~summary-goals~`,{revision:'before-reset'})];
  for(let id=1;id<=13;id++) {
    const st=id===13?other:store,person=await uidOf(id,st);
    writes.push(db.write(`pulseGoals/${person}`,{storeId:st,sellerId:id,goals:{s1:{day:null,week:null,month:id,revision:`old-target-${id}`},s2:{day:0,week:null,month:null,revision:`zero-target-${id}`}},workdays:[1,3,6],workdaysRevision:'planning-old',privateField:'preserved'}));
  }
  await db.commit(writes);
  const reset={storeId:store,departmentId:'tech',jobId:'goals-reset-job-0001',confirmation:'SUPPRIMER'};
  assert.equal((await req('/api/admin/goals/reset','POST',reset,'')).status,401);
  assert.equal((await req('/api/admin/goals/reset','POST',{...reset,confirmation:'OUI'})).status,400);
  assert.equal((await req('/api/admin/goals/reset','POST',{...reset,departmentId:'inconnu'})).status,400);
  assert.equal((await req(`/api/admin/goals/reset?storeId=${store}`)).body.status,'idle');
  queueDown=true;
  const started=await req('/api/admin/goals/reset','POST',reset);assert.equal(started.status,200);assert.equal(started.body.status,'running');
  assert.equal(started.body.totalSellers,11);assert.equal(started.body.departmentId,'tech');assert.equal('sellerIds' in started.body,false);
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,1); // aucun lot avant la confirmation traitée
  assert.equal((await req('/api/admin/goals/reset','POST',{...reset,jobId:'goals-reset-job-0002',departmentId:'editorial'})).status,409);
  const target={storeId:store,sellerId:1,serviceId:1,values:{day:null,week:null,month:42},revision:'old-target-1'};
  const blocked=await req('/api/goals','POST',target,'seller-goals-reset');assert.equal(blocked.status,409);assert.match(blocked.body.error,/réinitialisation/);
  // Les objectifs du département voisin restent modifiables durant le reset.
  assert.equal((await req('/api/admin/goals','POST',{...target,sellerId:11,revision:'old-target-11'})).status,200);
  // Une file indisponible après le commit est reprise sans seconde demande.
  queueDown=false;await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
  let message=makeMessage(queued.shift());assert.equal(message.body.kind,'goals-reset');await worker.queue({messages:[message]},env);assert(message.acked);
  let progress=(await req(`/api/admin/goals/reset?storeId=${store}`)).body;assert.equal(progress.processedSellers,10);assert.equal(progress.totalSellers,11);
  assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data.goals,{});
  assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data.workdays,[1,3,6]);assert.equal((await db.get(`pulseGoals/${uid}`)).data.privateField,'preserved');
  assert.notEqual((await db.get(`pulseStatus/${uid}`)).data.goalsRevision,undefined);
  // Le lot déjà traité accepte un nouvel objectif et les lots suivants ne l'effacent pas.
  const fresh=await req('/api/goals','POST',{...target,revision:null},'seller-goals-reset');assert.equal(fresh.status,200);assert.equal(fresh.body.goals.s1.month,42);
  message=makeMessage(queued.shift());await worker.queue({messages:[message]},env);assert(message.acked);
  progress=(await req(`/api/admin/goals/reset?storeId=${store}`)).body;assert.equal(progress.status,'done');assert.equal(progress.processedSellers,11);
  assert.deepEqual((await db.get(`pulseGoals/${await uidOf(12)}`)).data.goals,{}); // vendeur archivé inclus
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,42);
  assert.equal((await db.get(`pulseGoals/${await uidOf(11)}`)).data.goals.s1.month,42);
  assert.equal((await db.get(`pulseGoals/${await uidOf(13,other)}`)).data.goals.s1.month,13);
  assert.equal((await db.get(`pulseStores/${store}/sales/vente-preservee`)).data.sellerId,1);
  assert.equal((await db.get(`pulseAccess/${uid}`)).data.version,'version-1');
  assert.notEqual((await db.get(`pulseStores/${store}/sales/~summary-goals~`)).data.revision,'before-reset');
  // Rejeu et redémarrage : un jobId déjà utilisé ne supprime jamais une nouvelle cible.
  assert.equal((await req('/api/admin/goals/reset','POST',reset)).body.status,'done');
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,42);
  assert.equal((await req('/api/admin/goals/reset','POST',{...reset,departmentId:'editorial'})).status,409);
  const second=await req('/api/admin/goals/reset','POST',{...reset,departmentId:'editorial',jobId:'goals-reset-job-0002'});assert.equal(second.body.totalSellers,1);
  message=makeMessage(queued.shift());await worker.queue({messages:[message]},env);assert(message.acked);
  assert.deepEqual((await db.get(`pulseGoals/${await uidOf(11)}`)).data.goals,{});
  assert.equal((await req('/api/admin/goals/reset','POST',reset)).body.status,'superseded');
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,42);
});

test('Reset objectifs cloud : protection contre une écriture et un planning concurrents',async()=>{
  const db=new MemoryDb(),queue=[];const store=LEGACY_STORE_ID,uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  const identities=new Map([['admin',{sub:'administrator'}],['seller',{sub:uid,role:'seller',storeId:store,sellerId:1,accessVersion:'v1'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error();return identities.get(t)}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token='admin'){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');const access={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:'v1'};
  await db.commit([db.write(`pulseAccess/${uid}`,access),db.write(`pulseStatus/${uid}`,access),db.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:{day:2,week:null,month:null,revision:'ancienne-revision'}},workdays:[1,2,3,4,5],workdaysRevision:'planning-ancien'})]);
  const reset={storeId:store,departmentId:'tech',jobId:'goal-race-reset-001',confirmation:'SUPPRIMER'};
  const original=db.commit.bind(db);let race=true;
  db.commit=async writes=>{
    if(race&&writes.some(w=>w.check&&w.path===`pulseGoalsResets/${store}`)) {race=false;assert.equal((await req('/api/admin/goals/reset','POST',reset)).status,200);}
    return original(writes);
  };
  const saving=await req('/api/goals','POST',{storeId:store,sellerId:1,serviceId:1,values:{day:null,week:null,month:55},revision:'ancienne-revision'},'seller');
  assert.equal(saving.status,409);assert.match(saving.body.error,/réinitialisation/);
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.day,2);
  let workdayRace=true;
  db.commit=async writes=>{
    if(workdayRace&&writes.some(w=>w.path===`pulseGoalsResets/${store}`&&!w.check)) {
      workdayRace=false;const old=(await db.get(`pulseGoals/${uid}`)).data;
      await original([db.write(`pulseGoals/${uid}`,{...old,workdays:[2,6,0],workdaysRevision:'new-planning'})]);
    }
    return original(writes);
  };
  let m=makeMessage(queue.shift());await worker.queue({messages:[m]},env);assert(m.retried);
  m=makeMessage(m.body);await worker.queue({messages:[m]},env);assert(m.acked);
  const final=(await db.get(`pulseGoals/${uid}`)).data;assert.deepEqual(final.goals,{});assert.deepEqual(final.workdays,[2,6,0]);assert.equal(final.workdaysRevision,'new-planning');
});

test('Reset objectifs cloud : confirmations concurrentes et photo du département au démarrage',async()=>{
  const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID,worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>t==='admin'?{sub:'administrator'}:Promise.reject(Error())});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
  const req=async(path,method='GET',body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  await req('/api/bootstrap');
  const uid1=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`,uid2=`seller-${(await digestBase64(`${store}:2`)).slice(0,28)}`;
  await db.commit([db.write(`pulseGoals/${uid1}`,{goals:{s1:{month:10,revision:'revision-1'}}}),db.write(`pulseGoals/${uid2}`,{goals:{s1:{month:20,revision:'revision-2'}}})]);
  // Changement au même instant : la précondition catalogue impose de refaire la sélection.
  const commit=db.commit.bind(db);let race=true;
  db.commit=async writes=>{
    if(race&&writes.some(w=>w.path===`pulseGoalsResets/${store}`&&!w.check)) {
      race=false;const catalog=(await db.get('pulse/catalog')).data;catalog.sellers.find(s=>s.id===2).departmentId='editorial';await commit([db.write('pulse/catalog',catalog)]);
    }
    return commit(writes);
  };
  const body={storeId:store,departmentId:'tech',jobId:'parallel-goal-reset-001',confirmation:'SUPPRIMER'};
  const first=await req('/api/admin/goals/reset','POST',body);assert.equal(first.status,200);
  const state=(await db.get(`pulseGoalsResets/${store}`)).data;assert.equal(state.jobId,first.body.jobId);assert(state.sellerIds.includes(1));assert(!state.sellerIds.includes(2));assert.equal(state.totalSellers,11);
  // Une réaffectation postérieure ne change pas la liste confirmée.
  const updated=(await db.get('pulse/catalog')).data;updated.sellers.find(s=>s.id===1).departmentId='editorial';updated.sellers.find(s=>s.id===2).departmentId='tech';await commit([db.write('pulse/catalog',updated)]);
  while(queue.length){const m=makeMessage(queue.shift());await worker.queue({messages:[m]},env);assert(m.acked);}
  assert.deepEqual((await db.get(`pulseGoals/${uid1}`)).data.goals,{});
  assert.equal((await db.get(`pulseGoals/${uid2}`)).data.goals.s1.month,20);
  const results=await Promise.all([
    req('/api/admin/goals/reset','POST',{...body,jobId:'parallel-goal-reset-002'}),
    req('/api/admin/goals/reset','POST',{...body,departmentId:'editorial',jobId:'parallel-goal-reset-003'}),
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
});

test('Inscription vendeur cloud : prénom, département, PIN à quatre chiffres et rejeu sans doublon',async()=>{
  const db=new MemoryDb(),identities=new Map(),limits=[];
  const worker=createWorker({createDb:()=>db,makeCustomToken:async(_env,sub,claims)=>{const token=`test-token-${sub}`;identities.set(token,{sub,...claims});return token;},verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,12).toString('base64url'),LOGIN_LIMITER:{async limit({key}){limits.push(key);return {success:true};}}};
  const ctx={waitUntil(){}};identities.set('admin',{sub:'administrator'});
  async function req(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  const bootstrap=(await req('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=bootstrap.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const salt='salt-profil-1234567890',proof=await pinProof('demo-fnac',store,null,'4172',salt);
  const body={storeId:store,departmentId:'editorial',name:'  Élodie  ',pinSalt:salt,registrationId:'registration-test-0001',newProof:proof};
  assert.equal((await req('/api/auth/register','POST',{...body,pin:'4172'})).status,400);
  assert.equal((await req('/api/auth/register','POST',{...body,departmentId:'inexistant'})).status,400);
  const created=await req('/api/auth/register','POST',body);assert.equal(created.status,200);assert.equal(created.body.sellerId,13);assert(created.body.customToken);
  const uid=`seller-${(await digestBase64(`${store}:13`)).slice(0,28)}`,access=(await db.get(`pulseAccess/${uid}`)).data;
  assert.equal(access.pinLength,4);assert.equal(access.pinSalt,salt);assert.equal(access.storeId,store);assert(!JSON.stringify(access).includes(proof));assert(!JSON.stringify(access).includes('4172'));
  const c=(await db.get('pulse/catalog')).data,person=c.sellers.find(s=>s.id===13);assert.equal(person.name,'Élodie');assert.equal(person.departmentId,'editorial');
  assert.equal((await req('/api/auth/register','POST',body)).body.sellerId,13);assert.equal((await db.get('pulse/catalog')).data.sellers.length,13);
  assert.equal((await req('/api/auth/register','POST',{...body,registrationId:'registration-test-0002',name:'elodie',departmentId:'tech'})).status,409);
  assert.equal((await req('/api/auth/register','POST',{...body,registrationId:'registration-test-0003',name:'Morgan'})).status,409);
  assert.equal((await req('/api/auth/register','POST',{...body,registrationId:'registration-test-0004',pinSalt:'too-short'})).status,400);
  const status=await req('/api/auth/status','POST',{storeId:store,departmentId:'editorial',sellerId:13});assert.deepEqual(status.body,{needsPin:false,pinLength:4,pinSalt:salt});
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:13,departmentId:'editorial',proof,openPinFlow:true})).status,409);
  const login=await req('/api/auth/login','POST',{storeId:store,sellerId:13,departmentId:'editorial',proof,pinFlowVersion:2,openPinFlow:true});assert.equal(login.status,200);
  assert.equal((await req('/api/goals','GET',undefined,login.body.customToken)).status,200);
  const otherProof=await pinProof('demo-fnac',other,null,'3491','second-profile-salt-12345');
  assert.equal((await req('/api/auth/register','POST',{...body,storeId:other,pinSalt:'second-profile-salt-12345',registrationId:'registration-test-0005',newProof:otherProof})).status,200);
  assert(limits.some(x=>x.startsWith('register-store:')));assert(limits.some(x=>x.startsWith('register-ip:')));
});

test('Inscription régionale : ancien client bloqué sans accord, profil et rejeu préservés',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db,makeCustomToken:async(_env,sub)=>`token-${sub}`});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',PIN_PEPPER:Buffer.alloc(32,11).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  const bootstrap=(await req('/api/bootstrap')).body,region=bootstrap.stores.find(s=>s.name==='Fnac Guadeloupe');
  const pinSalt='salt-region-123456789012',newProof=await pinProof('demo-fnac',region.id,null,'4829',pinSalt);
  const body={storeId:region.id,departmentId:'tech',name:'Alice',pinSalt,newProof,registrationId:'regional-request-00001'};
  const blocked=await req('/api/auth/register',body);assert.equal(blocked.status,400);assert.match(blocked.body.error,/Mettez l’application à jour/);
  assert.equal((await req('/api/auth/register',{...body,regionalConsent:'true'})).status,400);
  assert.equal((await db.get('pulse/catalog')).data.sellers.length,12);
  const created=await req('/api/auth/register',{...body,regionalConsent:true});assert.equal(created.status,200);
  const replay=await req('/api/auth/register',body);assert.equal(replay.status,200);assert.equal(replay.body.sellerId,created.body.sellerId);
  const status=await req('/api/auth/status',{storeId:region.id,departmentId:'tech',sellerId:created.body.sellerId});assert.equal(status.status,200);
  const proof=await pinProof('demo-fnac',region.id,created.body.sellerId,'4829',pinSalt);
  assert.equal((await req('/api/auth/login',{storeId:region.id,departmentId:'tech',sellerId:created.body.sellerId,proof,pinFlowVersion:2,openPinFlow:true})).status,200);
});

test('PIN cloud : transition 8 vers 4 après déconnexion, anciennes sessions et données conservées',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]),store=LEGACY_STORE_ID,project='demo-fnac';
  const worker=createWorker({createDb:()=>db,makeCustomToken:async(_env,sub,claims)=>{const token=`session-${sub}`;identities.set(token,{sub,...claims});return token;},verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,19).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');await req('/api/auth/status','POST',{storeId:store,sellerId:1});
  const oldProof=await pinProof(project,store,1,'73628519'),newProof=await pinProof(project,store,1,'8742'),wrong=await pinProof(project,store,1,'11111111');
  const original=await req('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:oldProof});assert.equal(original.status,200);
  const uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`,before=(await db.get(`pulseAccess/${uid}`)).data,oldToken=original.body.customToken;
  await db.commit([db.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:{month:30,revision:'goal-before'}},workdays:[0,1,4],workdaysRevision:'days-before'}),db.write(`pulseStores/${store}/sales/vente-passee`,{storeId:store,sellerId:1,serviceId:1})]);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId:store,sellerId:1})).body,{needsPin:false});
  assert.equal((await req('/api/auth/pin/change','POST',{storeId:store,sellerId:1,oldProof:wrong,newProof})).status,401);
  const migrated=await req('/api/auth/pin/change','POST',{storeId:store,departmentId:'tech',sellerId:1,oldProof,newProof});assert.equal(migrated.status,200);
  const after=(await db.get(`pulseAccess/${uid}`)).data;assert.equal(after.pinLength,4);assert.equal(after.version,before.version);assert.notEqual(after.pinMac,before.pinMac);
  assert.equal((await req('/api/goals','GET',undefined,oldToken)).status,200);
  assert.equal((await db.get(`pulseGoals/${uid}`)).data.goals.s1.month,30);assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data.workdays,[0,1,4]);assert(await db.get(`pulseStores/${store}/sales/vente-passee`));
  assert.deepEqual((await req('/api/auth/status','POST',{storeId:store,sellerId:1})).body,{needsPin:false,pinLength:4});
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:oldProof,openPinFlow:true,pinFlowVersion:2})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof,openPinFlow:true})).status,409);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof,openPinFlow:true,pinFlowVersion:2})).status,200);
  assert.equal((await req('/api/auth/pin/change','POST',{storeId:store,sellerId:1,oldProof,newProof})).status,200);
  assert.equal((await db.get(`pulseAccess/${uid}`)).data.version,before.version);
});

test('Inscription vendeur cloud : noms identiques simultanés et prénom archivé refusé',async()=>{
  const db=new MemoryDb(),store=LEGACY_STORE_ID,project='demo-fnac',worker=createWorker({createDb:()=>db,makeCustomToken:async()=> 'token'});
  const env={FIREBASE_PROJECT_ID:project,PIN_PEPPER:Buffer.alloc(32,5).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');await req('/api/auth/initialize','POST',{});
  const a={storeId:store,departmentId:'tech',name:'Nouveau Test',registrationId:'concurrent-register-001',pinSalt:'concurrent-salt-00001',newProof:await pinProof(project,store,null,'7593','concurrent-salt-00001')};
  const b={...a,registrationId:'concurrent-register-002',pinSalt:'concurrent-salt-00002',newProof:await pinProof(project,store,null,'2376','concurrent-salt-00002')};
  const results=await Promise.all([req('/api/auth/register','POST',a),req('/api/auth/register','POST',b)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const c=(await db.get('pulse/catalog')).data;assert.equal(c.sellers.filter(s=>s.name==='Nouveau Test').length,1);
  const historic=c.sellers.find(s=>s.name==='Morgan');historic.active=false;c.sellerFlags[`s${historic.id}`]=false;await db.commit([db.write('pulse/catalog',c)]);
  assert.equal((await req('/api/auth/register','POST',{...b,name:'morgan',registrationId:'archived-register-0001'})).status,409);
});

test('PIN cloud : verrouillage partagé des tentatives, y compris reprise d’inscription et migration',async()=>{
  const db=new MemoryDb(),store=LEGACY_STORE_ID,project='demo-fnac',worker=createWorker({createDb:()=>db,makeCustomToken:async()=> 'token'});
  const env={FIREBASE_PROJECT_ID:project,PIN_PEPPER:Buffer.alloc(32,21).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:r.status,body:await r.json()};}
  const salt='lock-test-salt-0000001',good=await pinProof(project,store,null,'4571',salt),bad=await pinProof(project,store,null,'0000',salt);
  const registration={storeId:store,departmentId:'tech',name:'Nathalie Test',registrationId:'registration-lock-0001',pinSalt:salt,newProof:good};
  const created=await req('/api/auth/register',registration);assert.equal(created.status,200);const sellerId=created.body.sellerId;
  const uid=`seller-${(await digestBase64(`${store}:${sellerId}`)).slice(0,28)}`;
  for(let i=0;i<5;i++)assert.equal((await req('/api/auth/register',{...registration,newProof:bad})).status,409);
  assert((await db.get(`pulseAttempts/${uid}`)).data.lockUntil>Date.now());
  assert.equal((await req('/api/auth/register',registration)).status,429);
  assert.equal((await req('/api/auth/login',{storeId:store,sellerId,proof:good,openPinFlow:true,pinFlowVersion:2})).status,429);
  const attempts=(await db.get(`pulseAttempts/${uid}`)).data;await db.commit([db.write(`pulseAttempts/${uid}`,{...attempts,lockUntil:0})]);
  assert.equal((await req('/api/auth/login',{storeId:store,sellerId,proof:good,openPinFlow:true,pinFlowVersion:2})).status,200);
  assert.equal(await db.get(`pulseAttempts/${uid}`),null);
  const old=await pinProof(project,store,1,'89375261'),wrong=await pinProof(project,store,1,'00000000'),next=await pinProof(project,store,1,'6743');
  assert.equal((await req('/api/auth/claim',{storeId:store,sellerId:1,newProof:old})).status,200);
  for(let i=0;i<5;i++)assert.equal((await req('/api/auth/pin/change',{storeId:store,sellerId:1,oldProof:wrong,newProof:next})).status,401);
  assert.equal((await req('/api/auth/pin/change',{storeId:store,sellerId:1,oldProof:old,newProof:next})).status,429);
  assert.equal((await req('/api/auth/login',{storeId:store,sellerId:1,proof:old,openPinFlow:true})).status,429);
});

test('Première revendication cloud : le premier PIN gagne, une autre revendication ne le remplace pas',async()=>{
  const db=new MemoryDb(),store=LEGACY_STORE_ID,project='demo-fnac',worker=createWorker({createDb:()=>db,makeCustomToken:async()=> 'token'});
  const env={FIREBASE_PROJECT_ID:project,PIN_PEPPER:Buffer.alloc(32,10).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return r.status;}
  const good=await pinProof(project,store,1,'2638'),bad=await pinProof(project,store,1,'1194');
  assert.equal(await req('/api/auth/claim',{storeId:store,sellerId:1,newProof:good,pinLength:4}),200);
  assert.equal(await req('/api/auth/claim',{storeId:store,sellerId:1,newProof:bad,pinLength:4}),409);
  assert.equal(await req('/api/auth/login',{storeId:store,sellerId:1,proof:bad,openPinFlow:true,pinFlowVersion:2}),401);
  assert.equal(await req('/api/auth/login',{storeId:store,sellerId:1,proof:good,openPinFlow:true,pinFlowVersion:2}),200);
});

test('PIN cloud : les tentatives simultanées sont réservées avant la vérification',async()=>{
  const db=new MemoryDb(),store=LEGACY_STORE_ID,project='demo-fnac',worker=createWorker({createDb:()=>db,makeCustomToken:async()=> 'token'});
  const env={FIREBASE_PROJECT_ID:project,PIN_PEPPER:Buffer.alloc(32,17).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return r.status;}
  const good=await pinProof(project,store,1,'9472'),bad=await pinProof(project,store,1,'0000');
  assert.equal(await req('/api/auth/claim',{storeId:store,sellerId:1,newProof:good,pinLength:4}),200);
  const results=await Promise.all(Array.from({length:30},()=>req('/api/auth/login',{storeId:store,sellerId:1,proof:bad,pinFlowVersion:2,openPinFlow:true})));
  assert.equal(results.filter(x=>x===401).length,5);assert.equal(results.filter(x=>x===429).length,25);
  assert.equal(await req('/api/auth/login',{storeId:store,sellerId:1,proof:good,pinFlowVersion:2,openPinFlow:true}),429);
});

test('PIN à quatre chiffres : reset ciblé administrateur, nouvelle revendication et objectifs conservés',async()=>{
  const db=new MemoryDb(),ids=new Map([['admin',{sub:'administrator'}]]),store=LEGACY_STORE_ID,project='demo-fnac';
  const worker=createWorker({createDb:()=>db,makeCustomToken:async(_env,uid,claims)=>{const t=`token-${claims.accessVersion}`;ids.set(t,{sub:uid,...claims});return t;},verifyIdToken:async(_env,t)=>{if(!ids.has(t))throw Error();return ids.get(t)}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,11).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  const salt='pin-reset-salt-00000001',proof=await pinProof(project,store,null,'4162',salt),registration={storeId:store,departmentId:'tech',name:'Marie Reset',registrationId:'pin-reset-test-0001',pinSalt:salt,newProof:proof};
  const created=await req('/api/auth/register','POST',registration);assert.equal(created.status,200);const sellerId=created.body.sellerId,oldToken=created.body.customToken;
  const uid=`seller-${(await digestBase64(`${store}:${sellerId}`)).slice(0,28)}`;
  await db.commit([db.write(`pulseGoals/${uid}`,{storeId:store,sellerId,goals:{s1:{month:24,revision:'old-goal'}}})]);
  assert.equal((await req('/api/admin/pin-reset','POST',{storeId:store,sellerId},'admin')).status,200);
  assert.equal((await req('/api/goals','GET',undefined,oldToken)).status,403);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId:store,sellerId})).body,{needsPin:true});
  const newProof=await pinProof(project,store,sellerId,'6741');
  const claimed=await req('/api/auth/claim','POST',{storeId:store,sellerId,newProof,pinLength:4});assert.equal(claimed.status,200);
  assert.deepEqual((await req('/api/auth/status','POST',{storeId:store,sellerId})).body,{needsPin:false,pinLength:4});
  assert.equal((await req('/api/goals','GET',undefined,claimed.body.customToken)).body.goals.s1.month,24);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId,proof:newProof,openPinFlow:true,pinFlowVersion:2})).status,200);
});

test('Suppression vendeur cloud : ciblage, accès révoqué, lots, reprise, sauvegardes et données voisines préservées',async()=>{
  const db=new MemoryDb(),queue=[],waits=[],sent=[];
  const store=LEGACY_STORE_ID,uidOf=async(sid,st=store)=>`seller-${(await digestBase64(`${st}:${sid}`)).slice(0,28)}`;
  const targetUid=await uidOf(1),otherUid=await uidOf(2);
  const ids=new Map([['admin',{sub:'administrator'}],['target',{sub:targetUid,role:'seller',storeId:store,sellerId:1,accessVersion:'v1'}],
    ['other',{sub:otherUid,role:'seller',storeId:store,sellerId:2,accessVersion:'v2'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>{if(!ids.has(token))throw Error('auth');return ids.get(token)},sendFcm:async(...args)=>sent.push(args)});
  let queueDown=false;
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,9).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}},
    PULSE_QUEUE:{async sendBatch(messages){if(queueDown)throw Error('file interrompue');queue.push(...messages.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function req(path,method='GET',body,token='admin') {
    const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:r.status,body:await r.json()};
  }
  const base=(await req('/api/bootstrap')).body,otherStore=base.stores.find(x=>x.name==='Fnac Bordeaux').id;
  const catalog=(await db.get('pulse/catalog')).data,targetName=catalog.sellers.find(s=>s.id===1).name;
  const targetAccess={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:'v1',pinMac:'confidential'},otherAccess={active:true,storeId:store,sellerId:2,sellerKey:'s2',version:'v2',pinMac:'other-mac'};
  const recipientToken='test-token-other-device-1234567890',recipientId=await digestBase64(recipientToken);
  const writes=[db.write(`pulseAccess/${targetUid}`,targetAccess),db.write(`pulseStatus/${targetUid}`,targetAccess),
    db.write(`pulseAccess/${otherUid}`,otherAccess),db.write(`pulseStatus/${otherUid}`,otherAccess),
    db.write(`pulseGoals/${targetUid}`,{storeId:store,sellerId:1,goals:{s1:{month:42}},workdays:[1,3,6]}),
    db.write(`pulseGoals/${otherUid}`,{storeId:store,sellerId:2,goals:{s1:{month:17}},workdays:[2,4]}),
    db.write(`pulseAttempts/${targetUid}`,{failures:2,lastFailure:Date.now()}),
    db.write(`pulseTokens/${recipientId}`,{uid:otherUid,token:recipientToken,storeId:store,accessVersion:'v2'}),
    db.write('pulseRegistrations/other-registration',{uid:otherUid,name:'Autre',storeId:store}),
    db.write('pulseBackups/catalog-before-store-scoping-v1',{savedAt:'avant',catalog:{...catalog,sellers:catalog.sellers.map(({storeId,...s})=>s)}}),
    db.write('pulseBackups/catalog-monthly-test',{savedAt:'après',catalog}),
    db.write(`pulseStores/${store}/sales/other-sale-0001`,{id:'other-sale-0001',storeId:store,sellerId:2,serviceId:1,businessDate:parisToday(),createdAt:new Date().toISOString(),departmentId:'tech',source:'sale'}),
    db.write(`pulseStores/${otherStore}/sales/other-store-sale`,{id:'other-store-sale',storeId:otherStore,sellerId:13,serviceId:1,businessDate:'2025-01-01'}),
  ];
  for(let i=0;i<45;i++) {
    const id=`target-sale-${String(i).padStart(3,'0')}`;
    writes.push(db.write(`pulseStores/${store}/sales/${id}`,{id,storeId:store,sellerId:1,ownerUid:targetUid,serviceId:1,businessDate:i%2?'2020-01-01':parisToday(),createdAt:new Date().toISOString(),departmentId:i%3?'tech':'editorial',source:i%5?'sale':'adjustment',deletedAt:i%7?null:'2026-01-01'}));
    if(i%5)writes.push(db.write(`pulseOutbox/${id}`,{saleId:id,storeId:store,departmentId:'tech',sellerName:targetName,serviceName:'DMax',status:'queued',createdAt:Date.now()}));
  }
  for(let i=0;i<23;i++)writes.push(db.write(`pulseTokens/target-token-${String(i).padStart(3,'0')}`,{uid:targetUid,storeId:store,token:`token-${i}`}));
  for(let i=0;i<22;i++)writes.push(db.write(`pulseRegistrations/target-request-${String(i).padStart(3,'0')}`,{uid:targetUid,storeId:store,name:targetName,pinSalt:'private-salt',sellerId:1}));
  await db.commit(writes);
  const deletion={storeId:store,sellerId:1,jobId:'seller-delete-job-0001',expectedName:targetName,expectedDepartmentId:'tech',expectedStoreName:base.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
  assert.equal((await req('/api/admin/sellers/delete','POST',deletion,'')).status,401);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,confirmation:'OUI'})).status,400);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,storeId:otherStore})).status,400);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,expectedName:'Nom périmé'})).status,409);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,expectedDepartmentId:'editorial'})).status,409);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,expectedStoreName:'Magasin périmé'})).status,409);
  assert.equal((await db.get(`pulseAccess/${targetUid}`)).data.active,true);
  assert.equal((await req(`/api/admin/sellers/delete?storeId=${store}`)).body.status,'idle');
  queueDown=true;
  const originalWarn=console.warn;let started;
  try {console.warn=()=>{};started=await req('/api/admin/sellers/delete','POST',deletion);}finally{console.warn=originalWarn;}
  assert.equal(started.status,200);assert.equal(started.body.status,'running');assert.equal(started.body.sellerName,targetName);
  assert.equal((await db.get(`pulseAccess/${targetUid}`)).data.active,false);assert.equal((await db.get(`pulseStatus/${targetUid}`)).data.active,false);
  assert.equal(await db.get(`pulseGoals/${targetUid}`),null);assert.equal(await db.get(`pulseAttempts/${targetUid}`),null);
  assert((await db.get('pulse/catalog')).data.sellers.find(s=>s.id===1).deletingJob);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'target-after-delete-1'},'target')).status,403);
  assert.equal((await req('/api/goals','GET',undefined,'target')).status,403);
  assert.equal((await req('/api/admin/entities/sellers/1','PATCH',{storeId:store,active:true})).status,409);
  assert.equal((await req('/api/admin/entities/sellers','POST',{name:targetName,storeId:store})).status,409);
  assert.equal((await req('/api/admin/sales/reset','POST',{storeId:store,jobId:'sales-blocked-job-1',confirmation:'SUPPRIMER'})).status,409);
  assert.equal((await req('/api/admin/goals/reset','POST',{storeId:store,departmentId:'tech',jobId:'goals-blocked-job-1',confirmation:'SUPPRIMER'})).status,409);
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,jobId:'seller-delete-job-0002',sellerId:2})).status,409);
  const sales=await db.query(`pulseStores/${store}/sales`);
  const visible=summarize((await db.get('pulse/catalog')).data,sales.map(x=>x.data),2,parisToday(),store);
  assert.equal(visible.day.total,1);assert.equal(visible.mineTotal,1);assert.equal(visible.leaderboard[0].id,2);
  // Un message en attente de la personne supprimée n'est plus envoyé.
  const notification=makeMessage({saleId:'target-sale-001',tokenId:recipientId,storeId:store});
  await worker.queue({messages:[notification]},env);assert(notification.acked);assert.equal(sent.length,0);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'other-new-sale-0001'},'other')).status,200);
  await Promise.all(waits.splice(0));
  assert.equal((await db.get(`pulseGoals/${otherUid}`)).data.goals.s1.month,17);
  // Le cron reprend le travail lorsque le message initial et la réponse sont perdus.
  queueDown=false;await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
  let steps=0;
  while(queue.some(x=>x.kind==='seller-delete')) {
    assert(++steps<100);const index=queue.findIndex(x=>x.kind==='seller-delete'),message=makeMessage(queue.splice(index,1)[0]);
    await worker.queue({messages:[message]},env);assert(message.acked,`lot ${steps} non acquitté`);
  }
  const done=(await req(`/api/admin/sellers/delete?storeId=${store}`)).body;
  assert.equal(done.status,'done');assert.equal(done.deletedSales,45);assert.equal('sellerName' in done,false);
  const final=(await db.get('pulse/catalog')).data;
  assert.equal(final.sellers.some(s=>s.id===1),false);assert(final.sellers.some(s=>s.id===2));
  for(const path of [`pulseAccess/${targetUid}`,`pulseStatus/${targetUid}`,`pulseGoals/${targetUid}`,`pulseAttempts/${targetUid}`])assert.equal(await db.get(path),null,path);
  assert.equal((await db.query('pulseTokens','uid','EQUAL',targetUid)).length,0);
  assert.equal((await db.query('pulseRegistrations','uid','EQUAL',targetUid)).length,0);
  assert.deepEqual((await db.get('pulseRegistrations/target-request-000')).data,{status:'removed'});
  assert.deepEqual((await db.get('pulseOutbox/target-sale-001')).data,{status:'reset'});
  assert.deepEqual((await db.get('pulseOutbox/target-sale-000')).data,{status:'reset'}); // ancienne correction sans outbox
  assert.equal((await db.query(`pulseStores/${store}/sales`,'sellerId','EQUAL',1)).length,0);
  assert((await db.get(`pulseStores/${otherStore}/sales/other-store-sale`)));assert((await db.get(`pulseStores/${store}/sales/other-sale-0001`)));
  assert.deepEqual((await db.get(`pulseGoals/${otherUid}`)).data.goals,{s1:{month:17}});
  assert.deepEqual((await db.get(`pulseAccess/${otherUid}`)).data,otherAccess);
  assert((await db.get(`pulseTokens/${recipientId}`)));assert((await db.get('pulseRegistrations/other-registration')));
  for(const id of ['catalog-before-store-scoping-v1','catalog-monthly-test']) {
    const saved=(await db.get(`pulseBackups/${id}`)).data.catalog;
    assert.equal(saved.sellers.some(s=>s.id===1),false);assert(saved.sellers.some(s=>s.id===2));
    assert.equal(saved.sellerFlags.s1,undefined);assert.equal(saved.sellerStores.s1,undefined);
  }
  assert.equal((await req('/api/admin/sellers/delete','POST',deletion)).body.status,'done');
  assert.equal((await req('/api/admin/sellers/delete','POST',{...deletion,sellerId:2})).status,409);
  const recreated=await req('/api/admin/entities/sellers','POST',{name:targetName,storeId:store});assert.equal(recreated.status,200);assert.notEqual(recreated.body.id,1);
  assert.equal((await req('/api/admin/sellers/delete','POST',deletion)).body.status,'done');
  assert((await db.get('pulse/catalog')).data.sellers.some(s=>s.id===recreated.body.id));
});

test('Suppression vendeur cloud : empêche les écritures en cours de recréer les données supprimées',async()=>{
  for(const type of ['goal','workdays','sale','adjust','token','pin']) {
    const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID,person=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
    const identities=new Map([['admin',{sub:'administrator'}],['seller',{sub:person,role:'seller',storeId:store,sellerId:1,accessVersion:'v1'}]]);
    const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,10).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}},PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}};
    const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error();return identities.get(t)},makeCustomToken:async()=> 'custom'}),ctx={waitUntil(){}};
    async function req(path,method='GET',body,token='admin') {const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
    await req('/api/bootstrap');const proof=await pinProof('demo-fnac',store,1,'18273645');
    const access={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:'v1',pinMac:await pinMac(env,person,proof)};
    await db.commit([db.write(`pulseAccess/${person}`,access),db.write(`pulseStatus/${person}`,access)]);
    const deletion={storeId:store,sellerId:1,jobId:`seller-race-${type}-0001`,confirmation:'SUPPRIMER'};
    const original=db.commit.bind(db);let raced=false;
    db.commit=async writes=>{
      const matches=type==='goal'||type==='workdays'?writes.some(w=>w.path===`pulseGoals/${person}`&&!w.check):
        type==='sale'||type==='adjust'?writes.some(w=>w.path.startsWith(`pulseStores/${store}/sales/`)&&!w.check&&!w.del&&w.data?.sellerId===1):
        type==='token'?writes.some(w=>w.path.startsWith('pulseTokens/')&&!w.check):writes.some(w=>w.path===`pulseAttempts/${person}`&&!w.check);
      if(!raced&&matches){raced=true;const started=await req('/api/admin/sellers/delete','POST',deletion);assert.equal(started.status,200);}
      return original(writes);
    };
    let response;
    if(type==='goal')response=await req('/api/admin/goals','POST',{storeId:store,sellerId:1,serviceId:1,values:{day:1,week:null,month:null},revision:null});
    else if(type==='workdays')response=await req('/api/admin/workdays','POST',{storeId:store,sellerId:1,workdays:[1,2],revision:null});
    else if(type==='sale')response=await req('/api/sales','POST',{serviceId:1,requestId:'race-sale-00000001'},'seller');
    else if(type==='adjust')response=await req('/api/admin/adjust','POST',{storeId:store,sellerId:1,serviceId:1,count:1});
    else if(type==='token')response=await req('/api/push/subscribe','POST',{token:'race-notification-token-123456789'},'seller');
    else response=await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof},'');
    assert(raced,`${type} non déclenché`);assert([409,429].includes(response.status),`${type}: ${response.status}`);
    assert.equal(await db.get(`pulseGoals/${person}`),null,type);
    assert.equal((await db.query('pulseTokens','uid','EQUAL',person)).length,0,type);
    assert.equal((await db.query(`pulseStores/${store}/sales`,'sellerId','EQUAL',1)).length,0,type);
    assert.equal(await db.get(`pulseAttempts/${person}`),null,type);
    let n=0;while(queue.length){assert(++n<30);const message=makeMessage(queue.shift());await worker.queue({messages:[message]},env);assert(message.acked);}
    assert.equal((await db.get(`pulseSellerDeletes/${store}`)).data.status,'done',type);
    assert.equal(await db.get(`pulseGoals/${person}`),null,type);
  }
});

test('Suppression vendeur cloud : les resets en cours bloquent le lancement, y compris pour un vendeur archivé',async()=>{
  for(const resetType of ['sales','goals']) {
    const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID,ids=new Map([['admin',{sub:'administrator'}]]);
    const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>ids.get(t)}),env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
    async function req(path,method='GET',body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
    await req('/api/bootstrap');assert.equal((await req('/api/admin/entities/sellers/1','PATCH',{storeId:store,active:false})).status,200);
    const reset={storeId:store,jobId:`reset-${resetType}-123456`,confirmation:'SUPPRIMER',...(resetType==='goals'?{departmentId:'tech'}:{})};
    assert.equal((await req(`/api/admin/${resetType}/reset`,'POST',reset)).status,200);
    const deletion={storeId:store,sellerId:1,jobId:`archived-${resetType}-1234`,confirmation:'SUPPRIMER'};
    assert.equal((await req('/api/admin/sellers/delete','POST',deletion)).status,409);
    let n=0;while(queue.length){assert(++n<30);const m=makeMessage(queue.shift());await worker.queue({messages:[m]},env);assert(m.acked);}
    assert.equal((await req('/api/admin/sellers/delete','POST',deletion)).status,200);
    n=0;while(queue.length){assert(++n<30);const m=makeMessage(queue.shift());await worker.queue({messages:[m]},env);assert(m.acked);}
    assert.equal((await db.get('pulse/catalog')).data.sellers.some(s=>s.id===1),false);
  }
});

test('Chiffres du jour : total personnel sur tous les départements, équipe sur le département actuel',()=>{
  const catalog={sellers:[{id:1,name:'A',active:true,storeId:'test',departmentId:'tech'},{id:2,name:'B',active:true,storeId:'test',departmentId:'tech'}],services:[{id:1,name:'DMax',active:true}],departmentsByStore:{test:[{id:'tech',name:'Technique',active:true},{id:'editorial',name:'Éditorial',active:true}]}};
  const sale=(id,sellerId,departmentId)=>({id,sellerId,departmentId,serviceId:1,businessDate:'2026-11-01',createdAt:'2026-11-01T12:00:00Z',source:'sale'});
  const out=summarize(catalog,[sale('a',1,'tech'),sale('b',1,'editorial'),sale('c',2,'tech')],1,'2026-11-01','test');
  assert.equal(out.mineTotal,2);assert.equal(out.day.total,2);assert.deepEqual(out.mine,[{serviceId:1,count:1}]);
});

test('Suppression vendeur cloud : un lot en conflit est rejoué sans effacement partiel',async()=>{
  const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID;
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})}),env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
  async function req(path,method='GET',body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
  await req('/api/bootstrap');
  await db.commit([db.write(`pulseStores/${store}/sales/conflict-sale-001`,{id:'conflict-sale-001',storeId:store,sellerId:1}),db.write('pulseOutbox/conflict-sale-001',{saleId:'conflict-sale-001',storeId:store,status:'queued',sellerName:'Alice'})]);
  const job={storeId:store,sellerId:1,jobId:'seller-conflict-0001',confirmation:'SUPPRIMER'};assert.equal((await req('/api/admin/sellers/delete','POST',job)).status,200);
  const original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseOutbox/conflict-sale-001')) {
      raced=true;const outbox=(await db.get('pulseOutbox/conflict-sale-001')).data;
      await original([db.write('pulseOutbox/conflict-sale-001',{...outbox,status:'dispatching'})]);
    }
    return original(writes);
  };
  const first=makeMessage(queue.shift());await worker.queue({messages:[first]},env);assert(first.retried);assert(raced);
  assert(await db.get(`pulseStores/${store}/sales/conflict-sale-001`));assert.equal((await db.get(`pulseSellerDeletes/${store}`)).data.deletedSales,0);
  const retry=makeMessage(first.body);await worker.queue({messages:[retry]},env);assert(retry.acked);
  let count=0;while(queue.length){assert(++count<30);const message=makeMessage(queue.shift());await worker.queue({messages:[message]},env);assert(message.acked);}
  assert.equal((await db.get(`pulseSellerDeletes/${store}`)).data.status,'done');assert.equal(await db.get(`pulseStores/${store}/sales/conflict-sale-001`),null);
  assert.deepEqual((await db.get('pulseOutbox/conflict-sale-001')).data,{status:'reset'});
});

test('Suppression vendeur cloud : arbitrage atomique avec les resets lancés simultanément',async()=>{
  for(const resetType of ['sales','goals'])for(const winner of ['reset','delete']) {
    const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID;
    const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})}),env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
    async function req(path,method='GET',body){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};}
    await req('/api/bootstrap');const deletion={storeId:store,sellerId:1,jobId:`seller-lock-${resetType}-${winner}`,confirmation:'SUPPRIMER'},reset={storeId:store,jobId:`reset-lock-${resetType}-${winner}`,confirmation:'SUPPRIMER',...(resetType==='goals'?{departmentId:'tech'}:{})};
    const resetPath=`/api/admin/${resetType}/reset`,doc=resetType==='sales'?`pulseSalesResets/${store}`:`pulseGoalsResets/${store}`,original=db.commit.bind(db);let raced=false;
    db.commit=async writes=>{
      const match=winner==='reset'?writes.some(w=>w.path===`pulseSellerDeletes/${store}`&&!w.check):writes.some(w=>w.path===doc&&!w.check);
      if(!raced&&match){raced=true;const result=winner==='reset'?await req(resetPath,'POST',reset):await req('/api/admin/sellers/delete','POST',deletion);assert.equal(result.status,200);}
      return original(writes);
    };
    const result=winner==='reset'?await req('/api/admin/sellers/delete','POST',deletion):await req(resetPath,'POST',reset);
    assert(raced);assert.equal(result.status,409,`${resetType}/${winner}`);
    if(winner==='reset')assert.equal(await db.get(`pulseSellerDeletes/${store}`),null);else assert.equal(await db.get(doc),null);
  }
});

test('Suppression service cloud : magasin isolé, ventes et objectifs ciblés, reprise et réactivation sans historique',async()=>{
  const db=new MemoryDb(),queue=[],sent=[],waits=[],identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error('no');return identities.get(t);},sendFcm:async(_e,token)=>sent.push(token)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(items){queue.push(...items.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  const req=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const base=(await req('/api/bootstrap','GET',undefined,'')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const storeName=base.stores.find(s=>s.id===store).name,serviceName=base.services.find(s=>s.id===1).name;
  const uid=async(st,id)=>`seller-${(await digestBase64(`${st}:${id}`)).slice(0,28)}`;
  const a=await uid(store,1),archived=await uid(store,2),b=await uid(other,13),orphan=await uid(store,999),peer=await uid(store,3);
  const c=(await db.get('pulse/catalog')).data;c.sellers.find(s=>s.id===2).active=false;c.sellerFlags.s2=false;
  c.sellers.push({id:13,name:'Autre magasin',active:true,storeId:other,departmentId:'tech'});c.sellerFlags.s13=true;c.sellerStores.s13=other;c.nextSellerId=14;
  const goal=(month,rev)=>({day:null,week:null,month,revision:rev});
  await db.commit([
    db.write('pulse/catalog',c),db.write(`pulseAccess/${a}`,{active:true,storeId:store,sellerId:1,version:'v1'}),
    db.write(`pulseStatus/${a}`,{active:true,storeId:store,sellerId:1,version:'v1',goalsRevision:'old-a'}),
    db.write(`pulseAccess/${b}`,{active:true,storeId:other,sellerId:13,version:'v13'}),
    db.write(`pulseAccess/${peer}`,{active:true,storeId:store,sellerId:3,version:'v3'}),
    db.write(`pulseGoals/${a}`,{storeId:store,sellerId:1,goals:{s1:goal(30,'goal-a-0001'),s2:goal(8,'goal-a-0002')},workdays:[1,3,5],workdaysRevision:'days-a-001'}),
    db.write(`pulseGoals/${archived}`,{goals:{s1:goal(11,'goal-old-01'),s2:goal(7,'goal-old-02')},workdays:[0,1]}),
    db.write(`pulseGoals/${b}`,{storeId:other,sellerId:13,goals:{s1:goal(99,'goal-b-0001')},workdays:[2,4]}),
    db.write(`pulseGoals/${orphan}`,{storeId:store,sellerId:999,goals:{s1:goal(4,'goal-orphan'),s2:goal(5,'goal-other')},workdays:[2]}),
  ]);
  identities.set('a',{sub:a,role:'seller',storeId:store,sellerId:1,accessVersion:'v1'});
  identities.set('b',{sub:b,role:'seller',storeId:other,sellerId:13,accessVersion:'v13'});
  const date=parisToday(),sales=[];
  for(let i=0;i<26;i++)sales.push(db.write(`pulseStores/${store}/sales/service-one-${String(i).padStart(4,'0')}`,{id:`service-one-${String(i).padStart(4,'0')}`,storeId:store,sellerId:i%2?2:1,departmentId:i%2?'editorial':'tech',serviceId:1,businessDate:i%3?date:'2020-01-01',createdAt:'2026-01-01T12:00:00Z',deletedAt:i===1?'ancien':null,source:i===2?'adjustment':'sale'}));
  const shared='shared-sale-0001';
  sales.push(db.write(`pulseStores/${store}/sales/${shared}`,{id:shared,storeId:store,sellerId:1,serviceId:1,businessDate:date,createdAt:'2026-01-01T12:00:00Z'}),
    db.write(`pulseStores/${other}/sales/${shared}`,{id:shared,storeId:other,sellerId:13,serviceId:1,businessDate:date}),
    db.write(`pulseOutbox/${shared}`,{saleId:shared,storeId:other,status:'queued',createdAt:Date.now()}),
    db.write(`pulseStores/${store}/sales/other-service-0001`,{id:'other-service-0001',storeId:store,sellerId:1,serviceId:2,businessDate:date,createdAt:'2026-01-01T12:00:00Z'}));
  const pushSale='service-one-0000',token='test-token-peer-1234567890123',tokenId=await digestBase64(token);
  sales.push(db.write(`pulseOutbox/${pushSale}`,{saleId:pushSale,storeId:store,sellerId:1,departmentId:'tech',status:'queued',createdAt:Date.now()}),
    db.write(`pulseTokens/${tokenId}`,{token,uid:peer,storeId:store,accessVersion:'v3'}));
  await db.commit(sales);
  const body={storeId:store,serviceId:1,jobId:'delete-service-job-0001',expectedName:serviceName,expectedStoreName:storeName,confirmation:'SUPPRIMER'};
  assert.equal((await req('/api/admin/services/delete','POST',body,'')).status,401);
  assert.equal((await req('/api/admin/services/delete','POST',{...body,confirmation:'NON'})).status,400);
  assert.equal((await req('/api/admin/services/delete','POST',{...body,expectedStoreName:'Mauvais magasin'})).status,409);
  assert.equal((await req('/api/admin/services/delete','POST',{...body,expectedName:'Mauvais service'})).status,409);
  const started=await req('/api/admin/services/delete','POST',body);assert.equal(started.status,200);assert.equal(started.body.status,'running');
  assert(!(await req(`/api/bootstrap?storeId=${store}`)).body.services.some(s=>s.id===1));
  assert((await req(`/api/bootstrap?storeId=${other}`)).body.services.some(s=>s.id===1));
  assert((await db.get(`pulseStores/${store}/sales/${pushSale}`))); // exclusion immédiate, purge asynchrone
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'new-blocked-sale-1'},'a')).status,400);
  assert.equal((await req('/api/goals','POST',{serviceId:1,values:{day:null,week:null,month:1},revision:'goal-a-0001'},'a')).status,400);
  assert.equal((await req('/api/admin/services/restore','POST',{storeId:store,serviceId:1,expectedName:serviceName,expectedStoreName:storeName})).status,409);
  assert.equal((await req('/api/admin/sales/reset','POST',{storeId:store,jobId:'reset-blocked-0001',confirmation:'SUPPRIMER'})).status,409);
  assert.equal((await req('/api/admin/goals/reset','POST',{storeId:store,departmentId:'tech',jobId:'goals-blocked-0001',confirmation:'SUPPRIMER'})).status,409);
  assert.equal((await req('/api/admin/sellers/delete','POST',{storeId:store,sellerId:1,jobId:'seller-blocked-0001',confirmation:'SUPPRIMER'})).status,409);
  const notification=makeMessage({saleId:pushSale,storeId:store,tokenId});await worker.queue({messages:[notification]},env);assert(notification.acked);assert.deepEqual(sent,[]);
  // Le même job confirmé est repris, jamais relancé comme une nouvelle action.
  assert.equal((await req('/api/admin/services/delete','POST',body)).body.jobId,body.jobId);
  const original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===`pulseGoals/${a}`&&w.data?.goals&&!Object.hasOwn(w.data.goals,'s1'))) {
      raced=true;const old=(await db.get(`pulseGoals/${a}`)).data;old.goals.s2=goal(14,'concurrent-goal');old.workdays=[2,4,6];
      await original([db.write(`pulseGoals/${a}`,old)]);
    }
    return original(writes);
  };
  let steps=0,retries=0;
  while(queue.length){const item=queue.shift();if(item.kind!=='service-delete')continue;const msg=makeMessage(item);await worker.queue({messages:[msg]},env);if(msg.retried){retries++;queue.push(item);}else assert(msg.acked);if(++steps>100)throw Error('Job non terminé');}
  assert(raced);assert(retries>=1);
  const finished=(await req(`/api/admin/services/delete?storeId=${store}`)).body;
  assert.equal(finished.status,'done');assert.equal(finished.deletedSales,27);assert.equal(finished.deletedGoals,3);assert.equal(finished.skippedGoals,0);
  assert.equal((await db.get(`pulseGoals/${a}`)).data.goals.s1,undefined);assert.equal((await db.get(`pulseGoals/${a}`)).data.goals.s2.month,14);
  assert.deepEqual((await db.get(`pulseGoals/${a}`)).data.workdays,[2,4,6]);assert.equal((await db.get(`pulseGoals/${archived}`)).data.goals.s1,undefined);
  assert.equal((await db.get(`pulseGoals/${orphan}`)).data.goals.s1,undefined);assert.equal((await db.get(`pulseGoals/${orphan}`)).data.goals.s2.month,5);
  assert.equal((await db.get(`pulseGoals/${b}`)).data.goals.s1.month,99);
  assert.equal(await db.get(`pulseStores/${store}/sales/${pushSale}`),null);assert(await db.get(`pulseStores/${store}/sales/other-service-0001`));
  assert(await db.get(`pulseStores/${other}/sales/${shared}`));assert.equal((await db.get(`pulseOutbox/${shared}`)).data.storeId,other);
  assert.deepEqual((await db.get(`pulseOutbox/${pushSale}`)).data,{status:'reset'});assert((await db.get(`pulseStatus/${a}`)).data.goalsRevision!=='old-a');
  assert((await db.get(`pulseAccess/${a}`)).data.active);assert((await db.get(`pulseAccess/${b}`)).data.active);
  assert.equal((await req('/api/admin/services/restore','POST',{storeId:store,serviceId:1,expectedName:serviceName,expectedStoreName:storeName})).status,200);
  assert((await req(`/api/bootstrap?storeId=${store}`)).body.services.some(s=>s.id===1));
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:pushSale},'a')).status,409); // ancien identifiant neutralisé
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'after-restoration-sale'},'a')).status,200);
  assert.equal((await req('/api/admin/services/delete','POST',body)).body.status,'done');
  assert(await db.get(`pulseStores/${store}/sales/after-restoration-sale`)); // le rejeu n'efface pas de nouvelles ventes
  assert.equal((await req('/api/admin/services/delete','POST',{...body,storeId:other})).status,409);
  await Promise.all(waits);
});

test('Suppression service cloud : verrouillage atomique avec les autres opérations destructives',async()=>{
  const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID,worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(items){queue.push(...items.map(x=>x.body));}}},ctx={waitUntil(){}};
  const req=async(path,method='GET',body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const data=(await req('/api/bootstrap')).body,body={storeId:store,serviceId:1,jobId:'race-service-0001',expectedName:data.services[0].name,expectedStoreName:data.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===`pulseServiceDeletes/${store}`&&!w.check)) {
      raced=true;await commit([db.write(`pulseSalesResets/${store}`,{status:'running',jobId:'other-reset-001'})]);
    }
    return commit(writes);
  };
  assert.equal((await req('/api/admin/services/delete','POST',body)).status,409);assert(raced);
  assert.equal(await db.get(`pulseServiceDeletes/${store}`),null);
  assert((await req(`/api/bootstrap?storeId=${store}`)).body.services.some(s=>s.id===1));
  await commit([db.write(`pulseSalesResets/${store}`,{status:'done',jobId:'other-reset-001'})]);
  for(const path of [`pulseGoalsResets/${store}`,`pulseSellerDeletes/${store}`]) {
    await commit([db.write(path,{status:'running',jobId:'other-work-001'})]);
    assert.equal((await req('/api/admin/services/delete','POST',body)).status,409);
    await commit([db.write(path,{status:'done',jobId:'other-work-001'})]);
  }
  assert.equal((await req('/api/admin/services/delete','POST',body)).body.status,'running');
});

test('Suppression service cloud : anomalie de rattachement préservée, reprise par le cron et réactivation bloquée',async()=>{
  const db=new MemoryDb(),queue=[],waits=[],store=LEGACY_STORE_ID;let unavailable=true;
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(items){if(unavailable)throw Error('queue down');queue.push(...items.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  const req=async(path,method='GET',body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer admin'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const base=(await req('/api/bootstrap')).body,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id,uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  const inconsistent={storeId:other,sellerId:1,goals:{s1:{month:42}},workdays:[0]};await db.commit([db.write(`pulseGoals/${uid}`,inconsistent)]);
  const body={storeId:store,serviceId:1,jobId:'recovery-service-0001',expectedName:base.services[0].name,expectedStoreName:base.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
  const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
  try {assert.equal((await req('/api/admin/services/delete','POST',body)).body.status,'running');} finally {console.warn=warn;}
  assert.equal(queue.length,0);assert(warnings.some(args=>String(args[0]).includes('QUEUE')));
  unavailable=false;await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));assert(queue.some(x=>x.kind==='service-delete'));
  let steps=0;while(queue.length){const job=queue.shift(),msg=makeMessage(job);await worker.queue({messages:[msg]},env);assert(msg.acked);if(++steps>50)throw Error('Job non terminé');}
  const state=(await req(`/api/admin/services/delete?storeId=${store}`)).body;assert.equal(state.status,'needs-review');assert(state.skippedGoals>=1);
  assert.deepEqual((await db.get(`pulseGoals/${uid}`)).data,inconsistent); // autre rattachement jamais écrasé
  assert.equal((await req('/api/admin/services/restore','POST',{storeId:store,serviceId:1,expectedName:body.expectedName,expectedStoreName:body.expectedStoreName})).status,409);
  assert.equal((await req('/api/admin/services/delete','POST',{...body,jobId:'another-service-0001',serviceId:2,expectedName:base.services[1].name})).status,503);
});

test('Suppression service cloud : une vente rejouée pendant son retrait ne reçoit pas de fausse confirmation',async()=>{
  const db=new MemoryDb(),queue=[],store=LEGACY_STORE_ID,requestId='sale-replayed-during-service-removal';
  let uid;const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>t==='seller'?{sub:uid,role:'seller',storeId:store,sellerId:1,accessVersion:'v1'}:{sub:t}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(items){queue.push(...items.map(x=>x.body))}}},ctx={waitUntil(){}};
  const req=async(path,method='GET',body,token='administrator')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const base=(await req('/api/bootstrap')).body;uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;await db.commit([db.write(`pulseAccess/${uid}`,{active:true,version:'v1',storeId:store,sellerId:1})]);
  const sale={storeId:store,sellerId:1,serviceId:1,requestId};assert.equal((await req('/api/sales','POST',sale,'seller')).status,200);
  const remove={storeId:store,serviceId:1,jobId:'service-replay-test-0001',expectedName:base.services[0].name,expectedStoreName:base.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
  const commit=db.commit.bind(db);let started=false;db.commit=async writes=>{if(!started&&writes.some(w=>w.path===`pulseStores/${store}/sales/${requestId}`)){started=true;assert.equal((await req('/api/admin/services/delete','POST',remove)).body.status,'running');}return commit(writes);};
  const replay=await req('/api/sales','POST',sale,'seller');assert.equal(started,true);assert.equal(replay.status,409);
});

test('Historique admin : périodes passées, pagination, corrections individuelles et isolation atomique',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}],['seller',{sub:'seller',role:'seller'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>{if(!identities.has(token))throw Error();return identities.get(token);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  const req=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const base=(await req('/api/bootstrap','GET',undefined,'')).body,store=LEGACY_STORE_ID,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const catalog=(await db.get('pulse/catalog')).data,seller=catalog.sellers.find(s=>s.id===1),storeName=catalog.stores.find(s=>s.id===store).name;
  seller.active=false;catalog.sellerFlags.s1=false; // Un vendeur archivé reste consultable.
  const sale=(id,sellerId,date,extra={})=>({id,storeId:store,sellerId,serviceId:1,departmentId:'tech',businessDate:date,createdAt:`${date}T12:00:00Z`,source:'sale',deletedAt:null,...extra});
  const writes=[db.write('pulse/catalog',catalog),
    db.write(`pulseStores/${store}/sales/a-target-01`,sale('a-target-01',1,'2026-10-29')),
    db.write(`pulseStores/${store}/sales/a-target-02`,sale('a-target-02',1,'2026-10-30',{source:'adjustment',serviceId:2,departmentId:'editorial'})),
    db.write(`pulseStores/${store}/sales/a-previous-1`,sale('a-previous-1',1,'2026-09-30')),
    db.write(`pulseStores/${store}/sales/a-deleted-01`,sale('a-deleted-01',1,'2026-10-29',{deletedAt:'2026-10-29T16:00:00Z'})),
    db.write(`pulseStores/${store}/sales/a-other-user`,sale('a-other-user',2,'2026-10-30')),
    db.write(`pulseStores/${other}/sales/a-target-01`,sale('a-target-01',1,'2026-10-29',{storeId:other})),
    db.write('pulseOutbox/a-target-01',{saleId:'a-target-01',storeId:store,status:'pending'}),
    db.write('pulseOutbox/a-target-02',{saleId:'a-target-02',storeId:store,status:'pending'})];
  for(let i=0;i<205;i++){const id=`z-other-${String(i).padStart(4,'0')}`;writes.push(db.write(`pulseStores/${store}/sales/${id}`,sale(id,2,'2026-10-29')));}
  await db.commit(writes);
  const query=(period,anchor,extra='')=>`/api/admin/sales/history?storeId=${store}&sellerId=1&period=${period}&anchor=${anchor}${extra}`;
  assert.equal((await req(query('day','2026-10-29'),'GET',undefined,'')).status,401);
  assert.equal((await req(query('day','2026-10-29'),'GET',undefined,'seller')).status,403);
  assert.equal((await req(query('day','2026-02-30'))).status,400);
  assert.equal((await req(query('day','2999-01-01'))).status,400);
  assert.equal((await req(`/api/admin/sales/history?storeId=${other}&sellerId=1&period=month&anchor=2026-10-29`)).status,400);
  let first=(await req(query('day','2026-10-29'))).body;assert.deepEqual(first.sales,[]);assert(first.next);
  let second=(await req(query('day','2026-10-29',`&afterDate=${first.next.date}&afterId=${first.next.id}`))).body;
  assert.deepEqual(second.sales.map(s=>s.id),['a-target-01']);assert.equal(second.next,null);
  const month=[];let next=null;do {const result=(await req(query('month','2026-10-29',next?`&afterDate=${next.date}&afterId=${next.id}`:''))).body;month.push(...result.sales);next=result.next;}while(next);
  assert.deepEqual(month.map(s=>s.id).sort(),['a-target-01','a-target-02']);
  const day=(await req(query('day','2026-09-30'))).body;assert.deepEqual(day.sales.map(s=>s.id),['a-previous-1']);
  const body={storeId:store,sellerId:1,period:'day',anchor:'2026-10-29',saleIds:['a-target-01'],requestId:'correction-test-0001',confirmation:'SUPPRIMER',expectedSellerName:seller.name,expectedStoreName:storeName};
  assert.equal((await req('/api/admin/sales/correct','POST',body,'')).status,401);
  for(const period of ['week','month'])assert.equal((await req('/api/admin/sales/correct','POST',{...body,period})).status,400);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,confirmation:''})).status,400);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,saleIds:['a-target-01','a-target-01']})).status,400);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,saleIds:Array.from({length:21},(_,i)=>`sale-${i}`)})).status,400);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,saleIds:['a-target-01','a-other-user']})).status,409);
  assert.equal((await db.get(`pulseStores/${store}/sales/a-target-01`)).data.deletedAt,null);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,saleIds:['a-previous-1']})).status,409);
  const corrected=await req('/api/admin/sales/correct','POST',body);assert.equal(corrected.status,200);assert.equal(corrected.body.deleted,1);
  assert((await db.get(`pulseStores/${store}/sales/a-target-01`)).data.deletedAt);
  assert.equal((await db.get(`pulseStores/${store}/sales/a-target-02`)).data.deletedAt,null);
  assert.equal((await db.get(`pulseStores/${other}/sales/a-target-01`)).data.deletedAt,null);
  assert.deepEqual((await db.get('pulseOutbox/a-target-01')).data,{status:'reset'});
  assert.equal((await db.get('pulseOutbox/a-target-02')).data.status,'pending');
  assert.equal((await req('/api/admin/sales/correct','POST',body)).body.duplicate,true);
  assert.equal((await req('/api/admin/sales/correct','POST',{...body,saleIds:['a-target-02']})).status,409);
  const before=(await db.get(`pulseStores/${store}/sales/a-target-02`)).data;
  const race={...body,anchor:'2026-10-30',saleIds:['a-target-02'],requestId:'correction-race-0001'};
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{if(!raced&&writes.some(w=>w.path==='pulseSalesCorrections/correction-race-0001')){raced=true;await commit([db.write(`pulseStores/${store}/sales/a-target-02`,{...before,serviceId:3})]);}return commit(writes);};
  assert.equal((await req('/api/admin/sales/correct','POST',race)).status,409);
  assert.equal((await db.get(`pulseStores/${store}/sales/a-target-02`)).data.deletedAt,null);
  assert.equal(await db.get('pulseSalesCorrections/correction-race-0001'),null);
});

test('Notifications : une vente corrigée avant ou pendant la mise en file et la consommation reste neutralisée',async()=>{
  const db=new MemoryDb(),sent=[],queued=[],waits=[],store=LEGACY_STORE_ID;
  const claims={role:'seller',sub:'author-race',storeId:store,sellerId:1,accessVersion:'v1'};
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>token==='admin'?{sub:'administrator'}:claims,
    sendFcm:async(_env,token)=>sent.push(token)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(messages){queued.push(...messages.map(m=>m.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  const req=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const base=(await req('/api/bootstrap')).body,storeName=base.stores.find(s=>s.id===store).name,date=parisToday();
  const token='notification-token-peer-correction-test-0001',tokenId=await digestBase64(token);
  await db.commit([db.write('pulseAccess/author-race',{active:true,storeId:store,sellerId:1,version:'v1'}),
    db.write('pulseAccess/peer-race',{active:true,storeId:store,sellerId:2,version:'v2'}),
    db.write(`pulseTokens/${tokenId}`,{token,uid:'peer-race',storeId:store,accessVersion:'v2'})]);
  const sale=id=>({id,storeId:store,sellerId:1,departmentId:'tech',serviceId:1,createdAt:new Date().toISOString(),businessDate:date,source:'sale',deletedAt:null});
  const outbox=id=>({saleId:id,storeId:store,sellerId:1,departmentId:'tech',status:'queued',createdAt:Date.now(),sellerName:'Morgan',serviceName:'DMax'});
  const correction=(id,requestId)=>({storeId:store,sellerId:1,period:'day',anchor:date,saleIds:[id],requestId,confirmation:'SUPPRIMER',expectedSellerName:'Morgan',expectedStoreName:storeName});
  const consume=async id=>{const msg=makeMessage({saleId:id,storeId:store,tokenId});await worker.queue({messages:[msg]},env);assert(msg.acked);};
  // Défense supplémentaire si une ancienne outbox existe alors que la vente est déjà tombstonée.
  const deleted='push-deleted-00001';await db.commit([db.write(`pulseStores/${store}/sales/${deleted}`,{...sale(deleted),deletedAt:new Date().toISOString()}),db.write(`pulseOutbox/${deleted}`,outbox(deleted))]);
  await consume(deleted);assert.deepEqual(sent,[]);
  // Correction précisément entre la première lecture et l'appel FCM.
  const racing='push-racing-000001';await db.commit([db.write(`pulseStores/${store}/sales/${racing}`,sale(racing)),db.write(`pulseOutbox/${racing}`,outbox(racing))]);
  const getMany=db.getMany.bind(db);let consumeRace=true;
  db.getMany=async paths=>{if(consumeRace&&paths.length===3&&paths[0]===`pulseStores/${store}/sales/${racing}`){consumeRace=false;assert.equal((await req('/api/admin/sales/correct','POST',correction(racing,'correction-push-0001'))).status,200);}return getMany(paths);};
  await consume(racing);assert.equal(consumeRace,false);assert.deepEqual(sent,[]);assert.deepEqual((await db.get(`pulseOutbox/${racing}`)).data,{status:'reset'});
  // Une autre vente correcte est envoyée une seule fois au collègue.
  const normal='push-normal-000001';await db.commit([db.write(`pulseStores/${store}/sales/${normal}`,sale(normal)),db.write(`pulseOutbox/${normal}`,outbox(normal))]);
  await consume(normal);await consume(normal);assert.deepEqual(sent,[token]);
  // Correction pendant que la mise en file lit les appareils : aucun message en file.
  const query=db.query.bind(db);let dispatchRace=true;
  db.query=async(path,...args)=>{if(dispatchRace&&path==='pulseTokens'){dispatchRace=false;assert.equal((await req('/api/admin/sales/correct','POST',correction('push-dispatch-0001','correction-push-0002'))).status,200);}return query(path,...args);};
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'push-dispatch-0001'},'seller')).status,200);await Promise.all(waits.splice(0));
  assert.equal(dispatchRace,false);assert(!queued.some(m=>m.saleId==='push-dispatch-0001'));assert.deepEqual((await db.get('pulseOutbox/push-dispatch-0001')).data,{status:'reset'});
});

test('Administrateurs cloud : identité signée, confirmation e-mail, droits côté serveur et compte racine préservé',async()=>{
  const db=new MemoryDb(),identities=new Map(),now=Math.floor(Date.now()/1000);
  const user=(sub,extra={})=>({sub,auth_time:now,email:`${sub}@example.test`,email_verified:true,firebase:{sign_in_provider:'password'},...extra});
  const root='root-session-token-0000001',oldRoot='root-old-session-token-0001',seller='seller-session-token-000001',ordinary='ordinary-session-token-0001';
  const newbie='new-admin-session-token-001',newbieVerified='verified-admin-token-000001',second='second-admin-token-0000001',sellerPassword='seller-password-token-00001';
  identities.set(root,user('root-admin'));identities.set(oldRoot,{sub:'root-admin',auth_time:now-1000});
  identities.set(seller,user('seller-uid',{role:'seller'}));identities.set(ordinary,user('ordinary-uid'));
  identities.set(newbie,user('new-admin',{email_verified:false}));identities.set(newbieVerified,user('new-admin'));identities.set(second,user('second-admin'));
  identities.set(sellerPassword,user('seller-uid'));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error('signature');return identities.get(t);}});
  const env={ADMIN_UID:'root-admin',FIREBASE_PROJECT_ID:'demo-fnac',ALLOWED_ORIGIN:'https://example.test'},ctx={waitUntil(){}};
  async function call(path,token,body,origin='https://example.test') {
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{origin,...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:res.status,json:await res.json()};
  }
  await call('/api/bootstrap');const before=(await db.get('pulse/catalog')).data;
  await db.commit([db.write('pulseAccess/seller-uid',{active:true,pinMac:'préservé',storeId:LEGACY_STORE_ID,sellerId:1,version:'v1'})]);
  assert.equal((await call('/api/admin/all',oldRoot)).status,200); // le compte actuel n'est pas migré
  assert.equal((await call('/api/admin/all',ordinary)).status,403);
  assert.equal((await call('/api/admin/administrators',ordinary,{userToken:newbie})).status,403);
  assert.equal((await call('/api/admin/administrators',seller,{userToken:newbie})).status,403);
  assert.equal((await call('/api/admin/administrators',null,{userToken:newbie})).status,401);
  assert.equal((await call('/api/admin/administrators',root,{userToken:newbie},'https://evil.test')).status,403);
  assert.equal((await call('/api/admin/administrators',oldRoot,{userToken:newbie})).status,401); // réauthentification requise
  assert.equal((await call('/api/admin/administrators',root,{userToken:'faux-jeton-au-moins-vingt-caracteres'})).status,400);
  assert.equal((await call('/api/admin/administrators',root,{userToken:seller})).status,400);
  assert.equal((await call('/api/admin/administrators',root,{userToken:sellerPassword})).status,409);
  identities.set('stale-target-token-00000001',user('stale',{auth_time:now-1000}));
  assert.equal((await call('/api/admin/administrators',root,{userToken:'stale-target-token-00000001'})).status,400);
  const grant=await call('/api/admin/administrators',root,{userToken:newbie,sub:'ordinary-uid'});
  assert.equal(grant.status,200);assert.equal(grant.json.already,false);
  assert.equal(await db.get('pulseAdmins/ordinary-uid'),null);
  assert.equal((await db.get('pulseAdmins/new-admin')).data.createdBy,'root-admin');
  assert.equal((await call('/api/admin/all',newbie)).status,403);
  assert.match((await call('/api/admin/all',newbie)).json.error,/Confirmez votre adresse e-mail/);
  assert.equal((await call('/api/admin/all',newbieVerified)).status,200);
  assert.equal((await call('/api/admin/administrators',newbieVerified,{userToken:second})).status,200);
  assert.equal((await call('/api/admin/all',second)).status,200); // les droits se propagent
  assert.equal((await call('/api/admin/administrators',root,{userToken:newbieVerified})).json.already,true);
  assert.equal((await call('/api/admin/administrators',root,{userToken:root})).status,409);
  identities.set('wrong-provider-token-0000001',user('new-admin',{firebase:{sign_in_provider:'custom'}}));
  assert.equal((await call('/api/admin/all','wrong-provider-token-0000001')).status,403);
  await db.commit([db.write('pulseAdmins/second-admin',{active:false})]);
  assert.equal((await call('/api/admin/all',second)).status,403);
  assert.deepEqual((await db.get('pulse/catalog')).data,before);
  assert.equal((await db.get('pulseAccess/seller-uid')).data.pinMac,'préservé');
});

test('Administrateurs directs : uniquement nouveaux comptes, changement de mot de passe et protections inchangées',async()=>{
  const db=new MemoryDb(),identities=new Map(),accounts=new Map(),now=Math.floor(Date.now()/1000),calls=[];
  const identity=(sub,email,extra={})=>({sub,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'},...extra});
  const root='root-admin-token-test-000001',oldRoot='old-admin-token-test-0000001',other='ordinary-token-test-0000001';
  const target='direct-new-token-test-00001',oldTarget='direct-old-token-test-00001',seller='direct-seller-token-test-01';
  identities.set(root,identity('root-admin','root@example.test'));
  identities.set(oldRoot,identity('root-admin','root@example.test',{auth_time:now-1000}));
  identities.set(other,identity('ordinary','ordinary@example.test'));
  identities.set(target,identity('new-admin','new@example.test'));
  identities.set(oldTarget,identity('old-account','old@example.test'));
  identities.set(seller,identity('seller-uid','seller@example.test'));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>{const found=identities.get(token);if(!found)throw Error('invalid');return found;},
    lookupFirebaseAccount:async(_env,token)=>{calls.push(token);if(!accounts.has(token))throw Error('unavailable');return {...accounts.get(token)};}});
  const env={ADMIN_UID:'root-admin',FIREBASE_PROJECT_ID:'demo-fnac',ALLOWED_ORIGIN:'https://example.test',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  const call=async(path,body,token=root,origin='https://example.test')=>{
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{origin,...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:res.status,json:await res.json()};
  };
  const start=(email,extra={})=>({email,confirmed:true,...extra});
  const begin='/api/admin/direct-account/start',complete='/api/admin/direct-account/complete',status='/api/auth/admin-account-status';
  assert.equal((await call(begin,start('new@example.test'),null)).status,401);
  assert.equal((await call(begin,start('new@example.test'),other)).status,403);
  assert.equal((await call(begin,start('new@example.test'),oldRoot)).status,401);
  assert.equal((await call(begin,start('new@example.test'),root,'https://evil.test')).status,403);
  assert.equal((await call(begin,start('new@example.test',{confirmed:false}))).status,400);
  assert.equal((await call(begin,start('new@example.test',{password:'ne-pas-envoyer'}))).status,400);
  assert.equal((await call(begin,start('root@example.test'))).status,409);
  assert.equal((await call(begin,start('pas-une-adresse'))).status,400);
  assert.deepEqual((await call(status,{},oldRoot)).json,{passwordChangeRequired:false},'compte historique inchangé');

  const initial=await call(begin,start('new@example.test'));assert.equal(initial.status,200);assert.equal(initial.json.resume,false);
  const again=await call(begin,start('NEW@example.test'));assert.equal(again.json.requestId,initial.json.requestId);assert.equal(again.json.resume,true);
  const reservationPath=`pulseAdminDirectRequests/${await digestBase64('direct-admin-request:root-admin:new@example.test')}`;
  const reservation=(await db.get(reservationPath)).data;
  assert.equal(reservation.createdBy,'root-admin');assert(!JSON.stringify(reservation).includes('new@example.test'));assert(!JSON.stringify(reservation).includes('password'));
  const grantBody={email:'new@example.test',requestId:initial.json.requestId,userToken:target};
  assert.equal((await call(complete,{...grantBody,userToken:'invalid-token-test-000000000'})).status,400);
  assert.equal((await call(complete,{...grantBody,email:'different@example.test'})).status,400);
  assert.equal((await call(complete,{...grantBody,password:'ne-pas-envoyer'})).status,400);
  assert.equal((await call(complete,grantBody,oldRoot)).status,401);
  assert.equal((await call(complete,grantBody)).status,503,'échec Firebase : aucun droit');assert.equal(await db.get('pulseAdmins/new-admin'),null);
  const initialTime=Math.max(Date.now(),reservation.startedAt);
  accounts.set(target,{localId:'new-admin',email:'new@example.test',disabled:false,createdAt:initialTime,passwordUpdatedAt:initialTime});
  const first=await call(complete,grantBody);assert.equal(first.status,200);assert.equal(first.json.already,false);
  const grant=(await db.get('pulseAdmins/new-admin')).data;
  assert.equal(grant.source,'direct-v1');assert.equal(grant.requiresVerifiedEmail,false);assert.equal(grant.passwordChangeRequired,true);
  assert(!JSON.stringify(grant).includes('new@example.test'));assert(!JSON.stringify(grant).includes('Provisoire'));
  assert.equal((await call(complete,grantBody)).json.already,true,'réponse perdue idempotente');
  assert.equal((await call('/api/admin/administrators',{},target)).status,403,'pas de droits avant changement de mot de passe');
  assert.deepEqual((await call(status,{},target)).json,{passwordChangeRequired:true});
  accounts.get(target).passwordUpdatedAt=initialTime-1;
  assert.deepEqual((await call(status,{},target)).json,{passwordChangeRequired:true});
  accounts.get(target).passwordUpdatedAt=initialTime+25;
  assert.deepEqual((await call(status,{},target)).json,{passwordChangeRequired:false,reauthenticate:true});
  assert.equal((await db.get('pulseAdmins/new-admin')).data.passwordChangeRequired,false);
  assert.equal((await call('/api/admin/administrators',{},target)).status,401,'ancien jeton provisoire refusé après changement');
  const fresh='direct-fresh-token-test-0001';
  identities.set(fresh,identity('new-admin','new@example.test',{auth_time:Math.floor((initialTime+25)/1000)+1}));
  assert.equal((await call('/api/admin/administrators',{},fresh)).status,400,'mêmes droits après reconnexion');
  assert.deepEqual((await call(status,{},fresh)).json,{passwordChangeRequired:false});

  identities.set('wrong-email-token-test-00001',identity('new-admin','autre@example.test'));
  identities.set('wrong-provider-token-000001',identity('new-admin','new@example.test',{firebase:{sign_in_provider:'custom'}}));
  assert.equal((await call('/api/admin/administrators',{},'wrong-email-token-test-00001')).status,403,'exception limitée à l’adresse approuvée');
  assert.equal((await call('/api/admin/administrators',{},'wrong-provider-token-000001')).status,403);
  await db.commit([db.write('pulseAdmins/new-admin',{...grant,active:false})]);
  assert.equal((await call(status,{},target)).status,403,'un droit désactivé reste désactivé');

  const old=await call(begin,start('old@example.test'));
  accounts.set(oldTarget,{localId:'old-account',email:'old@example.test',createdAt:Date.now()-3600000,passwordUpdatedAt:Date.now()-3600000});
  assert.equal((await call(complete,{email:'old@example.test',requestId:old.json.requestId,userToken:oldTarget})).status,409,'aucun compte déjà existant promu');
  assert.equal(await db.get('pulseAdmins/old-account'),null);
  await db.commit([db.write('pulseAccess/seller-uid',{active:true,version:'inchangée'})]);
  const sellerBegin=await call(begin,start('seller@example.test'));
  accounts.set(seller,{localId:'seller-uid',email:'seller@example.test',createdAt:Date.now(),passwordUpdatedAt:Date.now()});
  assert.equal((await call(complete,{email:'seller@example.test',requestId:sellerBegin.json.requestId,userToken:seller})).status,409);
  assert.equal((await db.get('pulseAccess/seller-uid')).data.version,'inchangée');

  // Les anciennes attributions restent soumises à la confirmation d'e-mail.
  const legacy='legacy-admin-token-test-0001';identities.set(legacy,identity('legacy-uid','legacy@example.test'));
  await db.commit([db.write('pulseAdmins/legacy-uid',{active:true,requiresVerifiedEmail:true})]);
  assert.equal((await call('/api/admin/administrators',{},legacy)).status,403);
  identities.set('legacy-verified-token-test-01',identity('legacy-uid','legacy@example.test',{email_verified:true}));
  assert.equal((await call('/api/admin/administrators',{},'legacy-verified-token-test-01')).status,400);
  assert(calls.every(t=>t===target||t===oldTarget),'aucune recherche Firebase pour un vendeur ou le compte historique');
});

test('Administrateurs directs : collision atomique, compte désactivé et reprise après réponse perdue',async()=>{
  const db=new MemoryDb(),ids=new Map(),accounts=new Map(),now=Math.floor(Date.now()/1000),root='race-root-token-test-00001';
  const identity=(uid,email)=>({sub:uid,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'}});
  ids.set(root,identity('root','root@example.test'));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!ids.has(t))throw Error();return ids.get(t);},lookupFirebaseAccount:async(_env,t)=>accounts.get(t)});
  const env={ADMIN_UID:'root',FIREBASE_PROJECT_ID:'demo-fnac',PIN_PEPPER:Buffer.alloc(32,1).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  const call=async(path,body,token=root)=>{const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:res.status,json:await res.json()};};
  const start=email=>call('/api/admin/direct-account/start',{email,confirmed:true});
  const begin=await start('race@example.test'),requestId=begin.json.requestId;
  const token='race-new-user-token-0000001',email='race@example.test',uid='race-user',created=Date.now();
  ids.set(token,identity(uid,email));accounts.set(token,{localId:uid,email,createdAt:created,passwordUpdatedAt:created,disabled:false});
  const body={email,requestId,userToken:token},commit=db.commit.bind(db);let race=true;
  db.commit=async writes=>{
    if(race&&writes.some(w=>w.path===`pulseAdmins/${uid}`)){
      race=false;await commit([db.write(`pulseAccess/${uid}`,{active:true,version:'vendeur-non-modifié'})]);
    }
    return commit(writes);
  };
  assert.equal((await call('/api/admin/direct-account/complete',body)).status,409);
  assert.equal(await db.get(`pulseAdmins/${uid}`),null);assert.equal((await db.get(`pulseAccess/${uid}`)).data.version,'vendeur-non-modifié');
  db.commit=commit;
  const other=await start('lost-commit@example.test'),otherToken='lost-commit-user-token-0001',otherEmail='lost-commit@example.test',otherUid='lost-uid',created2=Date.now();
  ids.set(otherToken,identity(otherUid,otherEmail));accounts.set(otherToken,{localId:otherUid,email:otherEmail,createdAt:created2,passwordUpdatedAt:created2,disabled:true});
  const otherBody={email:otherEmail,requestId:other.json.requestId,userToken:otherToken};
  assert.equal((await call('/api/admin/direct-account/complete',otherBody)).status,409);assert.equal(await db.get(`pulseAdmins/${otherUid}`),null);
  accounts.get(otherToken).disabled=false;let lost=true;
  db.commit=async writes=>{
    if(lost&&writes.some(w=>w.path===`pulseAdmins/${otherUid}`)){
      lost=false;await commit(writes);const error=new Error('réponse perdue');error.status=409;throw error;
    }
    return commit(writes);
  };
  const completed=await call('/api/admin/direct-account/complete',otherBody);
  assert.equal(completed.status,200);assert.equal(completed.json.already,true);
  assert.equal((await db.get(`pulseAdmins/${otherUid}`)).data.passwordChangeRequired,true);
  assert.equal((await call('/api/admin/administrators',{},otherToken)).status,403);
  db.commit=commit;
});

test('Import manuel Fnac : authentification, validation, sauvegarde et aucune suppression ou fusion',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(t!=='admin')throw Error();return {sub:'root'};}});
  const env={ADMIN_UID:'root',FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  async function call(path,token,body) {
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:res.status,json:await res.json()};
  }
  await call('/api/bootstrap');
  const before=(await db.get('pulse/catalog')).data,checked=before.directorySync.verifiedAt,attempt=before.directorySync.lastAttempt,result=before.directorySync.lastResult;
  const personal={active:true,storeId:LEGACY_STORE_ID,sellerId:1,pinMac:'unique',version:'v1'},sale={sellerId:1,serviceId:2,storeId:LEGACY_STORE_ID};
  await db.commit([db.write('pulseAccess/seller',personal),db.write(`pulseStores/${LEGACY_STORE_ID}/sales/preserved`,sale)]);
  const entries=directorySnapshot.stores.filter(s=>s.fnacId!=='cl124').map(({fnacId,name})=>({fnacId,name:fnacId==='cl57'?'Fnac Labège Test':name}));
  entries.push({fnacId:'cl9999',name:'Fnac Copie de test'});
  const body={declared:entries.length+2,entries};
  assert.equal((await call('/api/admin/stores/import',null,body)).status,401);
  assert.equal((await call('/api/admin/stores/import','admin',{...body,entries:entries.slice(0,70)})).status,400);
  assert.equal((await call('/api/admin/stores/import','admin',{...body,entries:entries.map((x,i)=>i===1?{...x,fnacId:entries[0].fnacId}:x)})).status,400);
  assert.equal((await call('/api/admin/stores/import','admin',{...body,entries:entries.map((x,i)=>i===1?{...x,name:'Fnac <script>'}:x)})).status,400);
  assert.deepEqual((await db.get('pulse/catalog')).data,before);
  const imported=await call('/api/admin/stores/import','admin',body);assert.equal(imported.status,200);assert.equal(imported.json.imported,189);
  const after=(await db.get('pulse/catalog')).data;
  assert.equal(after.stores.find(x=>x.fnacId==='cl57').id,LEGACY_STORE_ID);
  assert.equal(after.stores.find(x=>x.fnacId==='cl57').name,'Fnac Labège Test');
  assert.equal(after.stores.find(x=>x.fnacId==='cl57').directoryStatus,'manual');
  assert.equal(after.stores.find(x=>x.fnacId==='cl57').directoryPreviouslyVerified,true);
  assert(after.stores.find(x=>x.fnacId==='cl57').previousNames.includes(before.stores.find(x=>x.fnacId==='cl57').name));
  assert.equal(after.stores.find(x=>x.fnacId==='cl124').directoryStatus,'official'); // une copie non certifiée ne classe pas les absents
  assert.equal(after.stores.find(x=>x.fnacId==='cl9999').name,'Fnac Copie de test');
  assert.equal(after.stores.find(x=>x.fnacId==='cl9999').directoryStatus,'manual');
  assert.equal(after.directorySync.verifiedAt,checked);assert.equal(after.directorySync.lastAttempt,attempt);assert.equal(after.directorySync.lastResult,result);
  assert(after.directorySync.lastManualImport);assert.equal(after.directorySync.manualCount,189);
  assert.deepEqual(after.sellers,before.sellers);assert.deepEqual((await db.get('pulseAccess/seller')).data,personal);
  assert.deepEqual((await db.get(`pulseStores/${LEGACY_STORE_ID}/sales/preserved`)).data,sale);
  const month=new Date().toISOString().slice(0,7),backup=await db.get(`pulseBackups/catalog-before-fnac-manual-${month}`);
  assert(backup);assert.deepEqual(backup.data.catalog.stores,before.stores);
});

test('Import manuel : une vérification officielle concurrente plus récente ne doit pas être écrasée',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'root'})});
  const env={ADMIN_UID:'root',FIREBASE_PROJECT_ID:'demo-fnac'},ctx={waitUntil(){}};
  const call=(path,body)=>worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer root',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
  assert.equal((await call('/api/bootstrap')).status,200);
  const before=(await db.get('pulse/catalog')).data,original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path.startsWith('pulseBackups/catalog-before-fnac-manual-'))) {
      raced=true;const concurrent=(await db.get('pulse/catalog')).data;
      concurrent.directorySync.lastSuccessfulSync=new Date(Date.now()+2000).toISOString();
      await original([db.write('pulse/catalog',concurrent)]);
    }
    return original(writes);
  };
  const entries=directorySnapshot.stores.map(({fnacId,name})=>({fnacId,name:fnacId==='cl57'?'Fnac Nom Copié':name}));
  const result=await call('/api/admin/stores/import',{declared:entries.length+2,entries});
  assert.equal(result.status,409);assert.match((await result.json()).error,/vérification officielle plus récente/);
  const after=(await db.get('pulse/catalog')).data;assert.equal(after.stores.find(s=>s.fnacId==='cl57').name,before.stores.find(s=>s.fnacId==='cl57').name);
  assert.equal(after.directorySync.lastManualImport,undefined);assert(raced);
});

test('Invitations admin : authentification récente, consentement, vérification, péremption et écritures atomiques',async()=>{
  const db=new MemoryDb(),identities=new Map(),now=Math.floor(Date.now()/1000);
  const root={sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}};
  const invitee={sub:'invited',email:'Invitee@Example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}};
  identities.set('root',root);identities.set('invited',invitee);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error('invalid');return identities.get(t);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}};
  const ctx={waitUntil(){}};
  const req=async(path,body,token)=>{
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env,ctx);
    return {status:response.status,body:await response.json()};
  };
  const invite=(email,requestId='request-12345678',token='root')=>req('/api/admin/invitations',{email,requestId},token);
  const accept=(token='invited',confirmed=true)=>req('/api/auth/admin-invitations/accept',{confirmed},token);
  const path=async(email)=>`pulseAdminInvitations/${await digestBase64(`admin-invitation:${email.toLowerCase()}`)}`;
  await db.commit([db.write('pulse/catalog',{original:'non modifié'}),db.write('pulseAccess/seller-unchanged',{active:true,version:'v1'}),db.write('pulseStores/a/sales/old',{count:3})]);
  const snapshot=await Promise.all(['pulse/catalog','pulseAccess/seller-unchanged','pulseStores/a/sales/old'].map(x=>db.get(x)));
  assert.equal((await invite('invitee@example.test','request-12345678','root')).status,200);
  assert.equal((await req('/api/admin/invitations',{email:'x@example.test',requestId:'request-12345678'})).status,401);
  assert.equal((await invite('root@example.test','request-self-0001')).status,409);
  identities.set('stale-root',{...root,auth_time:now-301});
  assert.equal((await invite('new@example.test','request-stale-01','stale-root')).status,401);
  assert.equal((await req('/api/admin/invitations',{email:'new@example.test',requestId:'request-12345678',password:'NE-PAS-TRANSMETTRE'},'root')).status,400);
  assert.equal((await accept('invited',false)).status,400);
  assert.equal((await accept('nonexistent')).status,401);
  identities.set('unverified',{...invitee,sub:'unverified',email_verified:false});
  identities.set('seller',{...invitee,sub:'seller',role:'seller'});
  identities.set('other-provider',{...invitee,sub:'other-provider',firebase:{sign_in_provider:'google.com'}});
  identities.set('old-login',{...invitee,sub:'old-login',auth_time:now-301});
  identities.set('wrong-address',{...invitee,sub:'wrong-address',email:'other@example.test'});
  for(const token of ['unverified','seller','other-provider','wrong-address'])assert.equal((await accept(token)).status,403,token);
  assert.equal((await accept('old-login')).status,401);
  assert.equal(await db.get('pulseAdmins/invited'),null,'aucun droit avant acceptation');
  const before=await db.get(await path('invitee@example.test'));
  assert.equal(before.data.status,'pending');assert(!JSON.stringify(before.data).includes('invitee@example.test'));
  assert(!JSON.stringify(before.data).includes('password'));
  const repeated=await invite('INVITEE@example.test');assert.equal(repeated.status,200);assert.equal(repeated.body.expiresAt,before.data.expiresAt);
  const [a,b]=await Promise.all([accept(),accept()]);assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal([a,b].filter(x=>x.body.already).length,1);
  const grant=await db.get('pulseAdmins/invited'),used=await db.get(await path('invitee@example.test'));
  assert.equal(grant.data.createdBy,'root');assert.equal(used.data.status,'accepted');assert.equal(used.data.acceptedBy,'invited');
  assert.equal((await accept()).body.already,true,'reprise après réponse perdue');
  identities.set('double',{...invitee,sub:'double'});assert.equal((await accept('double')).status,403);assert.equal(await db.get('pulseAdmins/double'),null);
  assert.equal((await invite('third@example.test','request-third-001','invited')).status,200,'mêmes droits pour le nouvel admin');
  identities.set('race-one',{...invitee,sub:'race-one',email:'third@example.test'});identities.set('race-two',{...invitee,sub:'race-two',email:'third@example.test'});
  const competing=await Promise.all([accept('race-one'),accept('race-two')]);assert.deepEqual(competing.map(x=>x.status).sort(),[200,403]);
  assert.equal(Number(!!await db.get('pulseAdmins/race-one'))+Number(!!await db.get('pulseAdmins/race-two')),1);
  const expiredEmail='expire@example.test',expiredPath=await path(expiredEmail);
  await db.commit([db.write(expiredPath,{status:'pending',createdBy:'root',requestId:'request-expired-1',expiresAt:Date.now()-1})]);
  identities.set('expired',{...invitee,sub:'expired',email:expiredEmail});assert.equal((await accept('expired')).status,403);
  const disabledEmail='disabled@example.test';assert.equal((await invite(disabledEmail,'request-disabled1')).status,200);
  identities.set('disabled',{...invitee,sub:'disabled',email:disabledEmail});await db.commit([db.write('pulseAdmins/disabled',{active:false})]);
  assert.equal((await accept('disabled')).status,409);
  const sellerEmail='collision@example.test';assert.equal((await invite(sellerEmail,'request-collision1')).status,200);
  identities.set('collision',{...invitee,sub:'collision',email:sellerEmail});await db.commit([db.write('pulseAccess/collision',{active:true})]);
  assert.equal((await accept('collision')).status,409);assert.equal(await db.get('pulseAdmins/collision'),null);
  assert.deepEqual(await Promise.all(['pulse/catalog','pulseAccess/seller-unchanged','pulseStores/a/sales/old'].map(x=>db.get(x))),snapshot);
});

function enrollmentFixture() {
  const db=new MemoryDb(),ids=new Map(),accounts=new Map(),limits=[],now=Math.floor(Date.now()/1000);
  const identity=(sub,email,extra={})=>({sub,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'},...extra});
  ids.set('root-token',identity('root','root@example.test',{auth_time:now-7200}));
  ids.set('outsider-token',identity('outsider','outsider@example.test'));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!ids.has(t))throw Error('signature');return ids.get(t);},
    lookupFirebaseAccount:async(_e,t)=>{if(!accounts.has(t))throw Error('indisponible');return {...accounts.get(t)};}});
  const env={ADMIN_UID:'root',FIREBASE_PROJECT_ID:'demo-fnac',ALLOWED_ORIGIN:'https://example.test',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),
    LOGIN_LIMITER:{async limit({key}){limits.push(key);return {success:true};}}},ctx={waitUntil(){}};
  async function call(path,body={},token='',options={}) {
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',origin:options.origin||'https://example.test',
      'cf-connecting-ip':options.ip||'203.0.113.1',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env,ctx);
    return {status:res.status,json:await res.json()};
  }
  const paths={issue:'/api/admin/enrollment-code',cancel:'/api/admin/enrollment-code/cancel',prepare:'/api/auth/admin-code/prepare',complete:'/api/auth/admin-code/complete',status:'/api/auth/admin-account-status'};
  const path=async code=>`pulseAdminCodes/${await digestBase64(`admin-code-v1:${code.replace(/-/g,'')}`)}`;
  return {db,ids,accounts,limits,env,worker,call,paths,path,identity};
}

test('Codes admin : session suffisante, secret haché, usage unique et première connexion protégée',async()=>{
  const f=enrollmentFixture(),{db,ids,accounts,limits,call,paths,path,identity}=f;
  assert.equal((await call(paths.issue,{confirmed:true})).status,401);
  assert.equal((await call(paths.issue,{confirmed:true},'outsider-token')).status,403);
  assert.equal((await call(paths.issue,{confirmed:false},'root-token')).status,400);
  assert.equal((await call(paths.issue,{confirmed:true,password:'secret'},'root-token')).status,400);
  assert.equal((await call(paths.issue,{confirmed:true},'root-token',{origin:'https://evil.test'})).status,403);
  const created=await call(paths.issue,{confirmed:true},'root-token');assert.equal(created.status,200,'pas de réauthentification de la session ouverte');
  const code=created.json.code,recordPath=await path(code),initial=(await db.get(recordPath)).data;
  assert.match(code,/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);assert.equal(initial.status,'pending');assert.equal(initial.expiresAt-initial.createdAt,24*60*60*1000);
  const stored=JSON.stringify([...db.docs]);assert(!stored.includes(code));assert(!stored.includes(code.replace(/-/g,'')));assert(!limits.join('|').includes(code));
  assert.equal((await call(paths.prepare,{confirmed:true,code:'MALFORME',email:'new@example.test'})).status,400);
  assert.equal((await call(paths.prepare,{code,email:'new@example.test'})).status,400,'consentement exigé côté serveur');
  assert.equal((await call(paths.prepare,{confirmed:true,code,email:'new@example.test',password:'123456'})).status,400);
  const started=await call(paths.prepare,{confirmed:true,code:code.toLowerCase(),email:'  New@example.test  '});assert.deepEqual(started.json,{ok:true,resume:false});
  assert.deepEqual((await call(paths.prepare,{confirmed:true,code,email:'NEW@example.test'})).json,{ok:true,resume:true});
  assert.equal((await call(paths.prepare,{confirmed:true,code,email:'other@example.test'})).status,403,'une adresse seulement');
  assert(!JSON.stringify([...db.docs]).includes('new@example.test'),'adresse conservée sous forme de hash');
  const reserved=(await db.get(recordPath)).data,uid='code-new-admin',token='target-token',createdAt=reserved.reservedAt+10;
  ids.set(token,identity(uid,'new@example.test'));
  assert.equal((await call(paths.complete,{code},token)).status,503,'Firebase indisponible : pas de droit');
  assert.equal(await db.get(`pulseAdmins/${uid}`),null);
  accounts.set(token,{localId:uid,email:'new@example.test',disabled:false,createdAt,passwordUpdatedAt:createdAt});
  assert.equal((await call(paths.complete,{code,password:'secret'},token)).status,400);
  const completed=await call(paths.complete,{code},token);assert.deepEqual(completed.json,{ok:true,already:false});
  const grant=(await db.get(`pulseAdmins/${uid}`)).data;
  assert.equal(grant.source,'direct-v1');assert.equal(grant.provisionMethod,'code-v1');assert.equal(grant.requiresVerifiedEmail,false);assert.equal(grant.passwordChangeRequired,true);
  assert(!JSON.stringify(grant).includes('new@example.test'));assert(!JSON.stringify(grant).includes(code));
  assert.deepEqual((await call(paths.complete,{code},token)).json,{ok:true,already:true});
  assert.equal((await call(paths.cancel,{code},'root-token')).status,409,'annuler ne retire pas un accès créé');
  ids.set('same-email-other-uid',identity('another-uid','new@example.test'));
  assert.equal((await call(paths.complete,{code},'same-email-other-uid')).status,403);
  assert.equal((await call('/api/admin/administrators',{},token)).status,403,'aucun droit avant mot de passe personnel');
  assert.deepEqual((await call(paths.status,{},token)).json,{passwordChangeRequired:true,method:'code'});
  accounts.get(token).passwordUpdatedAt=createdAt+50;
  assert.deepEqual((await call(paths.status,{},token)).json,{passwordChangeRequired:false,reauthenticate:true});
  assert.equal((await call('/api/admin/administrators',{},token)).status,401,'ancien jeton provisoire refusé');
  ids.set('fresh-token',identity(uid,'new@example.test',{auth_time:Math.floor((createdAt+50)/1000)+1}));
  accounts.set('fresh-token',accounts.get(token));
  assert.deepEqual((await call(paths.status,{},'fresh-token')).json,{passwordChangeRequired:false});
  assert.equal((await call('/api/admin/administrators',{},'fresh-token')).status,400,'mêmes droits globaux après changement');
  assert.equal((await call(paths.issue,{confirmed:true},'fresh-token')).status,200,'un nouvel admin peut ajouter des administrateurs');
});

test('Codes admin : refus des anciens comptes, vendeurs, révocation, expiration et limitation',async()=>{
  const f=enrollmentFixture(),{db,ids,accounts,call,paths,path,identity}=f;
  const issue=async()=>(await call(paths.issue,{confirmed:true},'root-token')).json.code;
  const prep=async(code,email)=>(await call(paths.prepare,{confirmed:true,code,email}));
  const code=await issue(),email='old@example.test';assert.equal((await prep(code,email)).status,200);
  const record=(await db.get(await path(code))).data;
  ids.set('old',identity('old-uid',email));accounts.set('old',{localId:'old-uid',email,createdAt:record.reservedAt-60_000,passwordUpdatedAt:record.reservedAt,disabled:false});
  assert.equal((await call(paths.complete,{code},'old')).status,409);assert.equal(await db.get('pulseAdmins/old-uid'),null);
  accounts.get('old').createdAt=record.reservedAt;assert.equal((await call(paths.complete,{code},'old')).status,409,'même milliseconde refusée par prudence');
  accounts.get('old').createdAt=record.reservedAt+10;accounts.get('old').disabled=true;
  assert.equal((await call(paths.complete,{code},'old')).status,409);accounts.get('old').disabled=false;
  await db.commit([db.write('pulseAccess/old-uid',{active:true,version:'vendeur-conservé'})]);
  assert.equal((await call(paths.complete,{code},'old')).status,409);assert.equal((await db.get('pulseAccess/old-uid')).data.version,'vendeur-conservé');
  assert.equal(await db.get('pulseAdmins/old-uid'),null);
  const expired=await issue(),expiredPath=await path(expired),expiredRecord=await db.get(expiredPath);
  await db.commit([db.write(expiredPath,{...expiredRecord.data,expiresAt:Date.now()-1},{updateTime:expiredRecord.updateTime})]);
  assert.equal((await prep(expired,'expired@example.test')).status,403);
  const cancelled=await issue();assert.equal((await call(paths.cancel,{code:cancelled},'outsider-token')).status,403);
  assert.equal((await call(paths.cancel,{code:cancelled},'root-token')).status,200);
  assert.equal((await prep(cancelled,'cancelled@example.test')).status,403);
  const reserved=await issue();assert.equal((await prep(reserved,'cancel2@example.test')).status,200);
  assert.equal((await call(paths.cancel,{code:reserved},'root-token')).status,200);
  ids.set('cancel2',identity('cancel2','cancel2@example.test'));
  assert.equal((await call(paths.complete,{code:reserved},'cancel2')).status,403);
  const noResume=await issue();assert.equal((await prep(noResume,'resume@example.test')).status,200);
  const noResumePath=await path(noResume),rr=await db.get(noResumePath);
  await db.commit([db.write(noResumePath,{...rr.data,resumeUntil:Date.now()-1},{updateTime:rr.updateTime})]);
  assert.equal((await prep(noResume,'resume@example.test')).status,403);
  f.env.LOGIN_LIMITER={async limit(){return {success:false}}};
  assert.equal((await prep('ABCD-EFGH-JKLM-NPQR','new@example.test')).status,429);
  assert.equal((await call(paths.issue,{confirmed:true},'root-token')).status,429);
});

test('Codes admin : accès atomique, conflit de vendeurs, retrait du créateur et courses',async()=>{
  const f=enrollmentFixture(),{db,ids,accounts,call,paths,path,identity}=f;
  const issue=async(token='root-token')=>(await call(paths.issue,{confirmed:true},token)).json.code;
  const code=await issue(),email='race@example.test';
  const results=await Promise.all([call(paths.prepare,{confirmed:true,code,email}),call(paths.prepare,{confirmed:true,code,email:'autre@example.test'})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,403]);
  const bound=results[0].status===200?email:'autre@example.test',rec=(await db.get(await path(code))).data,uid='race-uid';
  ids.set('race',identity(uid,bound));accounts.set('race',{localId:uid,email:bound,createdAt:rec.reservedAt+1,passwordUpdatedAt:rec.reservedAt+1,disabled:false});
  const commit=db.commit.bind(db);let raced=true;
  db.commit=async writes=>{
    if(raced&&writes.some(w=>w.path===`pulseAdmins/${uid}`)){raced=false;await commit([db.write(`pulseAccess/${uid}`,{active:true,version:'conservé'})]);}
    return commit(writes);
  };
  assert.equal((await call(paths.complete,{code},'race')).status,409);assert.equal(await db.get(`pulseAdmins/${uid}`),null);
  db.commit=commit;
  ids.set('subadmin',identity('sub-admin','sub@example.test',{email_verified:true,auth_time:Math.floor(Date.now()/1000)-5000}));
  await db.commit([db.write('pulseAdmins/sub-admin',{active:true,requiresVerifiedEmail:true})]);
  const nested=await issue('subadmin');assert(nested,'autre administrateur connecté depuis longtemps');
  assert.equal((await call(paths.prepare,{confirmed:true,code:nested,email:'nested@example.test'})).status,200);
  const nestedRecord=(await db.get(await path(nested))).data;
  ids.set('nested-target',identity('nested-uid','nested@example.test'));
  accounts.set('nested-target',{localId:'nested-uid',email:'nested@example.test',createdAt:nestedRecord.reservedAt+1,passwordUpdatedAt:nestedRecord.reservedAt+1,disabled:false});
  let revoke=true;db.commit=async writes=>{
    if(revoke&&writes.some(w=>w.path==='pulseAdmins/nested-uid')){revoke=false;await commit([db.write('pulseAdmins/sub-admin',{active:false})]);}
    return commit(writes);
  };
  assert.equal((await call(paths.complete,{code:nested},'nested-target')).status,403);assert.equal(await db.get('pulseAdmins/nested-uid'),null);
  db.commit=commit;
  const concurrent=await issue(),cEmail='simultaneous@example.test';assert.equal((await call(paths.prepare,{confirmed:true,code:concurrent,email:cEmail})).status,200);
  const cr=(await db.get(await path(concurrent))).data;ids.set('simultaneous',identity('simultaneous-uid',cEmail));
  accounts.set('simultaneous',{localId:'simultaneous-uid',email:cEmail,createdAt:cr.reservedAt+1,passwordUpdatedAt:cr.reservedAt+1,disabled:false});
  const both=await Promise.all([call(paths.complete,{code:concurrent},'simultaneous'),call(paths.complete,{code:concurrent},'simultaneous')]);
  assert.deepEqual(both.map(x=>x.status),[200,200]);assert.deepEqual(both.map(x=>x.json.already).sort(),[false,true]);
  assert.equal((await db.get('pulseAdmins/simultaneous-uid')).data.passwordChangeRequired,true);
});

test('Cloud : ajout historique ciblé, confirmé, idempotent, sans notification ni modification des objectifs',async()=>{
  const db=new MemoryDb(),queued=[],sent=[],waits=[],store=LEGACY_STORE_ID;
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>{
    if(token==='admin')return {sub:'administrator'};if(token==='seller')return {sub:'seller',role:'seller'};throw Error('invalid');
  },sendFcm:async(...value)=>sent.push(value)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(batch){queued.push(...batch);}}},ctx={waitUntil(p){waits.push(p);}};
  const req=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const bootstrap=(await req('/api/bootstrap','GET',undefined,'')).body,other=bootstrap.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const catalog=(await db.get('pulse/catalog')).data,seller=catalog.sellers.find(s=>s.id===1),service=catalog.services.find(s=>s.id===1),storeName=catalog.stores.find(s=>s.id===store).name;
  seller.active=false;catalog.sellerFlags.s1=false;service.active=false;
  catalog.departmentsByStore={[store]:[{id:'tech',name:'Produits Techniques',active:true},{id:'editorial',name:'Ancien département',active:false}]};
  const access={active:true,storeId:store,sellerId:2,sellerKey:'s2',version:'existing-session',pinMac:'test-only'},status={active:true,storeId:store,sellerId:2,sellerKey:'s2',version:'existing-session'};
  await db.commit([db.write('pulse/catalog',catalog),db.write(`pulseGoals/${store}-1`,{targets:{s1:10}}),db.write('pulseAccess/existing-session',access),db.write('pulseStatus/existing-session',status),
    db.write(`pulseStores/${other}/sales/other-sale`,{id:'other-sale',storeId:other,sellerId:1,serviceId:1,businessDate:'2026-10-27',departmentId:'tech',source:'sale'})]);
  const url='/api/admin/sales/add-correction';
  const body={storeId:store,sellerId:1,period:'day',anchor:'2026-10-27',saleDate:'2026-10-27',serviceId:1,departmentId:'editorial',quantity:3,requestId:'history-add-test-0001',confirmation:'AJOUTER',expectedSellerName:seller.name,expectedStoreName:storeName,expectedServiceName:service.name,expectedDepartmentName:'Ancien département'};
  assert.equal((await req(url,'POST',body,'')).status,401);assert.equal((await req(url,'POST',body,'seller')).status,403);
  for(const period of ['week','month'])assert.equal((await req(url,'POST',{...body,period})).status,400);
  for(const invalid of [{saleDate:''},{saleDate:'2026-11-02'},{saleDate:'2026-02-30'},{saleDate:'2999-01-01'},{quantity:0},{quantity:21},{quantity:1.5},{quantity:'2'},{confirmation:''},{requestId:'short'}])
    assert.equal((await req(url,'POST',{...body,...invalid})).status,400,JSON.stringify(invalid));
  for(const changed of [{storeId:other},{sellerId:999999},{serviceId:999999},{departmentId:'unknown'},{expectedStoreName:'Incorrect'},{expectedSellerName:'Incorrect'},{expectedServiceName:'Incorrect'},{expectedDepartmentName:'Incorrect'}])
    assert.equal((await req(url,'POST',{...body,...changed})).status,409,JSON.stringify(changed));
  const [one,two]=await Promise.all([req(url,'POST',body),req(url,'POST',body)]);
  assert.equal(one.status,200);assert.equal(two.status,200);assert.deepEqual([one.body.duplicate,two.body.duplicate].sort(),[false,true]);
  assert.equal(one.body.added,3);assert.equal(two.body.added,3);
  let sales=await db.query(`pulseStores/${store}/sales`);assert.equal(sales.length,3);
  const expectedUid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  for(const row of sales){assert.equal(row.data.businessDate,'2026-10-27');assert.equal(row.data.departmentId,'editorial');assert.equal(row.data.serviceId,1);assert.equal(row.data.sellerId,1);assert.equal(row.data.source,'adjustment');assert.equal(row.data.ownerUid,expectedUid);assert.equal(row.data.deletedAt,null);assert(!row.data.createdAt.startsWith('2026-10-27'));}
  const totals=summarize(catalog,sales.map(x=>x.data),1,'2026-10-31',store);assert.equal(totals.summary.store.month.total,3);assert.equal(totals.summary.departments.editorial.month.total,3);assert.equal(totals.summary.departments.tech.month.total,0);assert.deepEqual(totals.month.mineByService,[{serviceId:1,count:3}]);
  assert.deepEqual((await db.get(`pulseGoals/${store}-1`)).data,{targets:{s1:10}});assert.deepEqual((await db.get('pulse/catalog')).data,catalog);
  assert.deepEqual((await db.get('pulseAccess/existing-session')).data,access);assert.deepEqual((await db.get('pulseStatus/existing-session')).data,status);
  assert.equal((await db.query('pulseOutbox')).length,0);assert.equal(queued.length,0);assert.equal(sent.length,0);assert.equal(waits.length,0);
  assert.equal((await db.get(`pulseStores/${other}/sales/other-sale`)).data.deletedAt,undefined);
  assert.equal((await req(url,'POST',{...body,quantity:2})).status,409);
  const history=(await req(`/api/admin/sales/history?storeId=${store}&sellerId=1&period=week&anchor=2026-10-29`)).body;assert.equal(history.sales.length,3);
  const correction={storeId:store,sellerId:1,period:'day',anchor:'2026-10-27',saleIds:[history.sales[0].id],requestId:'history-added-remove-0001',confirmation:'SUPPRIMER',expectedSellerName:seller.name,expectedStoreName:storeName};
  assert.equal((await req('/api/admin/sales/correct','POST',correction)).body.deleted,1);
  sales=await db.query(`pulseStores/${store}/sales`);assert.equal(sales.filter(x=>!x.data.deletedAt).length,2);
  catalog.serviceRemovalsByStore={[store]:[1]};await db.commit([db.write('pulse/catalog',catalog)]);
  assert.equal((await req(url,'POST',{...body,requestId:'history-removed-service'})).status,409);
  // Un rejeu reste sans effet même après retrait du service : il ne recrée rien.
  assert.equal((await req(url,'POST',body)).body.duplicate,true);assert.equal((await db.query(`pulseStores/${store}/sales`)).length,3);
});

test('Cloud : ajout refusé sans écriture si reset, suppression ou catalogue change simultanément',async()=>{
  for(const kind of ['reset','generation','seller-delete','service-delete','catalog','guard']) {
    const db=new MemoryDb(),store=LEGACY_STORE_ID,worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
    const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
    const req=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
    await req('/api/bootstrap','GET',undefined,'');const catalog=(await db.get('pulse/catalog')).data;
    const body={storeId:store,sellerId:1,period:'day',anchor:'2026-10-28',saleDate:'2026-10-28',serviceId:1,departmentId:'tech',quantity:2,
      requestId:`history-add-race-${kind}`,confirmation:'AJOUTER',expectedSellerName:catalog.sellers.find(s=>s.id===1).name,expectedStoreName:catalog.stores.find(s=>s.id===store).name,expectedServiceName:catalog.services.find(s=>s.id===1).name,expectedDepartmentName:'Produits Techniques'};
    const target={reset:`pulseSalesResets/${store}`,generation:`pulseStores/${store}/sales/~sales-reset~`,'seller-delete':`pulseSellerDeletes/${store}`,'service-delete':`pulseServiceDeletes/${store}`,catalog:'pulse/catalog',guard:`pulseStores/${store}/private/revision`}[kind];
    const data=kind==='catalog'?{...catalog,nextServiceId:catalog.nextServiceId+1}:kind==='generation'?{generation:'reset-racing'}:kind==='guard'?{revision:'other-racing-write'}:{status:'running'};
    const commit=db.commit.bind(db);let raced=false;
    db.commit=async writes=>{if(!raced&&writes.some(w=>w.path===`pulseSalesCorrectionAdds/${body.requestId}`)){raced=true;await commit([db.write(target,data)]);}return commit(writes);};
    const result=await req('/api/admin/sales/add-correction','POST',body);assert.equal(result.status,409,kind);assert(raced,kind);
    assert.equal(await db.get(`pulseSalesCorrectionAdds/${body.requestId}`),null,kind);
    assert.equal((await db.query(`pulseStores/${store}/sales`)).filter(x=>x.id!=='~sales-reset~').length,0,kind);
  }
});

test('Administrateurs : adresse seule, compte authentifié, vérification humaine et approbation atomique',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),ids=new Map();
  const identity=(sub,email,extra={})=>({sub,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'},...extra});
  const root='root-admin-token-fixture-001',candidate='manual-candidate-token-0001',other='manual-other-token-0000001',seller='manual-seller-token-0000001';
  ids.set(root,identity('root-admin','root@example.test'));ids.set(candidate,identity('candidate-uid','candidate@example.test'));
  ids.set(other,identity('attacker-uid','candidate@example.test'));ids.set(seller,identity('seller-uid','seller@example.test'));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!ids.has(t))throw Error('signature');return ids.get(t);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root-admin',ALLOWED_ORIGIN:'https://example.test',PIN_PEPPER:Buffer.alloc(32,2).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,{body,token,method=body?'POST':'GET',origin='https://example.test'}={})=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  const add='/api/admin/access-requests',claim='/api/auth/admin-access/claim',status='/api/auth/admin-access/status',approve='/api/admin/access-requests/approve';
  await req('/api/bootstrap');const catalogBefore=(await db.get('pulse/catalog')).data;
  await db.commit([db.write('pulseAccess/seller-uid',{active:true,version:'kept'}),db.write('pulseAdmins/other-existing',{active:true,email:'kept'})]);
  assert.equal((await req(add,{body:{email:'candidate@example.test'}})).status,401);
  assert.equal((await req(add,{token:candidate,body:{email:'candidate@example.test'}})).status,403);
  assert.equal((await req(add,{token:root,body:{email:'candidate@example.test',password:'must-never-be-sent'}})).status,400);
  assert.equal((await req(add,{token:root,body:{email:'candidate@example.test'},origin:'https://evil.test'})).status,403);
  assert.equal((await req('/api/auth/admin-access/check',{body:{email:'candidate@example.test'}})).body.allowed,false);
  assert.equal((await req(add,{token:root,body:{email:' Candidate@example.test '}})).body.status,'invited');
  assert.equal((await req(add,{token:root,body:{email:'candidate@example.test'}})).body.already,true);
  assert.equal((await req('/api/auth/admin-access/check',{body:{email:'candidate@example.test'}})).body.allowed,true);
  assert.equal((await req('/api/admin/all',{token:candidate})).status,403);assert.equal(await db.get('pulseAdmins/candidate-uid'),null);
  assert.equal((await req(claim,{body:{},token:'fake-token'})).status,401);
  const c=await req(claim,{body:{},token:candidate});assert.deepEqual(c.body,{ok:true,status:'pending'});
  assert.deepEqual((await req(claim,{body:{},token:candidate})).body,{ok:true,status:'pending'});
  assert.equal((await req(claim,{body:{},token:other})).status,409);
  assert.equal((await req(status,{body:{},token:other})).status,403);
  assert.equal((await req('/api/admin/all',{token:candidate})).status,403);
  const list=(await req(add,{token:root})).body.requests;assert.equal(list.length,1);assert.equal(list[0].email,'candidate@example.test');assert.equal(list[0].claimantUid,'candidate-uid');
  const body={email:list[0].email,requestId:list[0].requestId,claimantUid:list[0].claimantUid,confirmed:true,identityVerified:true};
  assert.equal((await req(approve,{token:root,body:{...body,identityVerified:false}})).status,400);
  assert.equal((await req(approve,{token:root,body:{...body,claimantUid:'attacker-uid'}})).status,409);
  assert.equal((await req(approve,{token:candidate,body})).status,403);
  const [first,second]=await Promise.all([req(approve,{token:root,body}),req(approve,{token:root,body})]);
  assert.deepEqual([first.status,second.status],[200,200]);assert.deepEqual([first.body.already,second.body.already].sort(),[false,true]);
  const grant=(await db.get('pulseAdmins/candidate-uid')).data;assert.equal(grant.active,true);assert.equal(grant.identityVerifiedManually,true);assert.equal(grant.requiresVerifiedEmail,false);
  assert.equal((await req('/api/admin/all',{token:candidate})).status,200);assert.equal((await req(status,{body:{},token:candidate})).body.status,'approved');
  ids.set('changed-address-token-00001',identity('candidate-uid','changed@example.test',{email_verified:true}));
  assert.equal((await req('/api/admin/all',{token:'changed-address-token-00001'})).status,403,'le droit reste lié à l’adresse approuvée même si une autre est vérifiée');
  ids.set('wrong-provider-token-000001',identity('candidate-uid','candidate@example.test',{firebase:{sign_in_provider:'custom'}}));
  assert.equal((await req('/api/admin/all',{token:'wrong-provider-token-000001'})).status,403);
  assert.deepEqual((await db.get('pulse/catalog')).data,catalogBefore);assert.equal((await db.get('pulseAccess/seller-uid')).data.version,'kept');assert.equal((await db.get('pulseAdmins/other-existing')).data.email,'kept');
});

test('Demandes admin : concurrence, annulation et comptes existants ne reçoivent jamais de droits implicites',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),ids=new Map();
  const id=(sub,email,more={})=>({sub,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'},...more});
  ids.set('root-token-000000000000001',id('root','root@example.test'));
  ids.set('person-one-token-0000000001',id('person-one','shared@example.test'));
  ids.set('person-two-token-0000000001',id('person-two','shared@example.test'));
  ids.set('old-admin-token-0000000001',id('old-admin','old@example.test'));
  ids.set('old-seller-token-000000001',id('old-seller','seller@example.test'));
  ids.set('stale-token-00000000000001',id('stale','stale@example.test',{auth_time:now-3600}));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!ids.has(t))throw Error('invalid');return ids.get(t);}});
  const env={ADMIN_UID:'root',FIREBASE_PROJECT_ID:'demo-fnac',PIN_PEPPER:Buffer.alloc(32,2).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const call=async(path,token,body,method=body?'POST':'GET')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,json:await r.json()};};
  const root='root-token-000000000000001',add='/api/admin/access-requests',claim='/api/auth/admin-access/claim';
  for(const email of ['shared@example.test','old@example.test','seller@example.test','stale@example.test'])assert.equal((await call(add,root,{email})).status,200);
  await db.commit([db.write('pulseAdmins/old-admin',{active:false,keep:'not promoted'}),db.write('pulseAccess/old-seller',{active:true,keep:'seller'})]);
  assert.equal((await call(claim,'old-admin-token-0000000001',{})).status,409);assert.equal((await call(claim,'old-seller-token-000000001',{})).status,409);
  assert.equal((await call(claim,'stale-token-00000000000001',{})).status,403);
  const pair=await Promise.all([call(claim,'person-one-token-0000000001',{}),call(claim,'person-two-token-0000000001',{})]);
  assert.deepEqual(pair.map(x=>x.status).sort(),[200,409]);
  const list=(await call(add,root)).json.requests,item=list.find(x=>x.email==='shared@example.test');
  assert(['person-one','person-two'].includes(item.claimantUid));assert.equal(await db.get(`pulseAdmins/${item.claimantUid}`),null);
  const cancel={email:item.email,requestId:item.requestId,claimantUid:item.claimantUid,confirmed:true};
  assert.equal((await call('/api/admin/access-requests/cancel',root,cancel)).status,200);
  assert.equal((await call('/api/admin/access-requests/cancel',root,cancel)).json.already,true);
  assert.equal((await call('/api/admin/access-requests/approve',root,{...cancel,identityVerified:true})).status,409);
  assert.equal((await call('/api/auth/admin-access/status',item.claimantUid==='person-one'?'person-one-token-0000000001':'person-two-token-0000000001',{})).status,403);
  assert.equal((await db.get('pulseAdmins/old-admin')).data.keep,'not promoted');assert.equal((await db.get('pulseAccess/old-seller')).data.keep,'seller');
});

test('Demandes admin : révocation simultanée du validateur empêche toute attribution',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),id=(sub,email)=>({sub,email,auth_time:now,email_verified:false,firebase:{sign_in_provider:'password'}});
  const ids=new Map([['root-token',id('root','root@example.test')],['approver-token',id('approver','approver@example.test')],['candidate-token',id('candidate','candidate@example.test')]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!ids.has(t))throw Error();return ids.get(t);}});
  const env={ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,2).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const call=async(path,token,body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,json:await r.json()};};
  const digest=await digestBase64('manual-admin-email:approver@example.test');
  await db.commit([db.write('pulseAdmins/approver',{active:true,source:'manual-approval-v1',manualEmailDigest:digest,requiresVerifiedEmail:false})]);
  await call('/api/admin/access-requests','root-token',{email:'candidate@example.test'});await call('/api/auth/admin-access/claim','candidate-token',{});
  const item=(await call('/api/admin/access-requests','root-token')).json.requests[0];
  const commit=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{if(!raced&&writes.some(w=>w.path==='pulseAdmins/candidate')){raced=true;await commit([db.write('pulseAdmins/approver',{active:false})]);}return commit(writes);};
  const body={email:item.email,requestId:item.requestId,claimantUid:item.claimantUid,confirmed:true,identityVerified:true};
  assert.equal((await call('/api/admin/access-requests/approve','approver-token',body)).status,403);assert(raced);assert.equal(await db.get('pulseAdmins/candidate'),null);
});

test('Ancien compte de test : recherche, révocation et autorisation ciblées sans supprimer un autre compte',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),root='root-token-test-00000000001',target='target-token-test-000000001';
  const identities=new Map([[root,{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
    [target,{sub:'old-test-uid',email:'test@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t);}});
  const env={ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,2).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const call=async(path,token,body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)}),env,ctx);return {status:r.status,json:await r.json()};};
  const digest=await digestBase64('direct-admin-email:test@example.test');
  const reservation=`pulseAdminDirectRequests/${await digestBase64('direct-admin-request:root:test@example.test')}`;
  await db.commit([db.write('pulseAdmins/old-test-uid',{active:true,source:'direct-v1',createdBy:'root',directEmailDigest:digest,passwordChangeRequired:true}),
    db.write(reservation,{createdBy:'root',status:'completed',requestId:'old-request-001',targetUid:'old-test-uid'}),
    db.write('pulseAdmins/someone-else',{active:true,keep:'not touched'}),db.write('pulseAccess/seller-else',{active:true,keep:'not touched'})]);
  const inspect='/api/admin/old-test/inspect',revoke='/api/admin/old-test/revoke',authorize='/api/admin/old-test/authorize-delete';
  assert.equal((await call(inspect,target,{email:'test@example.test'})).status,403);
  const found=await call(inspect,root,{email:'TEST@example.test'});assert.equal(found.json.uid,'old-test-uid');assert.equal(found.json.grantActive,true);
  assert.equal((await call(revoke,root,{email:'test@example.test',uid:'someone-else',confirmed:true})).status,409);
  assert.equal((await call(revoke,root,{email:'test@example.test',uid:'old-test-uid',confirmed:false})).status,400);
  assert.equal((await call(authorize,root,{email:'test@example.test',uid:'old-test-uid',userToken:target,confirmed:true})).status,409);
  const body={email:'test@example.test',uid:'old-test-uid',confirmed:true};assert.equal((await call(revoke,root,body)).status,200);
  assert.equal((await db.get('pulseAdmins/old-test-uid')).data.active,false);assert.equal((await db.get(reservation)).data.status,'revoked');
  assert.equal((await call(revoke,root,body)).status,200);
  assert.equal((await call(authorize,root,{...body,userToken:target})).json.ok,true);
  assert.equal((await call(authorize,root,{...body,userToken:root})).status,403);
  assert.equal((await db.get('pulseAdmins/someone-else')).data.keep,'not touched');assert.equal((await db.get('pulseAccess/seller-else')).data.keep,'not touched');
  assert.equal((await call(inspect,root,{email:'missing@example.test'})).json.found,false);
});

test('Cloud : anciens marqueurs semaine et mois rejouables sans écriture, aucune nouvelle correction multi-jours',async()=>{
  const db=new MemoryDb(),store=LEGACY_STORE_ID;
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  const req=async(path,body)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer admin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:r.status,body:await r.json()};};
  await req('/api/bootstrap');
  const catalog=(await db.get('pulse/catalog')).data,seller=catalog.sellers.find(s=>s.id===1),service=catalog.services.find(s=>s.id===1),storeName=catalog.stores.find(s=>s.id===store).name;
  await db.commit([db.write(`pulseStores/${store}/sales/preserved-sale`,{id:'preserved-sale',storeId:store,sellerId:1,serviceId:1,businessDate:'2026-10-13',deletedAt:null}),db.write('pulseOutbox/preserved-sale',{status:'pending'})]);
  for(const period of ['week','month']) {
    const addition={storeId:store,sellerId:1,period,anchor:'2026-10-15',saleDate:'2026-10-13',serviceId:1,departmentId:'tech',quantity:2,requestId:`legacy-add-${period}-0001`,confirmation:'AJOUTER',expectedSellerName:seller.name,expectedStoreName:storeName,expectedServiceName:service.name,expectedDepartmentName:'Produits Techniques'};
    const removal={storeId:store,sellerId:1,period,anchor:'2026-10-15',saleIds:['preserved-sale'],requestId:`legacy-remove-${period}-01`,confirmation:'SUPPRIMER',expectedSellerName:seller.name,expectedStoreName:storeName};
    await db.commit([
      db.write(`pulseSalesCorrectionAdds/${addition.requestId}`,{fingerprint:await digestBase64(saleAdditionFingerprintInput(addition)),count:2,createdAt:1}),
      db.write(`pulseSalesCorrections/${removal.requestId}`,{fingerprint:await digestBase64(saleCorrectionFingerprintInput(removal)),count:1,createdAt:1}),
    ]);
    const before=structuredClone([...db.docs]);
    assert.deepEqual((await req('/api/admin/sales/add-correction',addition)),{status:200,body:{ok:true,added:2,duplicate:true}});
    assert.deepEqual((await req('/api/admin/sales/correct',removal)),{status:200,body:{ok:true,deleted:1,duplicate:true}});
    assert.equal((await req('/api/admin/sales/add-correction',{...addition,quantity:3})).status,409);
    assert.equal((await req('/api/admin/sales/correct',{...removal,saleIds:['another-sale']})).status,409);
    assert.equal((await req('/api/admin/sales/add-correction',{...addition,requestId:`new-add-${period}-0001`})).status,400);
    assert.equal((await req('/api/admin/sales/correct',{...removal,requestId:`new-remove-${period}-0001`})).status,400);
    assert.deepEqual([...db.docs],before,'aucune écriture, vente ou notification modifiée');
  }
});

test('Demandes administrateur : pages bornées sans masquer les dossiers ouverts ni exposer les dossiers clos',async()=>{
  const db=new MemoryDb(),worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({sub:'administrator'})});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  const req=async path=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{headers:{authorization:'Bearer admin'}}),env,ctx);return {status:r.status,body:await r.json()};};
  const writes=[];
  for(let i=0;i<70;i++) {
    const email=`pagination-${i}@example.test`,id=await digestBase64(`manual-admin-request:${email}`),status=i<56?(i%2?'pending':'invited'):'approved';
    writes.push(db.write(`pulseAdminAccessRequests/${id}`,{email,status,requestId:`request-page-${String(i).padStart(4,'0')}`,createdAt:i,...(status==='pending'?{claimantUid:`candidate-${i}`}:{})}));
  }
  await db.commit(writes);
  const one=await req('/api/admin/access-requests');assert.equal(one.status,200);assert.equal(one.body.requests.length,50);assert.match(one.body.next,/^[A-Za-z0-9_-]{43}$/);
  const two=await req(`/api/admin/access-requests?after=${one.body.next}`);assert.equal(two.status,200);assert.equal(two.body.requests.length,6);assert.equal(two.body.next,null);
  const all=[...one.body.requests,...two.body.requests];assert.equal(new Set(all.map(x=>x.requestId)).size,56);assert(all.every(x=>['invited','pending'].includes(x.status)));
  assert.equal((await req('/api/admin/access-requests?after=../invalid')).status,400);
});

test('Invitations e-mail : liste privée, annulation idempotente, expiration et accès sans validation manuelle',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),identities=new Map([
    ['root',{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['invite',{sub:'new-admin',email:'new@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['unverified',{sub:'new-admin',email:'new@example.test',email_verified:false,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['seller',{sub:'seller',email:'seller@example.test',role:'seller',auth_time:now,firebase:{sign_in_provider:'password'}}],
  ]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error('invalid');return identities.get(t);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,method='GET',body,token='root')=>{
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:response.status,body:await response.json()};
  };
  const path=`pulseAdminInvitations/${await digestBase64('admin-invitation:new@example.test')}`;
  const invite=(requestId,extra={})=>req('/api/admin/invitations','POST',{email:'NEW@example.test',requestId,showInPanel:true,...extra});
  const accept=token=>req('/api/auth/admin-invitations/accept','POST',{confirmed:true},token);
  const cancel=requestId=>req('/api/admin/invitations/cancel','POST',{email:'new@example.test',requestId,confirmed:true});
  await db.commit([db.write('pulse/catalog',{original:'conservé'}),db.write('pulseAccess/seller-session',{active:true,version:'v1'}),db.write('pulseStores/s/sales/old',{count:9})]);
  const old=await Promise.all(['pulse/catalog','pulseAccess/seller-session','pulseStores/s/sales/old'].map(x=>db.get(x)));
  assert.equal((await req('/api/admin/invitations','GET',undefined,'')).status,401);
  assert.equal((await req('/api/admin/invitations','GET',undefined,'seller')).status,403);
  const initial=await invite('email-request-001');assert.equal(initial.status,200);assert.equal(initial.body.status,'pending');
  const stored=await db.get(path);assert.equal(stored.data.email,'new@example.test');assert.equal(stored.data.expiresAt-stored.data.createdAt,7*86400000);
  assert(!JSON.stringify(stored).toLowerCase().includes('password'));assert.equal((await invite('email-request-001')).body.expiresAt,initial.body.expiresAt);
  const listed=await req('/api/admin/invitations');assert.equal(listed.status,200);assert.equal(listed.body.invitations.length,1);
  assert.deepEqual(Object.keys(listed.body.invitations[0]).sort(),['createdAt','email','expiresAt','requestId']);
  assert.equal((await accept('unverified')).status,403);assert.equal(await db.get('pulseAdmins/new-admin'),null);
  assert.equal((await req('/api/admin/invitations/cancel','POST',{email:'new@example.test',requestId:'email-request-001'})).status,400);
  assert.equal((await cancel('wrong-request-001')).status,409);assert.equal((await cancel('email-request-001')).body.already,false);
  assert.equal((await cancel('email-request-001')).body.already,true);assert.equal((await accept('invite')).status,403);
  assert.equal((await req('/api/admin/invitations')).body.invitations.length,0);
  assert.equal((await invite('email-request-002')).status,200);
  let current=await db.get(path);await db.commit([db.write(path,{...current.data,expiresAt:Date.now()-1},{updateTime:current.updateTime})]);
  assert.equal((await req('/api/admin/invitations')).body.invitations.length,0);assert.equal((await accept('invite')).status,403);
  assert.equal((await invite('email-request-003')).status,200);assert.equal(await db.get('pulseAdmins/new-admin'),null);
  assert.deepEqual((await accept('invite')).body,{ok:true,already:false});
  assert.equal((await accept('invite')).body.already,true);assert.equal((await db.get('pulseAdmins/new-admin')).data.requiresVerifiedEmail,true);
  assert.equal((await cancel('email-request-003')).status,409,'une annulation ne retire pas un accès déjà consommé');
  assert.equal((await invite('email-request-003')).body.status,'accepted');
  assert.equal((await invite('email-request-004')).body.status,'accepted');
  current=await db.get('pulseAdmins/new-admin');await db.commit([db.write('pulseAdmins/new-admin',{...current.data,active:false},{updateTime:current.updateTime})]);
  assert.equal((await invite('email-request-003')).status,409,'une reprise ne réactive pas un accès désactivé');
  assert.equal((await invite('email-request-005')).status,409);
  assert.deepEqual(await Promise.all(['pulse/catalog','pulseAccess/seller-session','pulseStores/s/sales/old'].map(x=>db.get(x))),old);
});

test('Invitations e-mail : annulation et révocation simultanées empêchent toute attribution',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),identities=new Map([
    ['root',{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['issuer',{sub:'issuer',email:'issuer@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['candidate',{sub:'candidate',email:'candidate@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['legacy',{sub:'legacy',email:'legacy@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
  ]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error('invalid');return identities.get(t);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,body,token)=>{const response=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:response.status,body:await response.json()};};
  const invite=(email,requestId,token='issuer',showInPanel=true)=>req('/api/admin/invitations',{email,requestId,showInPanel},token);
  const accept=token=>req('/api/auth/admin-invitations/accept',{confirmed:true},token);
  const path=async email=>`pulseAdminInvitations/${await digestBase64(`admin-invitation:${email}`)}`;
  await db.commit([db.write('pulseAdmins/issuer',{active:true,requiresVerifiedEmail:true})]);
  assert.equal((await invite('candidate@example.test','race-request-001')).status,200);
  const invitePath=await path('candidate@example.test'),original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseAdmins/candidate'&&!w.check)) {
      raced=true;const current=await db.get(invitePath);
      await original([db.write(invitePath,{...current.data,status:'cancelled'},{updateTime:current.updateTime})]);
    }
    return original(writes);
  };
  assert.equal((await accept('candidate')).status,403);assert(raced);assert.equal(await db.get('pulseAdmins/candidate'),null);
  db.commit=original;
  assert.equal((await invite('candidate@example.test','race-request-002')).status,200);
  // Une invitation réellement historique n’a ni adresse ni marqueur : elle
  // garde ses anciennes règles, même après la révocation de l’invitant.
  const legacyPath=await path('legacy@example.test');
  await db.commit([db.write(legacyPath,{status:'pending',createdBy:'issuer',requestId:'legacy-request-001',createdAt:Date.now(),expiresAt:Date.now()+86400000})]);
  // Un ancien client qui crée une invitation après la mise à jour ne peut pas
  // éviter le nouveau contrôle en omettant l’adresse dans le panneau.
  assert.equal((await invite('old-client@example.test','old-client-request-01','issuer',false)).status,200);
  assert.equal((await db.get(await path('old-client@example.test'))).data.issuerMustBeActive,true);
  raced=false;db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path==='pulseAdmins/candidate'&&!w.check)) {
      raced=true;const issuer=await db.get('pulseAdmins/issuer');
      await original([db.write('pulseAdmins/issuer',{...issuer.data,active:false},{updateTime:issuer.updateTime})]);
    }
    return original(writes);
  };
  assert.equal((await accept('candidate')).status,403);assert(raced);assert.equal(await db.get('pulseAdmins/candidate'),null);
  db.commit=original;
  identities.set('old-client',{sub:'old-client',email:'old-client@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}});
  assert.equal((await accept('old-client')).status,403,'un ancien client ne contourne pas la révocation');
  assert.equal((await accept('legacy')).status,200,'les invitations historiques restent compatibles');
  assert.equal((await db.get('pulseAdmins/legacy')).data.active,true);
  assert.equal((await invite('another@example.test','race-request-003')).status,403,'un émetteur révoqué ne peut plus inviter');
});

test('Invitations e-mail : pagination des invitations récentes sans exposer les anciennes adresses absentes',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),actor={sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}};
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>actor});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async path=>{const response=await worker.fetch(new Request(`https://worker.test${path}`,{headers:{authorization:'Bearer root'}}),env,ctx);return {status:response.status,body:await response.json()};};
  const writes=[];for(let n=0;n<56;n++){
    const email=`page-${String(n).padStart(2,'0')}@example.test`,id=await digestBase64(`admin-invitation:${email}`);
    writes.push(db.write(`pulseAdminInvitations/${id}`,{email,requestId:`email-page-${String(n).padStart(3,'0')}`,status:'pending',createdAt:Date.now(),expiresAt:Date.now()+86400000,createdBy:'root'}));
  }
  await db.commit(writes);
  const first=await req('/api/admin/invitations');assert.equal(first.body.invitations.length,50);assert.match(first.body.next,/^[A-Za-z0-9_-]{43}$/);
  const second=await req(`/api/admin/invitations?after=${first.body.next}`);assert.equal(second.body.invitations.length,6);assert.equal(second.body.next,null);
  assert.equal(new Set([...first.body.invitations,...second.body.invitations].map(x=>x.email)).size,56);
  assert.equal((await req('/api/admin/invitations?after=../invalid')).status,400);
});

test('Invitations e-mail : révoquer l’émetteur pendant la création ou l’annulation bloque la transaction',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),identities=new Map([
    ['issuer',{sub:'issuer-race',email:'issuer@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['root',{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
  ]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>identities.get(t)});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,body,token='issuer')=>{const response=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:response.status,body:await response.json()};};
  const invitePath=`pulseAdminInvitations/${await digestBase64('admin-invitation:race@example.test')}`;
  const invite={email:'race@example.test',requestId:'race-invite-create-01',showInPanel:true};
  await db.commit([db.write('pulseAdmins/issuer-race',{active:true,requiresVerifiedEmail:true})]);
  const original=db.commit.bind(db);let raced=false;
  db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===invitePath&&!w.check)) {
      raced=true;const g=await db.get('pulseAdmins/issuer-race');await original([db.write('pulseAdmins/issuer-race',{...g.data,active:false},{updateTime:g.updateTime})]);
    }
    return original(writes);
  };
  assert.equal((await req('/api/admin/invitations',invite)).status,403);assert(raced);assert.equal(await db.get(invitePath),null);
  db.commit=original;const inactive=await db.get('pulseAdmins/issuer-race');await db.commit([db.write('pulseAdmins/issuer-race',{...inactive.data,active:true},{updateTime:inactive.updateTime})]);
  assert.equal((await req('/api/admin/invitations',invite)).status,200);
  raced=false;db.commit=async writes=>{
    if(!raced&&writes.some(w=>w.path===invitePath&&!w.check)) {
      raced=true;const g=await db.get('pulseAdmins/issuer-race');await original([db.write('pulseAdmins/issuer-race',{...g.data,active:false},{updateTime:g.updateTime})]);
    }
    return original(writes);
  };
  assert.equal((await req('/api/admin/invitations/cancel',{email:invite.email,requestId:invite.requestId,confirmed:true})).status,403);
  assert(raced);assert.equal((await db.get(invitePath)).data.status,'pending');
  db.commit=original;
  assert.equal((await req('/api/admin/invitations/cancel',{email:invite.email,requestId:invite.requestId,confirmed:true},'root')).status,200,'un autre administrateur actif peut annuler');
});

test('Ancienne demande en attente : une nouvelle invitation vérifiée peut aboutir sans effacer la demande',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),identities=new Map([
    ['root',{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['candidate',{sub:'legacy-candidate',email:'legacy@example.test',email_verified:false,auth_time:now,firebase:{sign_in_provider:'password'}}],
  ]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error('invalid');return identities.get(t);}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,body,token)=>{const response=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:response.status,body:await response.json()};};
  assert.equal((await req('/api/admin/access-requests',{email:'legacy@example.test'},'root')).status,200);
  assert.equal((await req('/api/auth/admin-access/claim',{},'candidate')).body.status,'pending');
  const manualPath=`pulseAdminAccessRequests/${await digestBase64('manual-admin-request:legacy@example.test')}`;
  const before=await db.get(manualPath);
  assert.equal((await req('/api/admin/invitations',{email:'legacy@example.test',requestId:'replacement-email-request-01',showInPanel:true},'root')).status,200);
  assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'candidate')).status,403);
  assert.equal(await db.get('pulseAdmins/legacy-candidate'),null);
  identities.set('candidate',{...identities.get('candidate'),email_verified:true});
  assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'candidate')).status,200);
  assert.equal((await db.get('pulseAdmins/legacy-candidate')).data.active,true);
  assert.deepEqual(await db.get(manualPath),before,'la demande historique n’est ni modifiée ni supprimée');
  assert.equal((await req('/api/auth/admin-account-status',{},'candidate')).status,200);
});

test('Activation par lien : blocage avant mot de passe, échec sûr et compatibilité des anciennes invitations',async()=>{
  const db=new MemoryDb(),now=Math.floor(Date.now()/1000),identities=new Map([
    ['root',{sub:'root',email:'root@example.test',auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['invited',{sub:'invited',email:'invited@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
    ['old',{sub:'old',email:'old@example.test',email_verified:true,auth_time:now,firebase:{sign_in_provider:'password'}}],
  ]);let account={localId:'invited',email:'invited@example.test',disabled:false,passwordUpdatedAt:NaN},outage=false,lookups=0;
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>{if(!identities.has(t))throw Error('invalid');return identities.get(t);},lookupFirebaseAccount:async()=>{lookups++;if(outage)throw Error('indisponible');return account;}});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'root',PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}},ctx={waitUntil(){}};
  const req=async(path,body,token)=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);return {status:r.status,body:await r.json()};};
  const invitation={email:'invited@example.test',requestId:'activation-request-001',showInPanel:true,activation:'email-link-v1'};
  assert.equal((await req('/api/admin/invitations',{...invitation,activation:'other'},'root')).status,400);
  assert.equal((await req('/api/admin/invitations',invitation,'root')).status,200);
  let r=await req('/api/auth/admin-invitations/accept',{confirmed:true},'invited');assert.equal(r.status,403);assert.match(r.body.error,/Créez d’abord/);assert.equal(await db.get('pulseAdmins/invited'),null);
  account.passwordUpdatedAt=Date.now();outage=true;r=await req('/api/auth/admin-invitations/accept',{confirmed:true},'invited');assert.equal(r.status,503);assert.equal(await db.get('pulseAdmins/invited'),null);outage=false;
  for(const invalid of [{...account,localId:'other'},{...account,email:'other@example.test'},{...account,disabled:true}]){const saved=account;account=invalid;assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'invited')).status,403);account=saved;}
  assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'invited')).status,200);
  assert.equal((await db.get('pulseAdmins/invited')).data.active,true);outage=true;
  assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'invited')).status,200,'reprise idempotente après accès');outage=false;
  const oldLookup=lookups;assert.equal((await req('/api/admin/invitations',{email:'old@example.test',requestId:'old-invitation-001',showInPanel:true},'root')).status,200);
  assert.equal((await req('/api/auth/admin-invitations/accept',{confirmed:true},'old')).status,200);assert.equal(lookups,oldLookup,'invitations existantes sans nouveau marqueur conservées');
});
