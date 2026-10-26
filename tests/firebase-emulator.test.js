import {test} from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, getDocs, query, where, setDoc, onSnapshot } from 'firebase/firestore';
import { FirestoreRest } from '../worker/firebase.js';
import { createWorker } from '../worker/index.js';
import { pinProof } from '../src/pin.js';

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
    const bootstrap=await call('/api/bootstrap');assert.equal(bootstrap.status,200);
    const store=bootstrap.json.stores.find(s=>s.name==='Fnac Bordeaux').id,other=bootstrap.json.stores.find(s=>s.name==='Fnac Bordeaux-Lac').id;
    const proof=await pinProof(project,store,1,'73628519');
    assert.equal((await call('/api/admin/pin','POST',{storeId:store,sellerId:1,proof},adminToken)).status,200);
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
    assert.equal((await call('/api/admin/pin','POST',{storeId:store,sellerId:1,proof:changed},adminToken)).status,200);
    // Une nouvelle vente force une réévaluation serveur d'une écoute existante.
    await storeDb.commit([storeDb.write(`pulseStores/${store}/sales/after-revocation`,{id:'after-revocation',businessDate:'2026-10-26',sellerId:1,serviceId:1,createdAt:'2026-10-26T12:00:00Z',deletedAt:null})]);
    const deniedError=await Promise.race([denied,new Promise((_,reject)=>setTimeout(()=>reject(Error('Écoute révoquée toujours active')),5000))]);
    assert.equal(deniedError.code,'permission-denied');stop();
    await assert.rejects(getDoc(doc(db,'pulse','catalog')),/permission|insufficient/i);
    assert.equal((await call('/api/sales','POST',{serviceId:1,requestId:'emulator-sale-000002'},idToken)).status,403);
  } finally {await deleteApp(app);}
});
