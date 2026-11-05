import {test} from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp, getApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithCustomToken, signInWithEmailAndPassword, verifyBeforeUpdateEmail, checkActionCode, applyActionCode, reload } from 'firebase/auth';
import { build } from 'esbuild';
import { mkdir, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
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
    delete legacy.storeDirectoryVersion;delete legacy.storeRegionalChoicesVersion;delete legacy.directorySync;
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
    assert.deepEqual(migratedCatalog.stores.filter(s=>s.directoryStatus==='regional-choice').map(s=>s.name),['Fnac Guadeloupe','Fnac La Réunion']);
    assert.equal((await storeDb.get('pulseBackups/catalog-before-fnac-regional-choices-v1')).data.catalog.stores.length,180);
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
    const region=(await call('/api/bootstrap')).json.stores.find(s=>s.name==='Fnac Guadeloupe');
    const regionalSalt='firebase-region-salt-2026',regionalProof=await pinProof(project,region.id,null,'3648',regionalSalt);
    const regional={storeId:region.id,departmentId:'tech',name:'Profil Régional',pinSalt:regionalSalt,registrationId:'firebase-region-register-01',newProof:regionalProof};
    assert.equal((await call('/api/auth/register','POST',regional)).status,400,'un ancien client ne crée pas de profil sans avertissement');
    const regionalCreated=await call('/api/auth/register','POST',{...regional,regionalConsent:true});assert.equal(regionalCreated.status,200);
    const regionalUser=(await signInWithCustomToken(auth,regionalCreated.json.customToken)).user;
    assert.equal((await regionalUser.getIdTokenResult()).claims.storeId,region.id);
    assert.equal((await call('/api/auth/register','POST',regional)).json.sellerId,regionalCreated.json.sellerId,'reprise idempotente sans nouveau profil');
  } finally {await deleteApp(app);}
});

test('Émulateurs Firebase : suppression vendeur paginée, session révoquée et autre équipe intacte',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID;
  const app=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`delete-${Date.now()}`);
  const auth=getAuth(app),client=getFirestore(app);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(client,'127.0.0.1',8085);
  const admin=(await createUserWithEmailAndPassword(auth,`delete-admin-${Date.now()}@example.test`,'Testing-Password-2026')).user,adminToken=await admin.getIdToken();
  const storeDb=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'}),queued=[];
  const worker=createWorker({createDb:()=>storeDb,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),makeCustomToken:fakeCustomToken,sendFcm:async()=>{}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:admin.uid,PIN_PEPPER:Buffer.alloc(32,12).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}},PULSE_QUEUE:{async sendBatch(xs){queued.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
  async function call(path,method='GET',body,token=adminToken) {
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    const json=await res.json();assert.notEqual(res.status,500,JSON.stringify(json));return {status:res.status,json};
  }
  try {
    await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
    assert.equal((await call('/api/bootstrap','GET',undefined,'')).status,200);
    const proof=await pinProof(project,store,1,'18273645');
    const claimed=await call('/api/auth/claim','POST',{storeId:store,sellerId:1,newProof:proof},'');assert.equal(claimed.status,200);
    const seller=(await signInWithCustomToken(auth,claimed.json.customToken)).user,idToken=await seller.getIdToken();
    assert((await getDocFromServer(doc(client,'pulse','catalog'))).exists());
    const uid=`seller-${(await digestBase64(`${store}:1`)).slice(0,28)}`,otherUid=`seller-${(await digestBase64(`${store}:2`)).slice(0,28)}`;
    const cat=(await storeDb.get('pulse/catalog')).data,writes=[
      storeDb.write(`pulseGoals/${uid}`,{storeId:store,sellerId:1,goals:{s1:{month:55}},workdays:[1,2,3]}),
      storeDb.write(`pulseGoals/${otherUid}`,{storeId:store,sellerId:2,goals:{s1:{month:12}},workdays:[1,5]}),
      storeDb.write('pulseRegistrations/emulator-registration-1',{uid,storeId:store,name:'Morgan',sellerId:1,pinSalt:'private-salt'}),
      storeDb.write('pulseBackups/delete-test-backup',{savedAt:'before',catalog:cat}),
      storeDb.write(`pulseStores/${store}/sales/other-emulator-sale`,{id:'other-emulator-sale',storeId:store,sellerId:2,serviceId:1,businessDate:'2020-01-01'}),
    ];
    for(let i=0;i<25;i++) {
      const id=`emulator-target-${String(i).padStart(3,'0')}`;
      writes.push(storeDb.write(`pulseStores/${store}/sales/${id}`,{id,storeId:store,sellerId:1,ownerUid:uid,serviceId:1,businessDate:'2020-01-01'}));
      writes.push(storeDb.write(`pulseOutbox/${id}`,{saleId:id,storeId:store,sellerName:'Morgan',status:'queued',createdAt:Date.now()}));
    }
    await storeDb.commit(writes);
    const deletion={storeId:store,sellerId:1,jobId:'emulator-seller-delete-0001',confirmation:'SUPPRIMER'};
    const started=await call('/api/admin/sellers/delete','POST',deletion);assert.equal(started.status,200);assert.equal(started.json.status,'running');
    assert.equal((await call('/api/sales','POST',{serviceId:1,requestId:'emulator-new-after-delete'},idToken)).status,403);
    await assert.rejects(getDocFromServer(doc(client,'pulse','catalog')),/permission|insufficient/i);
    assert.equal(await storeDb.get(`pulseGoals/${uid}`),null);
    let steps=0;
    while(queued.length){assert(++steps<50);const body=queued.shift(),msg={body,acked:false,retried:false,ack(){this.acked=true},retry(){this.retried=true}};await worker.queue({messages:[msg]},env);assert(msg.acked,`échec lot ${steps}, retry=${msg.retried}`);}
    const done=await call(`/api/admin/sellers/delete?storeId=${store}`);assert.equal(done.json.status,'done');assert.equal(done.json.deletedSales,25);
    assert.equal((await storeDb.query(`pulseStores/${store}/sales`,'sellerId','EQUAL',1)).length,0);
    assert((await storeDb.get(`pulseStores/${store}/sales/other-emulator-sale`)));
    assert.equal(await storeDb.get(`pulseAccess/${uid}`),null);assert.equal(await storeDb.get(`pulseStatus/${uid}`),null);
    assert.equal((await storeDb.get(`pulseGoals/${otherUid}`)).data.goals.s1.month,12);
    assert.deepEqual((await storeDb.get('pulseRegistrations/emulator-registration-1')).data,{status:'removed'});
    assert.deepEqual((await storeDb.get('pulseOutbox/emulator-target-000')).data,{status:'reset'});
    const backup=(await storeDb.get('pulseBackups/delete-test-backup')).data.catalog;
    assert.equal(backup.sellers.some(s=>s.id===1),false);assert(backup.sellers.some(s=>s.id===2));
    assert.equal((await call('/api/admin/sellers/delete','POST',deletion)).json.status,'done');
  } finally {await deleteApp(app);}
});

test('Émulateur Firestore : notifications seulement aux collègues et ancienne file protégée',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID;
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'}),queued=[],sent=[],waits=[];
  const worker=createWorker({createDb:()=>db,verifyIdToken:async()=>({role:'seller',sub:'author-emulator',storeId:store,sellerId:1,accessVersion:'v1'}),sendFcm:async(_env,token)=>sent.push(token)});
  const env={FIREBASE_PROJECT_ID:project,PULSE_QUEUE:{async sendBatch(xs){queued.push(...xs.map(x=>x.body));}}},ctx={waitUntil(p){waits.push(p)}};
  await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  assert.equal((await worker.fetch(new Request('https://worker.test/api/bootstrap'),env,ctx)).status,200);
  const tokens={a:'author-device-1-emulator-123456',b:'author-device-2-emulator-123456',peer:'peer-device-emulator-123456'};
  const ids=Object.fromEntries(await Promise.all(Object.entries(tokens).map(async([k,v])=>[k,await digestBase64(v)])));
  await db.commit([db.write('pulseAccess/author-emulator',{active:true,storeId:store,sellerId:1,version:'v1'}),
    db.write('pulseAccess/peer-emulator',{active:true,storeId:store,sellerId:2,version:'v2'}),
    ...['a','b'].map(k=>db.write(`pulseTokens/${ids[k]}`,{token:tokens[k],uid:'author-emulator',storeId:store,accessVersion:'v1'})),
    db.write(`pulseTokens/${ids.peer}`,{token:tokens.peer,uid:'peer-emulator',storeId:store,accessVersion:'v2'})]);
  const saleId='firestore-notification-0001';
  const req=new Request('https://worker.test/api/sales',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer author'},body:JSON.stringify({serviceId:1,requestId:saleId,originTokenId:ids.a})});
  assert.equal((await worker.fetch(req,env,ctx)).status,200);await Promise.all(waits.splice(0));
  assert.deepEqual(queued.map(x=>x.tokenId),[ids.peer]);
  const consume=async tokenId=>{const msg={body:{saleId,tokenId,storeId:store},acked:false,ack(){this.acked=true},retry(){throw Error('retry inattendu')}};await worker.queue({messages:[msg]},env);assert(msg.acked);};
  await consume(ids.b);assert.deepEqual(sent,[]); // ancien message déjà en file pour l'auteur
  await consume(ids.peer);assert.deepEqual(sent,[tokens.peer]);
  await db.commit([db.write(`pulseTokens/${ids.a}`,{token:tokens.a,uid:'peer-emulator',storeId:store,accessVersion:'v2'})]);
  await consume(ids.a);assert.deepEqual(sent,[tokens.peer]); // téléphone émetteur réaffecté
  assert.equal((await db.get(`pulseOutbox/${saleId}`)).data.originTokenId,ids.a);
});

test('Émulateur Firestore : suppression service paginée, objectifs et magasins isolés',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID;
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'}),queue=[];
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_e,t)=>t==='admin'?{sub:'administrator'}:Promise.reject(Error())});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:'administrator',PULSE_QUEUE:{async sendBatch(xs){queue.push(...xs.map(x=>x.body));}}},ctx={waitUntil(){}};
  const call=async(path,method='GET',body,token='admin')=>{const r=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);const json=await r.json();assert.notEqual(r.status,500,JSON.stringify(json));return {status:r.status,json};};
  await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  const base=(await call('/api/bootstrap','GET',undefined,'')).json,other=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
  const person=async(st,id)=>`seller-${(await digestBase64(`${st}:${id}`)).slice(0,28)}`,a=await person(store,1),b=await person(store,2),orphan=await person(store,900),otherUid=await person(other,777);
  const writes=[db.write(`pulseGoals/${a}`,{storeId:store,sellerId:1,goals:{s1:{month:10},s2:{month:30}},workdays:[1,3]}),
    db.write(`pulseGoals/${b}`,{goals:{s1:{month:20}},workdays:[2,4]}),
    db.write(`pulseGoals/${orphan}`,{storeId:store,sellerId:900,goals:{s1:{month:5}}}),
    db.write(`pulseGoals/${otherUid}`,{storeId:other,sellerId:777,goals:{s1:{month:77}}}),
    db.write(`pulseStatus/${a}`,{active:true,version:'v1',goalsRevision:'before'}),
    db.write(`pulseStores/${store}/sales/keep-other-service`,{id:'keep-other-service',storeId:store,sellerId:1,serviceId:2,businessDate:'2020-01-01'}),
    db.write(`pulseStores/${other}/sales/keep-other-store`,{id:'keep-other-store',storeId:other,sellerId:777,serviceId:1,businessDate:'2020-01-01'})];
  for(let i=0;i<25;i++) {const id=`emulator-service-${String(i).padStart(3,'0')}`;writes.push(db.write(`pulseStores/${store}/sales/${id}`,{id,storeId:store,sellerId:1,serviceId:1,businessDate:'2020-01-01'}),db.write(`pulseOutbox/${id}`,{saleId:id,storeId:store,status:'queued',createdAt:Date.now()}));}
  await db.commit(writes);
  const body={storeId:store,serviceId:1,jobId:'firestore-service-delete-01',expectedName:base.services[0].name,expectedStoreName:base.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
  assert.equal((await call('/api/admin/services/delete','POST',body)).json.status,'running');
  assert(!(await call(`/api/bootstrap?storeId=${store}`,'GET',undefined,'')).json.services.some(s=>s.id===1));
  assert((await call(`/api/bootstrap?storeId=${other}`,'GET',undefined,'')).json.services.some(s=>s.id===1));
  let steps=0;
  while(queue.length){assert(++steps<60);const body=queue.shift(),msg={body,acked:false,retried:false,ack(){this.acked=true},retry(){this.retried=true}};await worker.queue({messages:[msg]},env);assert(msg.acked,`échec lot ${steps}, retry=${msg.retried}`);}
  const done=(await call(`/api/admin/services/delete?storeId=${store}`)).json;
  assert.equal(done.status,'done');assert.equal(done.deletedSales,25);assert.equal(done.deletedGoals,3);
  assert.equal((await db.query(`pulseStores/${store}/sales`,'serviceId','EQUAL',1)).length,0);
  assert(await db.get(`pulseStores/${store}/sales/keep-other-service`));assert(await db.get(`pulseStores/${other}/sales/keep-other-store`));
  assert.equal((await db.get(`pulseGoals/${a}`)).data.goals.s1,undefined);assert.equal((await db.get(`pulseGoals/${a}`)).data.goals.s2.month,30);
  assert.deepEqual((await db.get(`pulseGoals/${a}`)).data.workdays,[1,3]);assert.equal((await db.get(`pulseGoals/${b}`)).data.goals.s1,undefined);
  assert.equal((await db.get(`pulseGoals/${orphan}`)).data.goals.s1,undefined);assert.equal((await db.get(`pulseGoals/${otherUid}`)).data.goals.s1.month,77);
  assert.notEqual((await db.get(`pulseStatus/${a}`)).data.goalsRevision,'before');assert.deepEqual((await db.get('pulseOutbox/emulator-service-000')).data,{status:'reset'});
  assert.equal((await call('/api/admin/services/delete','POST',body)).json.status,'done');
  assert.equal((await call('/api/admin/services/restore','POST',{storeId:store,serviceId:1,expectedName:body.expectedName,expectedStoreName:body.expectedStoreName})).status,200);
  assert((await call(`/api/bootstrap?storeId=${store}`,'GET',undefined,'')).json.services.some(s=>s.id===1));
  assert.equal((await db.get(`pulseGoals/${a}`)).data.goals.s1,undefined);
});

test('Émulateur Firestore : historique paginé et correction atomique des ventes choisies',{skip:!enabled},async()=>{
  const project='demo-fnac',store=LEGACY_STORE_ID;
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,token)=>{if(token!=='admin-token')throw Error('invalid');return {sub:'administrator'};}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:'administrator'},ctx={waitUntil(){}};
  async function call(path,method='GET',body,token='admin-token') {
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    const json=await res.json();assert.notEqual(res.status,500,JSON.stringify(json));return {status:res.status,json};
  }
  await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  const bootstrap=await call('/api/bootstrap','GET',undefined,''),catalog=(await db.get('pulse/catalog')).data;
  const storeName=catalog.stores.find(s=>s.id===store).name,sellerName=catalog.sellers.find(s=>s.id===1).name;
  const collection=`pulseStores/${store}/sales`,sale=(id,sellerId,date)=>({id,storeId:store,sellerId,serviceId:1,businessDate:date,createdAt:`${date}T12:00:00Z`,departmentId:'tech',source:'sale',deletedAt:null});
  const writes=[db.write(`${collection}/a-firebase-selected`,sale('a-firebase-selected',1,'2026-10-29')),
    db.write(`${collection}/a-firebase-retained`,sale('a-firebase-retained',1,'2026-10-30')),
    db.write(`${collection}/a-firebase-other`,sale('a-firebase-other',2,'2026-10-29')),
    db.write('pulseOutbox/a-firebase-selected',{saleId:'a-firebase-selected',storeId:store,status:'pending'})];
  for(let i=0;i<205;i++){const id=`z-firebase-${String(i).padStart(4,'0')}`;writes.push(db.write(`${collection}/${id}`,sale(id,2,'2026-10-29')));}
  await db.commit(writes);
  const p1=await db.salesPeriodPage(collection,{start:'2026-10-29',end:'2026-10-29',limit:5});assert.equal(p1.length,5);
  const p2=await db.salesPeriodPage(collection,{start:'2026-10-29',end:'2026-10-29',limit:5,afterDate:p1.at(-1).data.businessDate,afterId:p1.at(-1).id});
  assert.equal(p2.length,5);assert.equal(new Set([...p1,...p2].map(x=>x.id)).size,10);
  const url=`/api/admin/sales/history?storeId=${store}&sellerId=1&period=month&anchor=2026-10-29`;
  assert.equal((await call(url,'GET',undefined,'')).status,401);
  let result=await call(url);assert.equal(result.status,200);assert(result.json.next);const rows=[...result.json.sales];
  result=await call(`${url}&afterDate=${result.json.next.date}&afterId=${result.json.next.id}`);assert.equal(result.status,200);rows.push(...result.json.sales);
  assert.deepEqual(rows.map(x=>x.id).sort(),['a-firebase-retained','a-firebase-selected']);
  const body={storeId:store,sellerId:1,period:'month',anchor:'2026-10-29',saleIds:['a-firebase-selected'],requestId:'firebase-history-correction-001',confirmation:'SUPPRIMER',expectedSellerName:sellerName,expectedStoreName:storeName};
  assert.equal((await call('/api/admin/sales/correct','POST',{...body,saleIds:['a-firebase-selected','a-firebase-other']})).status,409);
  assert.equal((await db.get(`${collection}/a-firebase-selected`)).data.deletedAt,null);
  assert.equal((await call('/api/admin/sales/correct','POST',body)).json.deleted,1);
  assert((await db.get(`${collection}/a-firebase-selected`)).data.deletedAt);assert.equal((await db.get(`${collection}/a-firebase-retained`)).data.deletedAt,null);
  assert.deepEqual((await db.get('pulseOutbox/a-firebase-selected')).data,{status:'reset'});
  assert.equal((await call('/api/admin/sales/correct','POST',body)).json.duplicate,true);
});

test('Émulateurs Firebase : création multi-admin, vérifications, reprise et sessions isolées', {skip:!enabled}, async()=>{
  // The production helper creates temporary Firebase apps itself. Bundle it with
  // a test-only Auth adapter that *always* connects every app to the emulator,
  // and replace the real project config before importing any Firebase app.
  const generated=`${process.cwd()}/node_modules/.fnac-pulse-tests/admin-${process.pid}-${Date.now()}.mjs`;
  await mkdir(`${process.cwd()}/node_modules/.fnac-pulse-tests`,{recursive:true});
  const project='demo-fnac', port=9099;
  await build({entryPoints:['src/cloud.js'],outfile:generated,bundle:true,platform:'node',format:'esm',external:['firebase/*'],
    define:{'import.meta.env':JSON.stringify({VITE_CLOUD:'true',MODE:'test'})},plugins:[{name:'emulators-only',setup(b){
      b.onResolve({filter:/^\.\/firebase-config$/},()=>({path:'config',namespace:'test-config'}));
      b.onLoad({filter:/.*/,namespace:'test-config'},()=>({contents:`export const firebaseConfig=${JSON.stringify({apiKey:'demo-key',projectId:project,authDomain:'demo-fnac.firebaseapp.com',appId:'1:1:web:demo'})};`,loader:'js'}));
      b.onResolve({filter:/^firebase\/auth$/},args=>args.namespace==='test-auth'?{path:'firebase/auth',external:true}:{path:'auth',namespace:'test-auth'});
      b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:`import * as auth from 'firebase/auth'; export * from 'firebase/auth'; const seen=new WeakSet(); export function getAuth(app){const result=auth.getAuth(app);if(!seen.has(result)){auth.connectAuthEmulator(result,'http://127.0.0.1:${port}',{disableWarnings:true});seen.add(result);}return result;}`,loader:'js'}));
    }}]});
  const beforeApps=new Set(getApps().map(a=>a.name));
  const cloud=await import(pathToFileURL(generated).href);
  const adminAuth=getAuth(getApp('fnac-pulse-admin'));
  const sellerAuth=getAuth(getApp());
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const now=Date.now(),rootEmail=`root-${now}@example.test`,newEmail=`admin-${now}@example.test`,changedEmail=`changed-${now}@example.test`;
  const rootPassword='Root-password-2026!',initialPassword='Initial-password-2026!',changedPassword='Changed-password-2026!';
  const root=(await createUserWithEmailAndPassword(adminAuth,rootEmail,rootPassword)).user;
  const sellerUid=`seller-${now}`;
  await signInWithCustomToken(sellerAuth,fakeCustomToken({},sellerUid,{role:'seller',storeId:'store-test',sellerId:1,sellerKey:'s1',accessVersion:'unchanged'}));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),makeCustomToken:fakeCustomToken,sendFcm:async()=>{}});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:root.uid,PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),ALLOWED_ORIGIN:'http://example.test'};
  const ctx={waitUntil(){}};
  const call=async(path,method='GET',body,token)=>{
    const req=new Request(`https://worker.test${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const res=await worker.fetch(req,env,ctx);return {status:res.status,json:await res.json()};
  };
  const api=async(path,options={})=>{
    assert.equal(options.token,cloud.ADMIN_SESSION);
    const result=await call(path,options.method||'GET',options.body,await adminAuth.currentUser.getIdToken());
    if(result.status>=400){const e=new Error(result.json.error||'Erreur');e.status=result.status;throw e;}
    return result.json;
  };
  const oob=async()=>{
    const response=await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${project}/oobCodes`);
    assert.equal(response.status,200);return (await response.json()).oobCodes||[];
  };
  let clientApp;
  try {
    assert.match(adminAuth.config.emulator.url,/127\.0\.0\.1:9099/);
    assert.match(sellerAuth.config.emulator.url,/127\.0\.0\.1:9099/);
    const result=await cloud.createAdministrator(api,{email:newEmail,password:initialPassword,currentPassword:rootPassword});
    assert.deepEqual(result,{already:false,verificationRequired:true});
    assert.equal(adminAuth.currentUser.uid,root.uid,'le créateur reste connecté');
    assert.equal(sellerAuth.currentUser.uid,sellerUid,'la session vendeur reste ouverte');
    assert(!getApps().some(a=>a.name.startsWith('fnac-pulse-new-admin-')),'application temporaire supprimée');
    const verification=(await oob()).find(x=>x.email===newEmail&&x.requestType==='VERIFY_EMAIL');
    assert(verification?.oobCode,'le lien de vérification est créé');
    clientApp=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`admin-check-${now}`);
    const targetAuth=getAuth(clientApp);connectAuthEmulator(targetAuth,`http://127.0.0.1:${port}`,{disableWarnings:true});
    const target=(await signInWithEmailAndPassword(targetAuth,newEmail,initialPassword)).user;
    assert.equal(target.emailVerified,false);
    const pending=await db.get(`pulseAdmins/${target.uid}`);assert.equal(pending.data.active,true);assert.equal(pending.data.createdBy,root.uid);
    assert.equal((await call('/api/admin/stores/sync','POST',{},await target.getIdToken())).status,403,'aucun accès avant vérification');
    await applyActionCode(targetAuth,verification.oobCode);await reload(target);
    assert.equal(target.emailVerified,true);assert((await target.getIdTokenResult(true)).claims.email_verified);
    // The new administrator has exactly the same access; avoid writing to the
    // catalog by requesting an endpoint that validates its body after auth.
    assert.equal((await call('/api/admin/administrators','POST',{},await target.getIdToken())).status,400);
    assert.equal((await call('/api/admin/administrators','POST',{},await root.getIdToken())).status,400);
    // Direct Firestore access must never allow an admin to grant privileges.
    const targetDb=getFirestore(clientApp);connectFirestoreEmulator(targetDb,'127.0.0.1',8085);
    await assert.rejects(setDoc(doc(targetDb,'pulseAdmins','self-promoted'),{active:true}));
    await assert.rejects(cloud.createAdministrator(api,{email:newEmail,password:initialPassword,currentPassword:rootPassword}),/possède déjà un compte/);
    const retry=await cloud.createAdministrator(api,{email:newEmail,password:initialPassword,currentPassword:rootPassword,existing:true});
    assert.deepEqual(retry,{already:true,verificationRequired:false});
    assert.equal(adminAuth.currentUser.uid,root.uid);assert.equal(sellerAuth.currentUser.uid,sellerUid);
    // Firebase Auth and Firestore are separate systems. If the server commits
    // but its response is lost, retry the same grant rather than create twice.
    const lostEmail=`lost-${now}@example.test`;let drop=true;
    const lost=await cloud.createAdministrator(async(...args)=>{
      const out=await api(...args);if(drop){drop=false;throw new TypeError('réponse perdue');}return out;
    },{email:lostEmail,password:'Lost-password-2026!',currentPassword:rootPassword});
    assert.deepEqual(lost,{already:true,verificationRequired:true});
    await signInWithEmailAndPassword(targetAuth,lostEmail,'Lost-password-2026!');
    assert.equal((await db.get(`pulseAdmins/${targetAuth.currentUser.uid}`)).data.createdBy,root.uid);
    // If attribution never reaches the server, the new Firebase account is
    // harmless until the explicit existing-account recovery succeeds.
    const orphanEmail=`orphan-${now}@example.test`;
    await assert.rejects(cloud.createAdministrator(async()=>{throw new TypeError('réseau indisponible');},
      {email:orphanEmail,password:'Orphan-password-2026!',currentPassword:rootPassword}),/compte a été créé.*Compte existant/);
    await signInWithEmailAndPassword(targetAuth,orphanEmail,'Orphan-password-2026!');
    assert.equal(await db.get(`pulseAdmins/${targetAuth.currentUser.uid}`),null);
    assert.equal((await call('/api/admin/administrators','POST',{},await targetAuth.currentUser.getIdToken())).status,403);
    const recovered=await cloud.createAdministrator(api,{email:orphanEmail,password:'Orphan-password-2026!',currentPassword:rootPassword,existing:true});
    assert.deepEqual(recovered,{already:false,verificationRequired:true});
    assert.equal((await db.get(`pulseAdmins/${targetAuth.currentUser.uid}`)).data.createdBy,root.uid);
    assert.equal(sellerAuth.currentUser.uid,sellerUid);
    // A verified second admin can in turn create a third with global rights.
    await signInWithEmailAndPassword(adminAuth,newEmail,initialPassword);
    const thirdEmail=`third-${now}@example.test`;
    const third=await cloud.createAdministrator(api,{email:thirdEmail,password:'Third-password-2026!',currentPassword:initialPassword});
    assert.equal(third.verificationRequired,true);assert.equal(third.already,false);
    const thirdVerify=(await oob()).find(x=>x.email===thirdEmail&&x.requestType==='VERIFY_EMAIL');assert(thirdVerify?.oobCode);
    await signInWithEmailAndPassword(targetAuth,thirdEmail,'Third-password-2026!');
    const thirdUid=targetAuth.currentUser.uid;assert.equal((await db.get(`pulseAdmins/${thirdUid}`)).data.createdBy,target.uid);
    await applyActionCode(targetAuth,thirdVerify.oobCode);await reload(targetAuth.currentUser);
    assert.equal((await call('/api/admin/administrators','POST',{},await targetAuth.currentUser.getIdToken(true))).status,400);
    // Change only this administrator's password and request an email change.
    await cloud.changeAdminPassword(initialPassword,changedPassword);
    assert.equal(sellerAuth.currentUser.uid,sellerUid);
    await cloud.requestAdminEmailChange(changedPassword,changedEmail);
    assert.equal(await cloud.adminAccountEmail(),newEmail,'l’ancien e-mail reste en vigueur avant confirmation');
    const change=(await oob()).find(x=>x.newEmail===changedEmail&&x.requestType==='VERIFY_AND_CHANGE_EMAIL');
    assert(change?.oobCode,'le lien de changement d’e-mail est créé');
    // Un lien d'un autre compte ne doit pas être appliqué même s'il est valide.
    const foreignEmail=`foreign-changed-${now}@example.test`;
    await verifyBeforeUpdateEmail(targetAuth.currentUser,foreignEmail);
    const foreign=(await oob()).find(x=>x.newEmail===foreignEmail&&x.requestType==='VERIFY_AND_CHANGE_EMAIL');assert(foreign?.oobCode);
    const link=code=>`https://demo-fnac.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=${encodeURIComponent(code)}&apiKey=demo-key`;
    await assert.rejects(cloud.inspectAdminEmailChange(link(foreign.oobCode)),/ne correspond pas au compte/);
    assert.equal((await checkActionCode(targetAuth,foreign.oobCode)).operation,'VERIFY_AND_CHANGE_EMAIL','le lien étranger reste inutilisé');
    const proof=await cloud.inspectAdminEmailChange(link(change.oobCode));
    assert.equal(proof.newEmail,changedEmail);assert.equal(await cloud.adminAccountEmail(),newEmail,'la vérification seule ne modifie pas l’adresse');
    const confirmed=await cloud.confirmAdminEmailChange(proof);assert.equal(confirmed.email,changedEmail);
    await assert.rejects(cloud.inspectAdminEmailChange(link(change.oobCode)),/expiré ou déjà utilisé/);
    await signInWithEmailAndPassword(targetAuth,changedEmail,changedPassword);
    assert.equal(targetAuth.currentUser.uid,target.uid,'le changement conserve le même compte et les droits');
    assert.equal((await call('/api/admin/administrators','POST',{},await targetAuth.currentUser.getIdToken(true))).status,400);
    await assert.rejects(signInWithEmailAndPassword(targetAuth,newEmail,changedPassword));
    assert.equal(sellerAuth.currentUser.uid,sellerUid,'aucune révocation de la session vendeur');
  } finally {
    if(clientApp)await deleteApp(clientApp);
    for(const app of getApps())if(!beforeApps.has(app.name))await deleteApp(app);
    await unlink(generated).catch(()=>{});
  }
});

test('Émulateurs Firebase : invitation sans secret tiers, choix du mot de passe, reprise et consentement explicite', {skip:!enabled}, async()=>{
  const project='demo-fnac',port=9099,stamp=Date.now();
  const generated=`${process.cwd()}/node_modules/.fnac-pulse-tests/invitation-${process.pid}-${stamp}.mjs`;
  await mkdir(`${process.cwd()}/node_modules/.fnac-pulse-tests`,{recursive:true});
  await build({entryPoints:['src/cloud.js'],outfile:generated,bundle:true,platform:'node',format:'esm',external:['firebase/*'],
    define:{'import.meta.env':JSON.stringify({VITE_BACKEND:'cloud',MODE:'test'})},plugins:[{name:'invitation-emulators-only',setup(b){
      b.onResolve({filter:/^\.\/firebase-config$/},()=>({path:'config',namespace:'test-config'}));
      b.onLoad({filter:/.*/,namespace:'test-config'},()=>({contents:`export const firebaseConfig=${JSON.stringify({apiKey:'demo-key',projectId:project,authDomain:'demo-fnac.firebaseapp.com',appId:'1:1:web:demo'})};`,loader:'js'}));
      b.onResolve({filter:/^firebase\/auth$/},args=>args.namespace==='test-auth'?{path:'firebase/auth',external:true}:{path:'auth',namespace:'test-auth'});
      b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:`import * as auth from 'firebase/auth'; export * from 'firebase/auth';
        const seen=new WeakSet(); export function getAuth(app){const result=auth.getAuth(app);if(!seen.has(result)){auth.connectAuthEmulator(result,'http://127.0.0.1:${port}',{disableWarnings:true});seen.add(result);}return result;}
        export async function createUserWithEmailAndPassword(...args){const value=await auth.createUserWithEmailAndPassword(...args);if(globalThis.__pulseLostCreate){globalThis.__pulseLostCreate=false;throw Object.assign(Error('réponse fictive perdue'),{code:'auth/network-request-failed'});}return value;}
        export async function sendPasswordResetEmail(...args){const value=await auth.sendPasswordResetEmail(...args);if(globalThis.__pulseLostMail){globalThis.__pulseLostMail=false;throw Object.assign(Error('réponse fictive perdue'),{code:'auth/network-request-failed'});}return value;}` ,loader:'js'}));
    }}]});
  const before=new Set(getApps().map(a=>a.name)),cloud=await import(pathToFileURL(generated).href);
  const adminAuth=getAuth(getApp('fnac-pulse-admin')),sellerAuth=getAuth(getApp());
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const rootEmail=`invite-root-${stamp}@example.test`,targetEmail=`invite-new-${stamp}@example.test`,rootPassword='Root-Invitation-2026!';
  const root=(await createUserWithEmailAndPassword(adminAuth,rootEmail,rootPassword)).user;
  const sellerUid=`seller-invite-${stamp}`;await signInWithCustomToken(sellerAuth,fakeCustomToken({},sellerUid,{role:'seller',storeId:'keep-store',sellerId:1,sellerKey:'s1',accessVersion:'keep-session'}));
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),makeCustomToken:fakeCustomToken});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:root.uid,PIN_PEPPER:Buffer.alloc(32,4).toString('base64url'),LOGIN_LIMITER:{async limit(){return {success:true}}}};
  const ctx={waitUntil(){}};
  const call=async(path,body,token)=>{
    const response=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body||{})}),env,ctx);
    return {status:response.status,json:await response.json()};
  };
  const bodies=[];let dropResponse=false;
  const api=async(path,options)=>{
    assert.equal(options.token,cloud.ADMIN_SESSION);bodies.push(structuredClone(options.body));
    const result=await call(path,options.body,await adminAuth.currentUser.getIdToken());
    if(dropResponse){dropResponse=false;throw new TypeError('réponse fictive perdue');}
    if(result.status>=400){const error=Error(result.json.error);error.status=result.status;throw error;}return result.json;
  };
  const codes=async()=>(await (await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${project}/oobCodes`)).json()).oobCodes||[];
  const lastCode=async(email)=>[...await codes()].reverse().find(x=>x.email===email&&x.requestType==='PASSWORD_RESET');
  const accounts=async()=>(await (await fetch(`http://127.0.0.1:${port}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000&key=demo-key`,{headers:{Authorization:'Bearer owner'}})).json()).users||[];
  const link=code=>`https://demo-fnac.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(code)}&apiKey=demo-key`;
  const invitePath=async(email)=>`pulseAdminInvitations/${await digestBase64(`admin-invitation:${email.toLowerCase()}`)}`;
  let clientApp;
  try {
    dropResponse=true;
    const result=await cloud.inviteAdministrator(api,{email:targetEmail,currentPassword:rootPassword});
    assert.equal(result.accountCreated,true);assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1],'même requête rejouée');
    assert(!JSON.stringify(bodies).includes(rootPassword),'aucun mot de passe au Worker');
    assert.equal(adminAuth.currentUser.uid,root.uid);assert.equal(sellerAuth.currentUser.uid,sellerUid);
    assert(!getApps().some(x=>x.name.startsWith('fnac-pulse-invitation-')),'applications temporaires détruites');
    const target=(await accounts()).find(x=>x.email===targetEmail);assert(target);assert.equal(target.emailVerified,false);
    assert.equal(await db.get(`pulseAdmins/${target.localId}`),null,'aucun droit avant le choix et le consentement');
    const mail=await lastCode(targetEmail);assert(mail?.oobCode,'l’émulateur a généré un lien de réinitialisation');
    await assert.rejects(cloud.inspectAdminPasswordReset(link(mail.oobCode).replace('demo-fnac.firebaseapp.com','ailleurs.test')),/lien/);
    const proof=await cloud.inspectAdminPasswordReset(link(mail.oobCode));assert.equal(proof.email,targetEmail);
    await assert.rejects(cloud.confirmAdminPasswordReset(proof,'trop-court'),/12 à 128/);
    await cloud.confirmAdminPasswordReset(proof,'Invited-chosen-2026!');
    await assert.rejects(cloud.inspectAdminPasswordReset(link(mail.oobCode)),/expiré ou déjà utilisé/);
    assert.equal(adminAuth.currentUser.uid,root.uid);assert.equal(sellerAuth.currentUser.uid,sellerUid);
    clientApp=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`invitation-client-${stamp}`);
    const targetAuth=getAuth(clientApp);connectAuthEmulator(targetAuth,`http://127.0.0.1:${port}`,{disableWarnings:true});
    const invited=(await signInWithEmailAndPassword(targetAuth,targetEmail,'Invited-chosen-2026!')).user;
    assert.equal(invited.emailVerified,true,'la réinitialisation vérifie bien l’adresse dans l’émulateur');
    const token=await invited.getIdToken(true);
    assert.equal((await call('/api/admin/administrators',{},token)).status,403);
    assert.equal((await call('/api/auth/admin-invitations/accept',{confirmed:false},token)).status,400);
    assert.equal(await db.get(`pulseAdmins/${invited.uid}`),null);
    assert.deepEqual((await call('/api/auth/admin-invitations/accept',{confirmed:true},token)).json,{ok:true,already:false});
    assert.equal((await call('/api/auth/admin-invitations/accept',{confirmed:true},token)).json.already,true);
    assert.equal((await db.get(`pulseAdmins/${invited.uid}`)).data.createdBy,root.uid);
    assert.equal((await db.get(await invitePath(targetEmail))).data.status,'accepted');
    assert.equal((await call('/api/admin/administrators',{},token)).status,400,'mêmes droits globaux');
    // Un compte existant garde son propre mot de passe ; rien n’est modifié ni
    // attribué tant que son titulaire n’accepte pas explicitement.
    const existingEmail=`invite-existing-${stamp}@example.test`,existingPassword='Existing-Password-2026!';
    const existing=(await createUserWithEmailAndPassword(targetAuth,existingEmail,existingPassword)).user;
    const {sendEmailVerification}=await import('firebase/auth');await sendEmailVerification(existing);
    const verify=(await codes()).find(x=>x.email===existingEmail&&x.requestType==='VERIFY_EMAIL');
    const verifyLink=`https://demo-fnac.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=${encodeURIComponent(verify.oobCode)}&apiKey=demo-key`;
    const verification=await cloud.inspectAdminVerification(verifyLink);assert.equal(verification.email,existingEmail);assert.equal(existing.emailVerified,false);
    await assert.rejects(cloud.confirmAdminVerification({...verification,email:'autre@example.test'}),/ne correspond plus/);
    await cloud.confirmAdminVerification(verification);await reload(existing);assert.equal(existing.emailVerified,true);
    await assert.rejects(cloud.inspectAdminVerification(verifyLink),/expiré ou déjà utilisé/);
    const oldResult=await cloud.inviteAdministrator(api,{email:existingEmail,currentPassword:rootPassword});assert.equal(oldResult.accountCreated,false);
    assert.equal(await db.get(`pulseAdmins/${existing.uid}`),null);
    const same=(await signInWithEmailAndPassword(targetAuth,existingEmail,existingPassword)).user;assert.equal(same.uid,existing.uid);assert.equal(same.emailVerified,true);
    assert.equal((await call('/api/auth/admin-invitations/accept',{confirmed:true},await same.getIdToken(true))).status,200);
    // Création Firebase ou réponse d'envoi perdues : réinviter sans connaître
    // le secret aléatoire récupère le compte, sans attribution silencieuse.
    for(const [kind,address] of [['create',`lost-create-${stamp}@example.test`],['mail',`lost-mail-${stamp}@example.test`]]) {
      if(kind==='create')globalThis.__pulseLostCreate=true;else globalThis.__pulseLostMail=true;
      await assert.rejects(cloud.inviteAdministrator(api,{email:address,currentPassword:rootPassword}),/non confirm/);
      const pending=(await accounts()).find(x=>x.email===address);assert(pending);assert.equal(await db.get(`pulseAdmins/${pending.localId}`),null);
      const retried=await cloud.inviteAdministrator(api,{email:address,currentPassword:rootPassword});assert.equal(retried.accountCreated,false);assert((await lastCode(address))?.oobCode);
    }
    assert.equal(sellerAuth.currentUser.uid,sellerUid);assert.equal(adminAuth.currentUser.uid,root.uid);
  } finally {
    delete globalThis.__pulseLostCreate;delete globalThis.__pulseLostMail;
    if(clientApp)await deleteApp(clientApp);
    for(const app of getApps())if(!before.has(app.name))await deleteApp(app);
    await unlink(generated).catch(()=>{});
  }
});

test('Émulateurs Firebase : création directe sans e-mail, mot de passe personnel et reprise sûre', {skip:!enabled}, async()=>{
  const project='demo-fnac',port=9099,stamp=Date.now(),generated=`${process.cwd()}/node_modules/.fnac-pulse-tests/direct-${process.pid}-${stamp}.mjs`;
  await mkdir(`${process.cwd()}/node_modules/.fnac-pulse-tests`,{recursive:true});
  await build({entryPoints:['src/cloud.js'],outfile:generated,bundle:true,platform:'node',format:'esm',external:['firebase/*'],
    define:{'import.meta.env':JSON.stringify({VITE_BACKEND:'cloud',MODE:'test'})},plugins:[{name:'direct-emulators-only',setup(b){
      b.onResolve({filter:/^\.\/firebase-config$/},()=>({path:'config',namespace:'test-config'}));
      b.onLoad({filter:/.*/,namespace:'test-config'},()=>({contents:`export const firebaseConfig=${JSON.stringify({apiKey:'demo-key',projectId:project,authDomain:'demo-fnac.firebaseapp.com',appId:'1:1:web:demo'})};`,loader:'js'}));
      b.onResolve({filter:/^firebase\/auth$/},args=>args.namespace==='test-auth'?{path:'firebase/auth',external:true}:{path:'auth',namespace:'test-auth'});
      b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:`import * as auth from 'firebase/auth'; export * from 'firebase/auth';
        const seen=new WeakSet(); export function getAuth(app){const result=auth.getAuth(app);if(!seen.has(result)){auth.connectAuthEmulator(result,'http://127.0.0.1:${port}',{disableWarnings:true});seen.add(result);}return result;}
        export async function createUserWithEmailAndPassword(...args){const value=await auth.createUserWithEmailAndPassword(...args);if(globalThis.__directLostCreate){globalThis.__directLostCreate=false;throw Object.assign(Error('réponse fictive perdue'),{code:'auth/network-request-failed'});}return value;}` ,loader:'js'}));
    }}]});
  const before=new Set(getApps().map(a=>a.name)),cloud=await import(pathToFileURL(generated).href);
  const adminAuth=getAuth(getApp('fnac-pulse-admin')),sellerAuth=getAuth(getApp());
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const rootEmail=`direct-root-${stamp}@example.test`,targetEmail=`direct-new-${stamp}@example.test`,rootPassword='Root-Password-2026!';
  const tempPassword='Provisional-Password-2026!',newPassword='Personal-Password-2026!';
  const root=(await createUserWithEmailAndPassword(adminAuth,rootEmail,rootPassword)).user;
  const sellerUid=`seller-direct-${stamp}`;await signInWithCustomToken(sellerAuth,fakeCustomToken({},sellerUid,{role:'seller',storeId:'store-test',sellerId:1,sellerKey:'s1',accessVersion:'unchanged'}));
  const lookup=async(_env,idToken)=>{
    const result=await fetch(`http://127.0.0.1:${port}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
    if(!result.ok)throw Error('fictif');const json=await result.json(),u=json.users[0];
    return {localId:u.localId,email:u.email,disabled:u.disabled===true,createdAt:Number(u.createdAt),passwordUpdatedAt:Number(u.passwordUpdatedAt)};
  };
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),lookupFirebaseAccount:lookup});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:root.uid,PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),ALLOWED_ORIGIN:'http://example.test',LOGIN_LIMITER:{async limit(){return {success:true};}}};
  const ctx={waitUntil(){}};
  const call=async(path,body,token)=>{
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
    return {status:res.status,json:await res.json()};
  };
  const seenBodies=[];
  const api=async(path,options={})=>{
    assert.equal(options.token,cloud.ADMIN_SESSION);seenBodies.push({path,body:options.body});
    if(options.body)assert(!('password' in options.body)&&!('currentPassword' in options.body),'aucun mot de passe au Worker');
    const result=await call(path,options.body,await adminAuth.currentUser.getIdToken());
    if(result.status>=400){const e=new Error(result.json.error||'Erreur');e.status=result.status;throw e;}return result.json;
  };
  const codes=async()=>(await (await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${project}/oobCodes`)).json()).oobCodes||[];
  const accounts=async()=>(await (await fetch(`http://127.0.0.1:${port}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000&key=demo-key`,{headers:{Authorization:'Bearer owner'}})).json()).users||[];
  let clientApp;
  try {
    assert.match(adminAuth.config.emulator.url,/127\.0\.0\.1:9099/);assert.match(sellerAuth.config.emulator.url,/127\.0\.0\.1:9099/);
    const result=await cloud.createDirectAdministrator(api,{email:targetEmail,password:tempPassword,currentPassword:rootPassword,confirmed:true});
    assert.deepEqual(result,{already:false,accountCreated:true});assert.equal(adminAuth.currentUser.uid,root.uid);assert.equal(sellerAuth.currentUser.uid,sellerUid);
    assert(!getApps().some(a=>a.name.startsWith('fnac-pulse-direct-admin-')),'application temporaire détruite');
    assert(!(await codes()).some(x=>x.email===targetEmail),'aucun e-mail créé');
    clientApp=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`direct-check-${stamp}`);
    const targetAuth=getAuth(clientApp);connectAuthEmulator(targetAuth,`http://127.0.0.1:${port}`,{disableWarnings:true});
    const target=(await signInWithEmailAndPassword(targetAuth,targetEmail,tempPassword)).user,oldToken=await target.getIdToken(true);
    assert.equal(target.emailVerified,false,'l’exception ne prétend pas que Firebase a vérifié l’adresse');
    const grant=(await db.get(`pulseAdmins/${target.uid}`)).data;assert.equal(grant.passwordChangeRequired,true);assert.equal(grant.requiresVerifiedEmail,false);
    assert.equal((await call('/api/admin/administrators',{},oldToken)).status,403);
    assert.deepEqual((await call('/api/auth/admin-account-status',{},oldToken)).json,{passwordChangeRequired:true});
    const {updatePassword}=await import('firebase/auth');await updatePassword(target,newPassword);
    const changedToken=await target.getIdToken(true),changed=await call('/api/auth/admin-account-status',{},changedToken);
    assert.equal(changed.status,200);assert.equal(changed.json.passwordChangeRequired,false);assert.equal(changed.json.reauthenticate,true);
    assert.equal((await call('/api/admin/administrators',{},oldToken)).status,401,'un ancien jeton ne contourne pas le changement');
    await new Promise(resolve=>setTimeout(resolve,1150));
    await signInWithEmailAndPassword(targetAuth,targetEmail,newPassword);
    const fresh=await targetAuth.currentUser.getIdToken(true);
    assert.deepEqual((await call('/api/auth/admin-account-status',{},fresh)).json,{passwordChangeRequired:false});
    assert.equal((await call('/api/admin/administrators',{},fresh)).status,400,'mêmes droits globaux après reconnexion');
    await assert.rejects(signInWithEmailAndPassword(targetAuth,targetEmail,tempPassword));
    assert.equal(adminAuth.currentUser.uid,root.uid);assert.equal(sellerAuth.currentUser.uid,sellerUid);

    // Une adresse Firebase déjà existante ne doit pas être modifiée ni promue.
    const oldEmail=`direct-existing-${stamp}@example.test`,oldPass='Existing-Password-2026!';
    const existing=(await createUserWithEmailAndPassword(targetAuth,oldEmail,oldPass)).user;
    await assert.rejects(cloud.createDirectAdministrator(api,{email:oldEmail,password:oldPass,currentPassword:rootPassword,confirmed:true}),/possède déjà un compte/);
    assert.equal(await db.get(`pulseAdmins/${existing.uid}`),null);assert.equal((await signInWithEmailAndPassword(targetAuth,oldEmail,oldPass)).user.uid,existing.uid);
    // Si la réponse de création Firebase est perdue, le compte reste sans
    // droit ; la même réservation permet une reprise après contrôle Firebase.
    const lostEmail=`direct-lost-create-${stamp}@example.test`;globalThis.__directLostCreate=true;
    await assert.rejects(cloud.createDirectAdministrator(api,{email:lostEmail,password:tempPassword,currentPassword:rootPassword,confirmed:true}),/n’est pas confirmée/);
    const orphan=(await accounts()).find(u=>u.email===lostEmail);assert(orphan);assert.equal(await db.get(`pulseAdmins/${orphan.localId}`),null);
    const recovered=await cloud.createDirectAdministrator(api,{email:lostEmail,password:tempPassword,currentPassword:rootPassword,confirmed:true});
    assert.deepEqual(recovered,{already:false,accountCreated:false});assert((await db.get(`pulseAdmins/${orphan.localId}`)).data.passwordChangeRequired);
    assert(!(await codes()).some(x=>x.email===lostEmail));
    // Une réponse perdue après le commit est rejouée sans double attribution.
    const lostCommitEmail=`direct-lost-commit-${stamp}@example.test`;let drop=true;
    const lostCommit=await cloud.createDirectAdministrator(async(...args)=>{
      const response=await api(...args);if(drop&&args[0]==='/api/admin/direct-account/complete'){drop=false;throw new TypeError('réponse perdue');}return response;
    },{email:lostCommitEmail,password:tempPassword,currentPassword:rootPassword,confirmed:true});
    assert.deepEqual(lostCommit,{already:true,accountCreated:true});assert.equal(sellerAuth.currentUser.uid,sellerUid);
    assert(!(await codes()).some(x=>x.email===lostCommitEmail));
    assert(seenBodies.some(x=>x.path==='/api/admin/direct-account/complete'));
  } finally {
    delete globalThis.__directLostCreate;
    if(clientApp)await deleteApp(clientApp);
    for(const app of getApps())if(!before.has(app.name))await deleteApp(app);
    await unlink(generated).catch(()=>{});
  }
});

test('Émulateurs Firebase : code distant, secret court protégé, comptes anciens et reprises', {skip:!enabled}, async()=>{
  const project='demo-fnac',port=9099,stamp=Date.now(),generated=`${process.cwd()}/node_modules/.fnac-pulse-tests/code-${process.pid}-${stamp}.mjs`;
  await mkdir(`${process.cwd()}/node_modules/.fnac-pulse-tests`,{recursive:true});
  await build({entryPoints:['src/cloud.js'],outfile:generated,bundle:true,platform:'node',format:'esm',external:['firebase/*'],
    define:{'import.meta.env':JSON.stringify({VITE_BACKEND:'cloud',MODE:'test'})},plugins:[{name:'code-emulators-only',setup(b){
      b.onResolve({filter:/^\.\/firebase-config$/},()=>({path:'config',namespace:'test-config'}));
      b.onLoad({filter:/.*/,namespace:'test-config'},()=>({contents:`export const firebaseConfig=${JSON.stringify({apiKey:'demo-key',projectId:project,authDomain:'demo-fnac.firebaseapp.com',appId:'1:1:web:demo'})};`,loader:'js'}));
      b.onResolve({filter:/^firebase\/auth$/},args=>args.namespace==='test-auth'?{path:'firebase/auth',external:true}:{path:'auth',namespace:'test-auth'});
      b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:`import * as auth from 'firebase/auth'; export * from 'firebase/auth';
        const seen=new WeakSet(); export function getAuth(app){const result=auth.getAuth(app);if(!seen.has(result)){auth.connectAuthEmulator(result,'http://127.0.0.1:${port}',{disableWarnings:true});seen.add(result);}return result;}
        export async function setPersistence(a,p){return auth.setPersistence(a,p===auth.browserSessionPersistence?auth.inMemoryPersistence:p);}
        export async function createUserWithEmailAndPassword(...args){const value=await auth.createUserWithEmailAndPassword(...args);if(globalThis.__codeLostCreate){globalThis.__codeLostCreate=false;throw Object.assign(Error('réponse fictive perdue'),{code:'auth/network-request-failed'});}return value;}` ,loader:'js'}));
    }}]});
  const {derivedAdminCodePassword,normalizeAdminCode}=await import('../src/admin-code.js');
  const before=new Set(getApps().map(a=>a.name)),cloud=await import(pathToFileURL(generated).href);
  const adminAuth=getAuth(getApp('fnac-pulse-admin')),sellerAuth=getAuth(getApp());
  const db=new FirestoreRest({FIREBASE_PROJECT_ID:project},{base:'http://127.0.0.1:8085/v1',token:async()=> 'owner'});
  const rootEmail=`code-root-${stamp}@example.test`,targetEmail=`code-new-${stamp}@example.test`,rootPassword='Root-Password-2026!';
  const root=(await createUserWithEmailAndPassword(adminAuth,rootEmail,rootPassword)).user;
  const rootToken=await root.getIdToken(true),sellerUid=`seller-code-${stamp}`;
  await signInWithCustomToken(sellerAuth,fakeCustomToken({},sellerUid,{role:'seller',storeId:'store-test',sellerId:1,sellerKey:'s1',accessVersion:'unchanged'}));
  const lookup=async(_env,idToken)=>{
    const res=await fetch(`http://127.0.0.1:${port}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})});
    if(!res.ok)throw Error('fictif');const u=(await res.json()).users[0];
    return {localId:u.localId,email:u.email,disabled:u.disabled===true,createdAt:Number(u.createdAt),passwordUpdatedAt:Number(u.passwordUpdatedAt)};
  };
  const worker=createWorker({createDb:()=>db,verifyIdToken:async(_env,t)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString()),lookupFirebaseAccount:lookup});
  const env={FIREBASE_PROJECT_ID:project,ADMIN_UID:root.uid,PIN_PEPPER:Buffer.alloc(32,7).toString('base64url'),ALLOWED_ORIGIN:'http://example.test',LOGIN_LIMITER:{async limit(){return {success:true};}}},ctx={waitUntil(){}};
  const call=async(path,body,token)=>{
    const res=await worker.fetch(new Request(`https://worker.test${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),env,ctx);
    return {status:res.status,json:await res.json()};
  };
  const seen=[];
  const api=async(path,options={})=>{
    seen.push({path,body:options.body});if(options.body)assert(!('password' in options.body)&&!('currentPassword' in options.body),'aucun mot de passe au Worker');
    const token=options.token===cloud.ADMIN_SESSION?await adminAuth.currentUser.getIdToken():options.token||'';
    const result=await call(path,options.body,token);
    if(result.status>=400){const e=new Error(result.json.error||'Erreur');e.status=result.status;throw e;}return result.json;
  };
  const codes=async()=>(await (await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${project}/oobCodes`)).json()).oobCodes||[];
  const accounts=async()=>(await (await fetch(`http://127.0.0.1:${port}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000&key=demo-key`,{headers:{Authorization:'Bearer owner'}})).json()).users||[];
  const issue=async()=>{const x=await call('/api/admin/enrollment-code',{confirmed:true},rootToken);assert.equal(x.status,200);return x.json.code;};
  let clientApp;
  try {
    assert.match(adminAuth.config.emulator.url,/127\.0\.0\.1:9099/);assert.match(sellerAuth.config.emulator.url,/127\.0\.0\.1:9099/);
    const issued=await cloud.createAdminEnrollmentCode(api);assert(issued.code);assert.equal(adminAuth.currentUser.uid,root.uid);
    assert.equal(sellerAuth.currentUser.uid,sellerUid,'la génération ne déconnecte aucune session vendeur');
    const code=issued.code,short='123456',personal='Personal-Password-2026!';
    const result=await cloud.registerAdminWithCode(api,{code,email:targetEmail,password:short});assert.equal(result.already,false);
    assert.equal(adminAuth.currentUser.email,targetEmail);assert.equal(sellerAuth.currentUser.uid,sellerUid);
    assert(!getApps().some(a=>a.name.startsWith('fnac-pulse-code-admin-')),'auth temporaire détruite');
    const targetUid=adminAuth.currentUser.uid,oldToken=await adminAuth.currentUser.getIdToken(true);
    assert.equal(adminAuth.currentUser.emailVerified,false);assert(!(await codes()).some(x=>x.email===targetEmail),'aucun e-mail envoyé');
    const grant=(await db.get(`pulseAdmins/${targetUid}`)).data;assert.equal(grant.passwordChangeRequired,true);assert.equal(grant.provisionMethod,'code-v1');
    assert.deepEqual((await call('/api/auth/admin-account-status',{},oldToken)).json,{passwordChangeRequired:true,method:'code'});
    assert.equal((await call('/api/admin/administrators',{},oldToken)).status,403);
    const derived=await derivedAdminCodePassword({code,email:targetEmail,password:short});
    clientApp=initializeApp({apiKey:'demo-key',projectId:project,appId:'1:1:web:demo'},`code-check-${stamp}`);
    const targetAuth=getAuth(clientApp);connectAuthEmulator(targetAuth,`http://127.0.0.1:${port}`,{disableWarnings:true});
    await assert.rejects(signInWithEmailAndPassword(targetAuth,targetEmail,short),'6 caractères seuls ne connectent pas à Firebase');
    assert.equal((await signInWithEmailAndPassword(targetAuth,targetEmail,derived)).user.uid,targetUid);
    await cloud.changeFirstCodeAdminPassword(personal);
    const changedToken=await adminAuth.currentUser.getIdToken(true),changed=await call('/api/auth/admin-account-status',{},changedToken);
    assert.equal(changed.status,200);assert.equal(changed.json.reauthenticate,true);assert.equal((await call('/api/admin/administrators',{},oldToken)).status,401);
    await new Promise(resolve=>setTimeout(resolve,1150));await cloud.adminLogin(targetEmail,personal);
    assert.deepEqual((await call('/api/auth/admin-account-status',{},await adminAuth.currentUser.getIdToken(true))).json,{passwordChangeRequired:false});
    await assert.rejects(signInWithEmailAndPassword(targetAuth,targetEmail,derived));
    assert.equal(sellerAuth.currentUser.uid,sellerUid);
    const codePath=`pulseAdminCodes/${await digestBase64(`admin-code-v1:${normalizeAdminCode(code)}`)}`;
    const stored=await db.get(codePath);assert.equal(stored.data.status,'completed');assert(!JSON.stringify(stored).includes(normalizeAdminCode(code)));
    const fs=getFirestore(clientApp);connectFirestoreEmulator(fs,'127.0.0.1',8085);
    await assert.rejects(getDocFromServer(doc(fs,codePath)),'aucune lecture directe du code par le client');
    // Un compte antérieur ne peut pas être promu, même en connaissant son mot de passe.
    const oldEmail=`code-existing-${stamp}@example.test`,oldPassword='Existing-Password-2026!';
    const existing=(await createUserWithEmailAndPassword(targetAuth,oldEmail,oldPassword)).user,existingToken=await existing.getIdToken(true);
    await new Promise(resolve=>setTimeout(resolve,30));const oldCode=await issue();
    await assert.rejects(cloud.registerAdminWithCode(api,{code:oldCode,email:oldEmail,password:'1'}),/possède déjà un compte/);
    assert.equal((await call('/api/auth/admin-code/complete',{code:oldCode},existingToken)).status,409);
    assert.equal(await db.get(`pulseAdmins/${existing.uid}`),null);assert.equal((await signInWithEmailAndPassword(targetAuth,oldEmail,oldPassword)).user.uid,existing.uid);
    // Perte de la réponse Firebase : compte orphelin, puis reprise avec les mêmes informations.
    const lostEmail=`code-lost-${stamp}@example.test`,lostCode=await issue();globalThis.__codeLostCreate=true;
    await assert.rejects(cloud.registerAdminWithCode(api,{code:lostCode,email:lostEmail,password:'abc'}),/non confirmée/);
    const orphan=(await accounts()).find(u=>u.email===lostEmail);assert(orphan);assert.equal(await db.get(`pulseAdmins/${orphan.localId}`),null);
    await assert.rejects(cloud.registerAdminWithCode(api,{code:lostCode,email:lostEmail,password:'bad'}),/Impossible de reprendre/);
    const recovered=await cloud.registerAdminWithCode(api,{code:lostCode,email:lostEmail,password:'abc'});assert.equal(recovered.already,false);
    assert((await db.get(`pulseAdmins/${orphan.localId}`)).data.passwordChangeRequired);assert(!(await codes()).some(x=>x.email===lostEmail));
    // Réponse Worker perdue après le commit : replay idempotent, pas de deuxième droit.
    const commitEmail=`code-commit-${stamp}@example.test`,commitCode=await issue();let drop=true;
    const unreliable=async(...args)=>{const value=await api(...args);if(drop&&args[0]==='/api/auth/admin-code/complete'){drop=false;throw new TypeError('réponse perdue');}return value;};
    await assert.rejects(cloud.registerAdminWithCode(unreliable,{code:commitCode,email:commitEmail,password:'654321'}),/droits ne sont pas confirmés/);
    const replay=await cloud.registerAdminWithCode(api,{code:commitCode,email:commitEmail,password:'654321'});assert.equal(replay.already,true);
    assert.equal(sellerAuth.currentUser.uid,sellerUid);assert(!(await codes()).some(x=>x.email===commitEmail));
    assert(seen.some(x=>x.path==='/api/auth/admin-code/prepare'));assert(seen.some(x=>x.path==='/api/auth/admin-code/complete'));
    assert(!JSON.stringify(seen).includes('654321'));assert(!JSON.stringify(seen).includes('Personal-Password-2026!'));
  } finally {
    delete globalThis.__codeLostCreate;if(clientApp)await deleteApp(clientApp);
    for(const app of getApps())if(!before.has(app.name))await deleteApp(app);
    await unlink(generated).catch(()=>{});
  }
});
