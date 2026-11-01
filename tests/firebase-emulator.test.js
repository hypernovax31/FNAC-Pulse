import {test} from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocFromServer, collection, getDocs, query, where, setDoc, onSnapshot } from 'firebase/firestore';
import { FirestoreRest, digestBase64, pinMac } from '../worker/firebase.js';
import { createWorker } from '../worker/index.js';
import { pinProof } from '../src/pin.js';
import { LEGACY_STORE_ID } from '../src/catalog.js';
import legacyLocations from '../server/locations.json' with {type:'json'};

const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function fakeCustomToken(_env,uid,claims) {
  const now=Math.floor(Date.now()/1000);
  return `${b64({alg:'none',typ:'JWT'})}.${b64({iss:'demo-service@example.test',sub:'demo-service@example.test',aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid,claims})}.`;
}

test('Émulateurs Firebase : REST, règles Firestore et authentification PIN', {skip:!enabled},async()=>{
  const project='demo-fnac';
  const app=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`test-${Date.now()}`);
  const auth=getAuth(app),db=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  connectFirestoreEmulator(db,'127.0.0.1',8085);
  const adminUser=(await createUserWithEmailAndPassword(auth,`admin-${Date.now()}@example.test`,'Testing-Password-2026')).user;
  const adminToken=await adminUser.getIdToken();
  const storeDb=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const enqueued=[],waits=[];
  const worker=createWorker({
    createDb:()=>storeDb,
    verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),
    makeCustomToken:fakeCustomToken,
    sendFcm:async()=>{},
  });
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:adminUser.uid,PIN_PEPPER:Buffer.alloc(32,8).toString('base64url'),
    ALLOWED_ORIGIN:'http://example.test',LOGIN_LIMITER:{async limit(){return {success:true}}},
    PULSE_QUEUE:{async sendBatch(batch){enqueued.push(...batch)}}};
  const ctx={waitUntil(p){waits.push(p)}};
  async function call(path,method='GET',body,token) {
    const req=new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const res=await worker.fetch(req,env,ctx),json=await res.json();
    assert.notEqual(res.status,500,JSON.stringify(json));return {status:res.status,json};
  }
  try {
    // Clear only the demo emulator; never touch the real Firebase project.
    await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
    assert.equal((await call('/api/bootstrap')).status,200);
    const legacy=(await storeDb.get('pulse/catalog')).data;
    delete legacy.catalogVersion;delete legacy.sellerStores;delete legacy.serviceOrders;
    delete legacy.storeDirectoryVersion;delete legacy.directorySync;
    legacy.stores=legacyLocations.map(s=>({...s,active:true}));
    legacy.sellers=legacy.sellers.map(({storeId,...s})=>s);
    legacy.services=legacy.services.map(({priorityCode,...s})=>s);
    const oldAccess={active:true,storeId:LEGACY_STORE_ID,sellerId:1,version:'existing',pinMac:'existing-pin-hash'};
    const oldSale={id:'historic',storeId:LEGACY_STORE_ID,sellerId:1,serviceId:1,businessDate:'2000-01-01'};
    await storeDb.commit([storeDb.write('pulse/catalog',legacy),storeDb.write('pulseAccess/legacy-record',oldAccess),storeDb.write(`pulseStores/${LEGACY_STORE_ID}/sales/historic`,oldSale)]);
    const bootstrap=await call('/api/bootstrap');assert.equal(bootstrap.status,200);
    const backup=await storeDb.get('pulseBackups/catalog-before-store-scoping-v1');
    assert.equal(backup.data.catalog.sellers[0].storeId,undefined);
    const directoryBackup=await storeDb.get('pulseBackups/catalog-before-fnac-directory-v1');
    assert.equal(directoryBackup.data.catalog.stores.length,180);
    const migratedCatalog=(await storeDb.get('pulse/catalog')).data;
    assert.equal(migratedCatalog.sellerStores.s1,LEGACY_STORE_ID);
    assert.equal(migratedCatalog.stores.find(s=>s.fnacId==='cl57').id,LEGACY_STORE_ID);
    assert.equal(migratedCatalog.stores.find(s=>s.fnacId==='cl449').id,'osm-node-3782323705');
    assert.equal(migratedCatalog.stores.filter(s=>s.directoryStatus==='official').length,189);
    assert.deepEqual((await storeDb.get('pulseAccess/legacy-record')).data,oldAccess);
    assert.deepEqual((await storeDb.get(`pulseStores/${LEGACY_STORE_ID}/sales/historic`)).data,oldSale);
    const store=LEGACY_STORE_ID,other=bootstrap.json.stores.find(s=>s.name==='Fnac Bordeaux').id;
    // Objectifs préparés avant le PIN ; aucun document de statut n'est inventé.
    const initialGoals=await call('/api/admin/goals','POST',{storeId:store,sellerId:1,serviceId:1,values:{day:2,week:8,month:30},revision:null},adminToken);
    assert.equal(initialGoals.status,200);
    const proof=await pinProof(project,store,1,'73628519');
    const uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`,oldVersion='old-real-session';
    await storeDb.commit([storeDb.write(`pulseAccess/${uid}`,{active:true,storeId:store,sellerId:1,sellerKey:'s1',version:oldVersion,pinPersonal:true,pinMac:await pinMac(env,uid,proof)}),
      storeDb.write(`pulseStatus/${uid}`,{active:true,storeId:store,sellerId:1,sellerKey:'s1',version:oldVersion,goalsRevision:'goals-before-reset'})]);
    const oldUser=(await signInWithCustomToken(auth,fakeCustomToken(env,uid,{role:'seller',storeId:store,sellerId:1,sellerKey:'s1',accessVersion:oldVersion}))).user;
    const oldToken=await oldUser.getIdToken();assert.equal((await getDocFromServer(doc(db,'pulse','catalog'))).exists(),true);
    // Même si le marqueur historique est absent, l'initialisation actuelle ne
    // lance plus de remise à zéro globale et préserve la session existante.
    assert.deepEqual((await call('/api/auth/status','POST',{storeId:store,sellerId:1})).json,{needsPin:false});
    assert.equal((await getDocFromServer(doc(db,'pulse','catalog'))).exists(),true);
    assert.equal((await call('/api/goals','GET',undefined,oldToken)).status,200);
    assert.equal((await storeDb.get(`pulseStatus/${uid}`)).data.goalsRevision,'goals-before-reset');
    // Seule une action ciblée et authentifiée de l'administrateur révoque ici.
    assert.equal((await call('/api/admin/pin-reset','POST',{storeId:store,sellerId:1},adminToken)).status,200);
    await assert.rejects(getDocFromServer(doc(db,'pulse','catalog')),/permission|insufficient/i);
    assert.equal((await call('/api/goals','GET',undefined,oldToken)).status,403);
    assert.deepEqual((await call('/api/auth/status','POST',{storeId:store,sellerId:1})).json,{needsPin:true});
    assert.equal((await call('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:proof})).status,200);
    const login=await call('/api/auth/login','POST',{storeId:store,sellerId:1,proof});assert.equal(login.status,200);
    const seller=(await signInWithCustomToken(auth,login.json.customToken)).user;
    const idToken=await seller.getIdToken();
    assert.equal((await getDoc(doc(db,'pulse','catalog'))).exists(),true);
    const saleId='emulator-sale-000001';
    assert.equal((await call('/api/sales','POST',{serviceId:1,requestId:saleId,clientId:'browser'},idToken)).status,200);
    await Promise.all(waits.splice(0));
    const salesQuery=query(collection(db,'pulseStores',store,'sales'),where('businessDate','>=','2020-01-01'));
    const sales=await getDocs(salesQuery);
    assert.equal(sales.size,1);assert.equal(sales.docs[0].data().sellerId,1);
    const repeatedId='emulator-sale-duplicate';
    const concurrent=await Promise.all([call('/api/sales','POST',{serviceId:1,requestId:repeatedId},idToken),call('/api/sales','POST',{serviceId:1,requestId:repeatedId},idToken)]);
    assert(concurrent.every(r=>r.status===200));assert.equal(concurrent.filter(r=>r.json.duplicate).length,1);
    await Promise.all(waits.splice(0));
    assert.equal((await getDocs(salesQuery)).size,2);
    await assert.rejects(getDocs(collection(db,'pulseStores',other,'sales')),/permission|insufficient/i);
    await assert.rejects(setDoc(doc(db,'pulseStores',store,'sales','forged'),{sellerId:1}),/permission|insufficient/i);
    const myStatus=await getDoc(doc(db,'pulseStatus',seller.uid));assert.equal(myStatus.data().storeId,store);assert.equal('pinMac' in myStatus.data(),false);
    await assert.rejects(getDoc(doc(db,'pulseGoals',seller.uid)),/permission|insufficient/i);
    await assert.rejects(setDoc(doc(db,'pulseGoals',seller.uid),{goals:{}}),/permission|insufficient/i);
    assert.equal((await call('/api/goals','GET',undefined,idToken)).json.goals.s1.day,2);
    assert.deepEqual((await call('/api/goals','GET',undefined,idToken)).json.workdays,[1,2,3,4,5]);
    // BatchGet must preserve requested order, even for missing documents.
    const batch=await storeDb.getMany(['pulseGoals/missing-seller',`pulseGoals/${seller.uid}`]);
    assert.equal(batch[0],null);assert.equal(batch[1].data.goals.s1.month,30);
    const aggregate=await call(`/api/summary-goals?storeId=${store}`,'GET',undefined,idToken);
    assert.equal(aggregate.status,200);assert.equal(aggregate.json.store.byService.s1.month,30);
    assert.equal(aggregate.json.departments.tech.byService.s1.month,30);
    assert(!JSON.stringify(aggregate.json).includes('workdays'));assert(!JSON.stringify(aggregate.json).includes('Morgan'));
    assert.equal((await call(`/api/summary-goals?storeId=${other}`,'GET',undefined,idToken)).status,403);
    const markerRef=doc(db,'pulseStores',store,'sales','~summary-goals~');
    const markerBefore=(await getDocFromServer(markerRef)).data();assert.deepEqual(Object.keys(markerBefore),['revision']);
    await storeDb.commit([storeDb.delete(`pulseStores/${store}/sales/~summary-goals~`)]);
    assert.equal((await getDocFromServer(markerRef)).exists(),false); // Premier magasin sans objectif.
    await assert.rejects(getDocFromServer(doc(db,'pulseStores',other,'sales','~summary-goals~')),/permission|insufficient/i);
    const workdays={storeId:store,sellerId:1,workdays:[0,2,6],revision:null};
    assert.equal((await call('/api/admin/workdays','POST',workdays,idToken)).status,403);
    const setDays=await call('/api/admin/workdays','POST',workdays,adminToken);assert.equal(setDays.status,200);
    assert.deepEqual((await call('/api/goals','GET',undefined,idToken)).json.workdays,[2,6,0]);
    assert.equal((await call('/api/admin/workdays','POST',workdays,adminToken)).status,409);
    const privateStatus=(await getDocFromServer(doc(db,'pulseStatus',seller.uid))).data();
    assert.equal('workdays' in privateStatus,false);assert.equal('goals' in privateStatus,false);
    let goalEventResolve,goalReadyResolve;const goalEvent=new Promise(r=>{goalEventResolve=r}),goalReady=new Promise(r=>{goalReadyResolve=r});
    const stopGoal=onSnapshot(doc(db,'pulseStatus',seller.uid),{includeMetadataChanges:true},snap=>{if(!snap.metadata.fromCache)goalReadyResolve();if(snap.data()?.goalsRevision&&snap.data().goalsRevision!==privateStatus.goalsRevision)goalEventResolve(snap.data());});
    const markerOld=(await getDocFromServer(markerRef)).data().revision;
    let markerEventResolve,markerReadyResolve;const markerEvent=new Promise(r=>{markerEventResolve=r}),markerReady=new Promise(r=>{markerReadyResolve=r});
    const stopMarker=onSnapshot(markerRef,{includeMetadataChanges:true},snap=>{if(!snap.metadata.fromCache)markerReadyResolve();if(snap.data()?.revision&&snap.data().revision!==markerOld)markerEventResolve(snap.data());});
    // Attendre l'abonnement serveur, pas seulement l'instantané éventuellement en cache.
    await Promise.race([Promise.all([goalReady,markerReady]),new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoutes initiales indisponibles')),10000))]);
    const updated=await call('/api/goals','POST',{serviceId:1,values:{day:3,week:10,month:40},revision:initialGoals.json.goals.s1.revision},idToken);
    assert.equal(updated.status,200);assert.deepEqual(updated.json.workdays,[2,6,0]);
    const statusAfter=await Promise.race([goalEvent,new Promise((_,reject)=>setTimeout(()=>reject(Error('Notification de mise à jour des objectifs indisponible')),5000))]);
    assert.equal('goals' in statusAfter,false);assert.equal('pinMac' in statusAfter,false);stopGoal();
    const markerAfter=await Promise.race([markerEvent,new Promise((_,reject)=>setTimeout(()=>reject(Error('Marqueur récap indisponible')),5000))]);
    assert.deepEqual(Object.keys(markerAfter),['revision']);assert.notEqual(markerAfter.revision,markerOld);stopMarker();
    assert.equal((await getDocs(salesQuery)).size,2); // Le marqueur ne rentre pas dans les ventes.
    assert.equal((await call('/api/goals','POST',{serviceId:1,values:{day:4,week:10,month:40},revision:initialGoals.json.goals.s1.revision},idToken)).status,409);
    await assert.rejects(getDoc(doc(db,'pulseStatus','some-other-seller')),/permission|insufficient/i);
    await assert.rejects(getDoc(doc(db,'pulseAccess',seller.uid)),/permission|insufficient/i);
    const counts=await call(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,adminToken);
    assert.equal(counts.json.counts[0].count,2);
    assert.equal((await call('/api/admin/adjust','POST',{storeId:store,sellerId:1,serviceId:1,count:3},adminToken)).status,200);
    assert.equal((await call(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,adminToken)).json.counts[0].count,3);
    let stop;let initialResolve;const initial=new Promise(r=>{initialResolve=r});
    let deniedResolve;const denied=new Promise(r=>{deniedResolve=r});
    stop=onSnapshot(salesQuery,snapshot=>{if(snapshot.size===3)initialResolve();},error=>deniedResolve(error));
    await Promise.race([initial,new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoute temps réel indisponible')),5000))]);
    const changed=await pinProof(project,store,1,'82467913');
    const reset=await call('/api/admin/pin-reset','POST',{storeId:store,sellerId:1},adminToken);assert.equal(reset.status,200);
    // Une nouvelle vente force une réévaluation serveur d'une écoute existante.
    await storeDb.commit([storeDb.write(`pulseStores/${store}/sales/after-revocation`,{id:'after-revocation',businessDate:'2026-10-26',sellerId:1,serviceId:1,createdAt:'2026-10-26T12:00:00Z',deletedAt:null})]);
    const deniedError=await Promise.race([denied,new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoute révoquée toujours active')),5000))]);
    assert.equal(deniedError.code,'permission-denied');stop();
    await assert.rejects(getDoc(doc(db,'pulse','catalog')),/permission|insufficient/i);
    assert.equal((await call('/api/sales','POST',{serviceId:1,requestId:'emulator-sale-000002'},idToken)).status,403);
    assert.equal((await call('/api/goals','GET',undefined,idToken)).status,403);
    assert.equal((await call('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:changed})).status,200);
    const reauth=await call('/api/auth/login','POST',{storeId:store,sellerId:1,proof:changed});
    const renewed=(await signInWithCustomToken(auth,reauth.json.customToken)).user;
    assert.equal((await call('/api/goals','GET',undefined,await renewed.getIdToken())).json.goals.s1.day,3);
    // Ancienne session valide pour le mauvais magasin : les nouvelles règles doivent la refuser.
    const wrongUid='wrong-store-old-session',version='old-version';
    await storeDb.commit([storeDb.write(`pulseAccess/${wrongUid}`,{active:true,storeId:other,sellerId:1,sellerKey:'s1',version})]);
    await signInWithCustomToken(auth,fakeCustomToken(env,wrongUid,{role:'seller',storeId:other,sellerId:1,sellerKey:'s1',accessVersion:version}));
    await assert.rejects(getDocFromServer(doc(db,'pulse','catalog')),/permission|insufficient/i);
    await assert.rejects(getDocs(collection(db,'pulseStores',other,'sales')),/permission|insufficient/i);
  } finally {await deleteApp(app);}
});

test('Émulateurs Firebase : reset des ventes, pagination réelle et marqueur en temps réel',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID,uid='seller-reset-emulator';
  const app=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`reset-${Date.now()}`);
  const auth=getAuth(app),db=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8085);
  const adminUser=(await createUserWithEmailAndPassword(auth,`reset-admin-${Date.now()}@example.test`,'Testing-Password-2026')).user;
  const adminToken=await adminUser.getIdToken();
  const storeDb=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const queued=[],waits=[],worker=createWorker({createDb:()=>storeDb,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),sendFcm:async()=>{}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:adminUser.uid,PULSE_QUEUE:{async sendBatch(items){queued.push(...items.map(x=>x.body));}}};
  const ctx={waitUntil(p){waits.push(p)}};
  const message=body=>({body,acked:false,retried:false,ack(){this.acked=true;},retry(){this.retried=true;}});
  async function call(path,method='GET',body,token) {
    const req=new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const res=await worker.fetch(req,env,ctx),json=await res.json();assert.notEqual(res.status,500,JSON.stringify(json));return {status:res.status,json};
  }
  try {
    await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
    const catalog=(await call('/api/bootstrap')).json,other=catalog.stores.find(s=>s.name==='Fnac Bordeaux').id;
    const claims={role:'seller',storeId:store,sellerId:1,sellerKey:'s1',accessVersion:'version-reset-emulator'};
    const access={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:claims.accessVersion};
    await storeDb.commit([storeDb.write(`pulseAccess/${uid}`,access),storeDb.write(`pulseStatus/${uid}`,access),
      storeDb.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:{month:25,revision:'goal-revision'}}}),
      storeDb.write(`pulseStores/${store}/sales/~summary-goals~`,{revision:'keep-this-goal-marker'}),
      storeDb.write(`pulseStores/${other}/sales/other-sale-0001`,{id:'other-sale-0001',storeId:other,businessDate:'2025-01-01',sellerId:1,serviceId:1})]);
    const writes=[];
    for(let i=0;i<25;i++) {
      const id=`history-sale-${String(i).padStart(4,'0')}`;
      writes.push(storeDb.write(`pulseStores/${store}/sales/${id}`,{id,storeId:store,sellerId:1,serviceId:1,businessDate:i%2?'2026-10-30':'2025-01-01',createdAt:'2025-01-01T10:00:00.000Z',deletedAt:null,source:'sale',ownerUid:uid}),
        storeDb.write(`pulseOutbox/${id}`,{saleId:id,storeId:store,status:'queued',sellerName:'Test',serviceName:'DMax',createdAt:Date.now()}));
    }
    await storeDb.commit(writes);
    const seller=(await signInWithCustomToken(auth,fakeCustomToken(env,uid,claims))).user,idToken=await seller.getIdToken();
    const marker=doc(db,'pulseStores',store,'sales','~sales-reset~');
    assert.equal((await getDocFromServer(marker)).exists(),false);
    await assert.rejects(getDocFromServer(doc(db,'pulseStores',other,'sales','~sales-reset~')),/permission|insufficient/i);
    let readyResolve,changedResolve;const ready=new Promise(r=>readyResolve=r),changed=new Promise(r=>changedResolve=r);
    const stop=onSnapshot(marker,{includeMetadataChanges:true},snap=>{if(!snap.metadata.fromCache)readyResolve();if(snap.data()?.generation==='emulator-reset-0001')changedResolve();});
    await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoute initiale indisponible')),10000))]);
    const body={storeId:store,jobId:'emulator-reset-0001',confirmation:'SUPPRIMER'};
    assert.equal((await call('/api/admin/sales/reset','POST',body,idToken)).status,403);
    assert.equal((await call('/api/admin/sales/reset','POST',body,adminToken)).json.status,'running');
    await Promise.race([changed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Marqueur reset non reçu')),10000))]);stop();
    assert.equal((await getDocFromServer(marker)).data().generation,body.jobId);
    await assert.rejects(getDocFromServer(doc(db,'pulseSalesResets',store)),/permission|insufficient/i);
    await assert.rejects(getDocFromServer(doc(db,'pulseSalesResetRequests',body.jobId)),/permission|insufficient/i);
    assert.equal((await call(`/api/admin/counts?storeId=${store}&sellerId=1`,'GET',undefined,adminToken)).json.counts.length,0);
    assert.equal((await call('/api/sales','POST',{serviceId:1,requestId:'new-emulator-sale-0001'},idToken)).status,200);
    await Promise.all(waits.splice(0));
    // Faire tomber le premier message : le cron doit le remettre dans la file.
    queued.splice(0,queued.length);
    await worker.scheduled({cron:'*/2 * * * *'},env,ctx);await Promise.all(waits.splice(0));
    for(let i=0;i<20;i++) {
      const state=(await call(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,adminToken)).json;
      if(state.status==='done')break;
      const index=queued.findIndex(x=>x.kind==='sales-reset');assert(index>=0,'reprise de la file');
      const msg=message(queued.splice(index,1)[0]);await worker.queue({messages:[msg]},env);
      assert.equal(msg.retried,false);assert.equal(msg.acked,true);
      if(i===19)assert.fail('pagination inachevée');
    }
    const done=(await call(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,adminToken)).json;
    assert.equal(done.status,'done');assert.equal(done.deletedSales,25);
    assert.equal(await storeDb.get(`pulseStores/${store}/sales/history-sale-0000`),null);
    assert.deepEqual((await storeDb.get('pulseOutbox/history-sale-0000')).data,{status:'reset'});
    assert.equal((await storeDb.get(`pulseStores/${store}/sales/new-emulator-sale-0001`)).data.generation,body.jobId);
    assert.equal((await storeDb.get(`pulseStores/${store}/sales/~summary-goals~`)).data.revision,'keep-this-goal-marker');
    assert(await storeDb.get(`pulseStores/${other}/sales/other-sale-0001`));
    assert.equal((await storeDb.get(`pulseGoals/${uid}`)).data.goals.s1.month,25);
    assert.equal((await storeDb.get(`pulseAccess/${uid}`)).data.version,claims.accessVersion);
    assert.equal((await call('/api/admin/sales/reset','POST',body,adminToken)).json.status,'done');
    assert(await storeDb.get(`pulseStores/${store}/sales/new-emulator-sale-0001`));
  } finally {await deleteApp(app);}
});

test('Émulateurs Firebase : reset des objectifs ciblé, permissions et mises à jour en temps réel',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID,uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`;
  const app=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`goals-reset-${Date.now()}`);
  const auth=getAuth(app),db=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8085);
  const adminUser=(await createUserWithEmailAndPassword(auth,`goals-admin-${Date.now()}@example.test`,'Testing-Password-2026')).user;
  const adminToken=await adminUser.getIdToken();
  const storeDb=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const queued=[],waits=[],worker=createWorker({createDb:()=>storeDb,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString())});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:adminUser.uid,PULSE_QUEUE:{async sendBatch(items){queued.push(...items.map(x=>x.body));}}},ctx={waitUntil(p){waits.push(p)}};
  const message=body=>({body,acked:false,retried:false,ack(){this.acked=true},retry(){this.retried=true}});
  async function call(path,method='GET',body,token){const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);const json=await r.json();assert.notEqual(r.status,500,JSON.stringify(json));return {status:r.status,json};}
  try {
    await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
    const base=(await call('/api/bootstrap')).json,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id,catalog=(await storeDb.get('pulse/catalog')).data;
    catalog.sellers.find(s=>s.id===11).departmentId='editorial';catalog.sellers.find(s=>s.id===12).active=false;catalog.sellerFlags.s12=false;
    const claims={role:'seller',storeId:store,sellerId:1,sellerKey:'s1',accessVersion:'goal-reset-version'};
    const access={active:true,storeId:store,sellerId:1,sellerKey:'s1',version:claims.accessVersion};
    const uid11=`seller-${(await digestBase64(`${store}:11`)).slice(0,28)}`,uid12=`seller-${(await digestBase64(`${store}:12`)).slice(0,28)}`;
    const entry=amount=>({day:null,week:null,month:amount,revision:`revision-goal-${amount}`});
    await storeDb.commit([storeDb.write('pulse/catalog',catalog),storeDb.write(`pulseAccess/${uid}`,access),storeDb.write(`pulseStatus/${uid}`,access),
      storeDb.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:entry(17),s2:entry(0)},workdays:[2,6,0],workdaysRevision:'planning-kept'}),
      storeDb.write(`pulseGoals/${uid11}`,{storeId:store,sellerId:11,goals:{s1:entry(25)},workdays:[1,2,3,4,5]}),
      storeDb.write(`pulseGoals/${uid12}`,{storeId:store,sellerId:12,goals:{s1:entry(10)},workdays:[1,3,5]}),
      storeDb.write(`pulseStores/${store}/sales/test-sale-preserved`,{id:'test-sale-preserved',storeId:store,sellerId:1,serviceId:1,businessDate:'2025-01-01'}),
      storeDb.write(`pulseStores/${other}/sales/other-sale`,{id:'other-sale',storeId:other,businessDate:'2025-01-01'}),
      storeDb.write(`pulseStores/${store}/sales/~summary-goals~`,{revision:'marker-before'})]);
    const seller=(await signInWithCustomToken(auth,fakeCustomToken(env,uid,claims))).user,idToken=await seller.getIdToken();
    const statusRef=doc(db,'pulseStatus',uid);let readyResolve,changeResolve;
    const ready=new Promise(resolve=>readyResolve=resolve),changed=new Promise(resolve=>changeResolve=resolve);
    const stop=onSnapshot(statusRef,{includeMetadataChanges:true},snap=>{if(!snap.metadata.fromCache)readyResolve();if(snap.data()?.goalsRevision)changeResolve(snap.data());});
    await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoute initiale indisponible')),10000))]);
    const reset={storeId:store,departmentId:'tech',jobId:'emulator-goals-reset-01',confirmation:'SUPPRIMER'};
    assert.equal((await call('/api/admin/goals/reset','POST',reset,idToken)).status,403);
    assert.equal((await call('/api/admin/goals/reset','POST',reset,adminToken)).json.totalSellers,11);
    await assert.rejects(getDocFromServer(doc(db,'pulseGoalsResets',store)),/permission|insufficient/i);
    await assert.rejects(getDocFromServer(doc(db,'pulseGoalsResetRequests',reset.jobId)),/permission|insufficient/i);
    assert.equal((await call('/api/goals','POST',{serviceId:1,values:{day:null,week:null,month:45},revision:'revision-goal-17'},idToken)).status,409);
    let msg=message(queued.shift());await worker.queue({messages:[msg]},env);assert(msg.acked&&!msg.retried);
    const status=await Promise.race([changed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Mise à jour du vendeur non reçue')),10000))]);stop();
    assert.equal('goals' in status,false);assert.equal('workdays' in status,false);
    assert.deepEqual((await call('/api/goals','GET',undefined,idToken)).json.goals,{});
    assert.deepEqual((await call('/api/goals','GET',undefined,idToken)).json.workdays,[2,6,0]);
    const latest=await call('/api/goals','POST',{serviceId:1,values:{day:null,week:null,month:45},revision:null},idToken);assert.equal(latest.status,200);
    msg=message(queued.shift());await worker.queue({messages:[msg]},env);assert(msg.acked&&!msg.retried);
    const done=(await call(`/api/admin/goals/reset?storeId=${store}`,'GET',undefined,adminToken)).json;assert.equal(done.status,'done');assert.equal(done.processedSellers,11);
    assert.deepEqual((await storeDb.get(`pulseGoals/${uid12}`)).data.goals,{});assert.equal((await storeDb.get(`pulseGoals/${uid11}`)).data.goals.s1.month,25);
    assert.equal((await storeDb.get(`pulseGoals/${uid}`)).data.goals.s1.month,45);assert.equal((await storeDb.get(`pulseGoals/${uid}`)).data.workdaysRevision,'planning-kept');
    assert(await storeDb.get(`pulseStores/${store}/sales/test-sale-preserved`));assert(await storeDb.get(`pulseStores/${other}/sales/other-sale`));
    assert.equal((await storeDb.get(`pulseAccess/${uid}`)).data.version,claims.accessVersion);
    assert.notEqual((await getDocFromServer(doc(db,'pulseStores',store,'sales','~summary-goals~'))).data().revision,'marker-before');
    assert.equal((await call('/api/admin/goals/reset','POST',reset,adminToken)).json.status,'done');
    assert.equal((await storeDb.get(`pulseGoals/${uid}`)).data.goals.s1.month,45);
  } finally {await deleteApp(app);}
});

test('Émulateurs Firebase : inscription atomique et transition sans déconnexion des autres sessions',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID,app=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`pin4-${Date.now()}`);
  const auth=getAuth(app),db=getFirestore(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8085);
  const storeDb=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const env={FIREBASE_PROJECT_ID:project,PIN_PEPPER:Buffer.alloc(32,27).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  const worker=createWorker({createDb:()=>storeDb,makeCustomToken:fakeCustomToken,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString())});
  async function call(path,method='GET',body,token){const req=new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const res=await worker.fetch(req,env,ctx),json=await res.json();assert.notEqual(res.status,500,JSON.stringify(json));return {status:res.status,json};}
  try {
    await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
    assert.equal((await call('/api/bootstrap')).status,200);assert.equal((await call('/api/auth/initialize','POST',{})).status,200);
    const oldProof=await pinProof(project,store,1,'42683179'),newProof=await pinProof(project,store,1,'7294');
    const claim=await call('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:oldProof});assert.equal(claim.status,200);
    const oldUser=(await signInWithCustomToken(auth,claim.json.customToken)).user,oldToken=await oldUser.getIdToken(),oldClaims=(await oldUser.getIdTokenResult()).claims;
    const uid=oldUser.uid;assert.equal((await call('/api/goals','POST',{serviceId:1,values:{day:1,week:4,month:18},revision:null},oldToken)).status,200);
    const statusBefore=(await storeDb.get(`pulseStatus/${uid}`)).data,goalBefore=(await storeDb.get(`pulseGoals/${uid}`)).data;
    const migration=await call('/api/auth/pin/change','POST',{storeId:store,departmentId:'tech',sellerId:1,oldProof,newProof});assert.equal(migration.status,200);
    assert.equal((await storeDb.get(`pulseAccess/${uid}`)).data.version,oldClaims.accessVersion);
    assert.equal((await storeDb.get(`pulseStatus/${uid}`)).data.goalsRevision,statusBefore.goalsRevision);
    assert.deepEqual((await storeDb.get(`pulseGoals/${uid}`)).data,goalBefore);
    assert.equal((await call('/api/goals','GET',undefined,oldToken)).status,200);
    assert.equal((await getDocFromServer(doc(db,'pulse','catalog'))).exists(),true);
    assert.equal((await call('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof,openPinFlow:true})).status,409);
    assert.equal((await call('/api/auth/login','POST',{storeId:store,sellerId:1,proof:newProof,openPinFlow:true,pinFlowVersion:2})).status,200);
    const salt='firebase-salt-register-001',proof=await pinProof(project,store,null,'4519',salt),body={storeId:store,departmentId:'editorial',name:'Aurélie Émulateur',pinSalt:salt,registrationId:'firebase-register-0001',newProof:proof};
    const registered=await call('/api/auth/register','POST',body);assert.equal(registered.status,200);
    assert.equal((await call('/api/auth/register','POST',body)).json.sellerId,registered.json.sellerId);
    assert.equal((await call('/api/auth/register','POST',{...body,name:'aurelie emulateur',registrationId:'firebase-register-0002'})).status,409);
    const createdUser=(await signInWithCustomToken(auth,registered.json.customToken)).user,createdToken=await createdUser.getIdToken();
    assert.equal((await call('/api/goals','GET',undefined,createdToken)).status,200);
    assert.equal((await getDocFromServer(doc(db,'pulse','catalog'))).data().sellers.filter(x=>x.name===body.name).length,1);
    await assert.rejects(getDocFromServer(doc(db,'pulseAccess',createdUser.uid)),/permission|insufficient/i);
    await assert.rejects(getDocFromServer(doc(db,'pulseRegistrations',body.registrationId)),/permission|insufficient/i);
    const a={...body,name:'Concurrent Firebase',registrationId:'firebase-concurrent-0001',pinSalt:'firebase-salt-concurrent-1'};
    a.newProof=await pinProof(project,store,null,'1648',a.pinSalt);
    const b={...a,registrationId:'firebase-concurrent-0002',pinSalt:'firebase-salt-concurrent-2'};b.newProof=await pinProof(project,store,null,'2958',b.pinSalt);
    const concurrent=await Promise.all([call('/api/auth/register','POST',a),call('/api/auth/register','POST',b)]);
    assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
    assert.equal((await storeDb.get('pulse/catalog')).data.sellers.filter(s=>s.name===a.name).length,1);
  } finally {await deleteApp(app);}
});
