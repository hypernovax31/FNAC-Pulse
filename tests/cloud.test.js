import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.js';
import {digestBase64} from '../worker/firebase.js';
import {pinProof} from '../src/pin.js';
import {summarize,periodStarts,earliestDate,parisToday} from '../src/cloud-stats.js';
import {LEGACY_STORE_ID,sellersForStore,orderServices} from '../src/catalog.js';
import {createSaleAnnouncer} from '../src/live-sales.js';

class MemoryDb {
  docs=new Map();n=0;
  async get(path){const d=this.docs.get(path);return d?structuredClone(d):null;}
  write(path,data,currentDocument){return {path,data:structuredClone(data),currentDocument};}
  delete(path,currentDocument){return {path,del:true,currentDocument};}
  async commit(writes){
    for(const w of writes){const old=this.docs.get(w.path),c=w.currentDocument;
      if((c?.exists===false&&old)||(c?.exists===true&&!old)||(c?.updateTime&&old?.updateTime!==c.updateTime)) {const e=new Error('conflict');e.status=409;throw e;}}
    for(const w of writes){if(w.del)this.docs.delete(w.path);else this.docs.set(w.path,{id:w.path.split('/').pop(),name:w.path,data:structuredClone(w.data),updateTime:String(++this.n)});}
  }
  async query(path,field,op,value,limit=1000){return [...this.docs].filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(([,v])=>structuredClone(v)).filter(x=>!field||(op==='EQUAL'?x.data[field]===value:x.data[field]>=value)).slice(0,limit);}
}
function makeMessage(body){return {body,acked:false,retried:false,ack(){this.acked=true},retry(){this.retried=true}};}

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
  assert.equal((await req('/api/admin/pin','POST',{storeId:other,sellerId:1,proof:'A'.repeat(43)},'admin-token')).status,400);
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
  assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:1,proof})).status,401);
  assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:1,proof},'admin-token')).status,200);
  assert.equal((await req('/api/auth/login','POST',{storeId:other,sellerId:1,proof})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof})).body.customToken,'custom-test-token');
  const claims=identities.get('seller-token');assert.equal(claims.storeId,store);
  const token='a-very-long-firebase-registration-token-01';
  assert.equal((await req('/api/push/subscribe','POST',{token},'seller-token')).status,200);
  const requestId='test-sale-00000001';
  let r=await req('/api/sales','POST',{storeId:other,sellerId:12,serviceId:1,requestId,clientId:'one'},'seller-token');
  assert.equal(r.status,200);assert.equal(r.body.id,requestId);
  await Promise.all(waits.splice(0));assert.equal(queued.length,1);
  const created=await db.get(`pulseStores/${store}/sales/${requestId}`);assert.equal(created.data.storeId,store);assert.equal(created.data.sellerId,1);
  assert.equal(await db.get(`pulseStores/${other}/sales/${requestId}`),null);
  r=await req('/api/sales','POST',{serviceId:1,requestId},'seller-token');assert.equal(r.body.duplicate,true);await Promise.all(waits.splice(0));assert.equal(queued.length,1);
  const message=makeMessage(queued[0]);await worker.queue({messages:[message]},env);assert.equal(message.acked,true);assert.equal(sent.length,1);
  assert.equal(sent[0].sale.sellerName,'Morgan');assert.equal(sent[0].sale.serviceName,'DMax');
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
  assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:1,proof:newProof},'admin-token')).status,200);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'test-sale-00000002'},'seller-token')).status,403);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof})).status,401);
  assert.equal((await req('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof})).status,200);
  assert.equal((await req('/api/admin/entities/sellers/1','PATCH',{active:false},'admin-token')).status,200);
  assert.equal((await req('/api/sales','POST',{serviceId:1,requestId:'test-sale-00000003'},'seller-token')).status,403);
});

test('Cloud : verrouillage durable après cinq PIN erronés',async()=>{
  const db=new MemoryDb(),identities=new Map([['admin',{sub:'administrator'}]]);
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>{if(!identities.has(t))throw Error();return identities.get(t)},makeCustomToken:async()=> 'ok'});
  const env={FIREBASE_PROJECT_ID:'demo-fnac',ADMIN_UID:'administrator',PIN_PEPPER:Buffer.alloc(32,11).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}};
  const ctx={waitUntil(){}};
  async function req(path,body,token) {const r=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env,ctx);return r.status;}
  await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx);
  const store=LEGACY_STORE_ID;
  const good=await pinProof('demo-fnac',store,2,'90473512');
  assert.equal(await req('/api/admin/pin',{storeId:store,sellerId:2,proof:good},'admin'),200);
  const bad=await pinProof('demo-fnac',store,2,'00000000');
  for(let n=0;n<5;n++)assert.equal(await req('/api/auth/login',{storeId:store,sellerId:2,proof:bad}),401);
  assert.equal(await req('/api/auth/login',{storeId:store,sellerId:2,proof:good}),429);
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
  await db.commit([db.write('pulse/catalog',catalog),db.write('pulseOutbox/sale-test-0002',{saleId:'sale-test-0002',storeId:store,status:'queued',createdAt:Date.now()})]);
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
    assert.equal((await request('/api/admin/pin','POST',{storeId:store,sellerId:id,proof},'admin-token')).status,200);
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
  for(const values of [{day:0,week:1,month:2},{day:-1,week:1,month:2},{day:1.5,week:1,month:2},{day:10000,week:1,month:2},{day:'4',week:1,month:2},{day:1,week:1}]) {
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
  assert.equal((await request('/api/admin/pin','POST',{storeId:store,sellerId:1,proof:changed},'admin-token')).status,200);
  assert.equal((await request('/api/goals','GET',undefined,'seller-1-token')).status,403);
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
    assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:id,proof},'admin')).status,200);
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
  assert.equal((await req('/api/admin/pin','POST',{storeId:store,sellerId:1,proof:newProof},'admin')).status,200);
  assert.equal((await req('/api/goals','GET',undefined,'seller-1')).status,403);
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
