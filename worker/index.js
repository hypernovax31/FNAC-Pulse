import locations from '../server/locations.json' with {type:'json'};
import directorySnapshot from '../server/fnac-directory.json' with {type:'json'};
import { DIRECTORY_VERSION, mergeStoreDirectory, initialDirectorySync } from '../src/store-directory.js';
import { fetchFnacDirectory, assertDirectoryCoverage, DirectorySourceError } from './fnac-source.js';
import { FirestoreRest, FirebaseError, googleAccessToken, verifyIdToken, makeCustomToken, digestBase64, pinMac, verifyPin } from './firebase.js';
import { LEGACY_STORE_ID, comparePeople, orderServices, sellerStoreId } from '../src/catalog.js';
import { validGoalValues, GOAL_PERIODS, validWorkdays, normalizeWorkdays } from '../src/goals.js';
import { saleMessage } from '../src/sale-message.js';
import { departmentsForStore, sellerDepartmentId, saleDepartmentId, TECH_DEPARTMENT_ID } from '../src/departments.js';
import { summaryGoals } from '../src/summary-goals.js';

const SELLERS=['Morgan','Anthony','Cedric','Philippe','Fabien','Florent','Eric','Tamera','Ikram','Selenia','Johan','Alice'];
const SERVICES=[['DMax','play'],['Assu Téléph','phone'],['Assu Multim','devices'],['Garantie','shield'],['FVD','package'],['FNAC +','badge'],['TRC','repeat'],['Reprise','refresh'],['Canal +','tv'],['Free','wifi'],['Autre','other']];
const PROOF=/^[A-Za-z0-9_-]{43}$/;
// Migration explicitement demandée : efface une fois tous les anciens PIN,
// sans toucher aux ventes, aux vendeurs, aux plannings ou aux objectifs.
const OPEN_PIN_RESET='open-pin-reset-2026-10-29';
const RESET_PATH=`pulseMigrations/${OPEN_PIN_RESET}`;
const SAFE_ID=/^[A-Za-z0-9_-]{8,80}$/;
const STORE_ID=/^[A-Za-z0-9_-]{1,80}$/;
// Diagnostics anonymes : aucun jeton, identifiant ou texte utilisateur dans les journaux.
const SAFE_FCM_CODES=new Set(['UNREGISTERED','INVALID_ARGUMENT','SENDER_ID_MISMATCH','QUOTA_EXCEEDED','UNAVAILABLE','INTERNAL','THIRD_PARTY_AUTH_ERROR','PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND']);
function logPushError(stage,error) {
  const status=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:0;
  const code=SAFE_FCM_CODES.has(error?.fcmCode)?error.fcmCode:'';
  console.warn('PULSE_PUSH_DIAG',stage,status,code);
}
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const cleanName=x=>typeof x==='string'?x.trim().replace(/\s+/g,' ').slice(0,60):'';
const isId=x=>Number.isSafeInteger(Number(x)) && Number(x)>0 && Number(x)<1000000;
const parisDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
const today=()=>parisDate.format(new Date());
const authHeader=req=>req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||'';
const docPath=(store,id)=>`pulseStores/${store}/sales/${id}`;
const guardPath=store=>`pulseStores/${store}/private/revision`;
// Marqueur public du magasin dans la collection déjà lisible : aucun businessDate,
// donc aucune requête de ventes ne le compte. Le '~' interdit toute collision
// avec les identifiants de ventes acceptés par l'API. Aucune cible n'est stockée ici.
const goalsMarkerPath=store=>`pulseStores/${store}/sales/~summary-goals~`;
function withFlags(data) {
  return {...data,
    sellerFlags:Object.fromEntries(data.sellers.map(s=>[`s${s.id}`,!!s.active])),
    sellerStores:Object.fromEntries(data.sellers.map(s=>[`s${s.id}`,sellerStoreId(s)])),
    storeFlags:Object.fromEntries(data.stores.map(s=>[s.id,!!s.active]))};
}
function scopedCatalog(data) {
  return withFlags({...data,catalogVersion:2,
    sellers:data.sellers.map(s=>({...s,storeId:sellerStoreId(s)})),
    services:data.services.map(s=>({...s,...(!s.priorityCode&&s.id===1?{priorityCode:'dmax'}:!s.priorityCode&&s.id===5?{priorityCode:'fvd'}:{})})),
    serviceOrders:data.serviceOrders||{}});
}
function initialStores(stores) {
  return mergeStoreDirectory(stores,directorySnapshot.stores,{legacyIds:locations.map(s=>s.id)});
}
function freshCatalog() {
  const sellers=SELLERS.map((name,i)=>({id:i+1,name,active:true,storeId:LEGACY_STORE_ID}));
  const services=SERVICES.map(([name,icon],i)=>({id:i+1,name,icon,active:true}));
  const merged=initialStores(locations.map(s=>({...s,active:true})));
  return scopedCatalog({sellers,services,stores:merged.stores,nextSellerId:sellers.length+1,nextServiceId:services.length+1,
    directoryRegions:directorySnapshot.unlinkedRegions.map(({name})=>name),
    storeDirectoryVersion:DIRECTORY_VERSION,directorySync:{...initialDirectorySync(directorySnapshot),reviewCount:merged.review.length}});
}
const publicCatalog=(data,storeId)=>({
  sellers:data.sellers.filter(s=>s.active).sort(comparePeople).map(s=>({id:s.id,name:s.name,storeId:sellerStoreId(s),departmentId:sellerDepartmentId(s)})),
  services:orderServices(data.services.filter(s=>s.active),data.serviceOrders,storeId).map(({id,name,icon})=>({id,name,icon})),
  departmentsByStore:data.departmentsByStore||{}, directoryRegions:data.directoryRegions||[],
  stores:data.stores.filter(s=>s.active&&s.directoryStatus!=='region').map(({active,...s})=>s),today:today(),stats:null,
});
function validStore(data,id) {return typeof id==='string'&&STORE_ID.test(id)&&data.storeFlags[id]===true;}
function sellerBy(data,id,storeId) {return isId(id)?data.sellers.find(s=>s.id===Number(id)&&s.active&&sellerStoreId(s)===storeId):null;}
function serviceBy(data,id) {return isId(id)?data.services.find(s=>s.id===Number(id)&&s.active):null;}
function precondition(doc) {return doc?{updateTime:doc.updateTime}:{exists:false};}
function conflict(error) {return error?.status===409 || error?.code==='ABORTED' || error?.code==='FAILED_PRECONDITION' || error?.code==='ALREADY_EXISTS';}
function response(json,status=200) {return new Response(JSON.stringify(json),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
async function readBody(req) {
  const max=16384, length=Number(req.headers.get('Content-Length')||0);
  if(length>max)fail(413,'Requête trop volumineuse.');
  const reader=req.body?.getReader(), chunks=[];let size=0;
  if(reader)while(true){
    const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>max){await reader.cancel().catch(()=>{});fail(413,'Requête trop volumineuse.');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try {const v=JSON.parse(text||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}
  catch {fail(400,'Requête invalide.');}
}
// Sauvegarde et migration sont atomiques : aucune vente ni aucun PIN ne sont modifiés.
// Les préconditions évitent d'écraser une modification administrateur simultanée.
async function catalog(db) {
  for(let attempt=0;attempt<8;attempt++) {
    const c=await db.get('pulse/catalog');
    try {
      if(!c) {
        await db.commit([db.write('pulse/catalog',freshCatalog(),{exists:false})]);
      } else {
        const scopeNeeded=c.data.catalogVersion!==2||!c.data.serviceOrders||c.data.sellers.some(s=>!s.storeId||c.data.sellerStores?.[`s${s.id}`]!==sellerStoreId(s));
        const directoryNeeded=c.data.storeDirectoryVersion!==DIRECTORY_VERSION;
        if(!scopeNeeded&&!directoryNeeded)return c;
        // La fusion clone les magasins qu’elle modifie ; ne pas recopier toutes
        // les autres données du catalogue, surtout sur le plan Workers gratuit.
        let next=scopeNeeded?scopedCatalog(c.data):{...c.data};
        if(directoryNeeded) {
          const merged=initialStores(next.stores);
          next=withFlags({...next,stores:merged.stores,storeDirectoryVersion:DIRECTORY_VERSION,
            directoryRegions:directorySnapshot.unlinkedRegions.map(({name})=>name),
            directorySync:next.directorySync||{...initialDirectorySync(directorySnapshot),reviewCount:merged.review.length}});
        }
        const writes=[];
        for(const backupPath of [
          ...(scopeNeeded?['pulseBackups/catalog-before-store-scoping-v1']:[]),
          ...(directoryNeeded?['pulseBackups/catalog-before-fnac-directory-v1']:[]),
        ]) {
          if(!await db.get(backupPath))writes.push(db.write(backupPath,{catalog:c.data,savedAt:new Date().toISOString()},{exists:false}));
        }
        writes.push(db.write('pulse/catalog',next,{updateTime:c.updateTime}));
        const committed=await db.commit(writes);
        const updateTime=committed?.writeResults?.[writes.length-1]?.updateTime;
        if(updateTime)return {...c,data:next,updateTime};
      }
    } catch(e) {if(!conflict(e))throw e;}
  }
  throw new Error('Initialisation du catalogue impossible après modifications simultanées');
}
async function sellerUid(storeId,sellerId) {return `seller-${(await digestBase64(`${storeId}:${sellerId}`)).slice(0,28)}`;}
function accessStatus(access,previous) {
  const status={active:access.active,storeId:access.storeId,sellerId:access.sellerId,sellerKey:access.sellerKey,version:access.version};
  if(previous?.data?.goalsRevision)status.goalsRevision=previous.data.goalsRevision;
  return status;
}
async function recordFailure(db,uid) {
  const path=`pulseAttempts/${uid}`;
  for(let i=0;i<8;i++) {
    const current=await db.get(path), now=Date.now();
    const old=current?.data||{};
    if(old.lockUntil>now)fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
    const failures=old.lastFailure && now-old.lastFailure<15*60*1000?(old.failures||0)+1:1;
    const next={failures,lastFailure:now,lockUntil:failures>=5?now+15*60*1000:0};
    try {await db.commit([db.write(path,next,precondition(current))]);return;}
    catch(e){if(!conflict(e))throw e;}
  }
  fail(429,'Trop de tentatives simultanées. Réessayez plus tard.');
}
async function clearFailures(db,uid) {
  const d=await db.get(`pulseAttempts/${uid}`);
  if(d)try{await db.commit([db.delete(`pulseAttempts/${uid}`,{updateTime:d.updateTime})]);}catch(e){if(!conflict(e))throw e;}
}
export async function sendFcm(env,token,sale) {
  const access=await googleAccessToken(env);
  const appUrl=new URL(env.APP_URL);
  const icon=new URL('icons/icon-192-v3.png',appUrl).href;
  const r=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,{
    method:'POST',headers:{Authorization:`Bearer ${access}`,'content-type':'application/json'},
    body:JSON.stringify({message:{token,notification:{title:'Une vente pour l’équipe !',body:saleMessage(sale.serviceName,sale.sellerName)},
      webpush:{headers:{TTL:'3600',Urgency:'normal'},notification:{icon,badge:icon,tag:`sale-${sale.saleId}`},fcm_options:{link:appUrl.href}},
      data:{saleId:sale.saleId,storeId:sale.storeId}}}),
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) {
    const unregistered=r.status===404 || data.error?.details?.some(d=>d.errorCode==='UNREGISTERED');
    const error=new Error('Envoi FCM impossible');error.unregistered=!!unregistered;error.status=r.status;
    const code=data.error?.details?.find(d=>SAFE_FCM_CODES.has(d.errorCode))?.errorCode||data.error?.status;
    if(SAFE_FCM_CODES.has(code))error.fcmCode=code;
    throw error;
  }
}

// Injected dependencies are used only by local tests; the exported production
// worker always uses Firestore, Firebase Auth, Google OAuth and FCM.
export function createWorker(deps={}) {
  const createDb=deps.createDb || (env=>new FirestoreRest(env));
  const verify=deps.verifyIdToken || verifyIdToken;
  const custom=deps.makeCustomToken || makeCustomToken;
  const send=deps.sendFcm || sendFcm;
  const directoryFetch=deps.fetchDirectory || fetch;
  let resetComplete=false;

  async function refreshDirectory(db) {
    const started=Date.now(),when=new Date(started).toISOString();
    let source=null,result='ok';
    try {
      source=await fetchFnacDirectory(directoryFetch);
      assertDirectoryCoverage(source.entries,(await catalog(db)).data.stores);
    } catch(e) {
      result=e instanceof DirectorySourceError?e.code:'unavailable';
    }
    // L'accès réseau peut durer plusieurs secondes : relire et fusionner le
    // catalogue courant, avec précondition, après la réponse de Fnac.
    for(let attempt=0;attempt<8;attempt++) {
      const c=await catalog(db),old=c.data.directorySync||initialDirectorySync(directorySnapshot);
      if(Date.parse(old.lastAttempt||0)>started)return {ok:false,result:'superseded'};
      let merged=null;
      if(source)try {
        assertDirectoryCoverage(source.entries,c.data.stores);
        merged=mergeStoreDirectory(c.data.stores,source.entries,{retireMissing:true});
      } catch(e) {
        source=null;result=e instanceof DirectorySourceError?e.code:'ambiguous';
      }
      const status={...old,lastAttempt:when,lastResult:merged?(merged.review.length?'review':'ok'):result};
      if(merged)Object.assign(status,{verifiedAt:when,lastSuccessfulSync:when,reviewCount:merged.review.length,
        review:merged.review.slice(0,50)});
      const next=withFlags({...c.data,...(merged?{stores:merged.stores}:{}),directorySync:status});
      const writes=[];
      if(merged) {
        const backupPath=`pulseBackups/catalog-before-fnac-sync-${when.slice(0,7)}`;
        if(!await db.get(backupPath))writes.push(db.write(backupPath,{catalog:c.data,savedAt:when},{exists:false}));
      }
      writes.push(db.write('pulse/catalog',next,{updateTime:c.updateTime}));
      try {await db.commit(writes);return {ok:!!merged,result:status.lastResult,reviewCount:status.reviewCount||0};}
      catch(e){if(!conflict(e))throw e;}
    }
    throw new Error('Actualisation des magasins impossible après modifications simultanées');
  }
  async function admin(req,env) {
    if(!env.ADMIN_UID)fail(503,'Administration non configurée.');
    let payload;try{payload=await verify(env,authHeader(req));}catch{fail(401,'Session administrateur expirée. Reconnectez-vous.');}
    if(payload.sub!==env.ADMIN_UID)fail(403,'Accès administrateur refusé.');return payload;
  }
  async function seller(req,env,db) {
    let p;try{p=await verify(env,authHeader(req));}catch{fail(401,'Session expirée. Reconnectez-vous.');}
    if(p.role!=='seller'||!p.sub||!STORE_ID.test(p.storeId||'')||!isId(p.sellerId))fail(403,'Accès refusé.');
    const [a,c]=await Promise.all([db.get(`pulseAccess/${p.sub}`),catalog(db)]);
    if(!a?.data?.active || a.data.version!==p.accessVersion || a.data.storeId!==p.storeId || a.data.sellerId!==Number(p.sellerId) ||
       !validStore(c.data,p.storeId) || !sellerBy(c.data,p.sellerId,p.storeId))fail(403,'Profil désactivé ou code PIN modifié. Reconnectez-vous.');
    return {claims:p,access:a.data,accessDoc:a,catalog:c.data,catalogDoc:c};
  }
  async function limitAuthentication(env,uid) {
    if(!env.LOGIN_LIMITER||!env.PIN_PEPPER)fail(503,'Protection de connexion non configurée.');
    const limit=await env.LOGIN_LIMITER.limit({key:uid});
    if(!limit.success)fail(429,'Trop de tentatives. Réessayez plus tard.');
  }
  function selectedProfile(c,body) {
    const selected=sellerBy(c.data,body.sellerId,body.storeId);
    return validStore(c.data,body.storeId)&&selected&&
      (body.departmentId===undefined||body.departmentId===sellerDepartmentId(selected));
  }
  async function signedIn(env,uid,access) {
    const claims={role:'seller',storeId:access.storeId,sellerId:access.sellerId,sellerKey:access.sellerKey,accessVersion:access.version};
    return {customToken:await custom(env,uid,claims)};
  }
  // Migration idempotente et reprenable : un seul appel peut la détenir à la
  // fois. Chaque lot vérifie le catalogue et modifie accès/statut atomiquement.
  // Les profils non encore traités sont repris par l'appel suivant. Aucune
  // donnée de vente ni d'objectif n'est réécrite.
  async function ensureOpenPinReset(db) {
    if(resetComplete)return;
    let lockId='',marker;
    for(let i=0;i<6;i++) {
      marker=await db.get(RESET_PATH);
      if(marker?.data?.state==='done'){resetComplete=true;return;}
      if(marker?.data?.lockUntil>Date.now())fail(503,'Mise à jour des accès en cours. Réessayez dans un instant.');
      lockId=crypto.randomUUID();
      const next={state:'running',cursor:Number(marker?.data?.cursor)||0,lockId,lockUntil:Date.now()+45000};
      try {await db.commit([db.write(RESET_PATH,next,precondition(marker))]);break;}
      catch(e){lockId='';if(!conflict(e))throw e;}
    }
    if(!lockId)fail(503,'Mise à jour des accès en cours. Réessayez dans un instant.');
    try {
      let completedGroups=0,collisions=0;
      while(completedGroups<4) {
        marker=await db.get(RESET_PATH);
        if(marker?.data?.lockId!==lockId)fail(503,'Mise à jour des accès en cours. Réessayez dans un instant.');
        const c=await catalog(db),cursor=Number(marker.data.cursor)||0;
        const remaining=c.data.sellers.filter(s=>Number(s.id)>cursor).sort((a,b)=>Number(a.id)-Number(b.id));
        const group=remaining.slice(0,80);
        const profiles=await Promise.all(group.map(async person=>({person,storeId:sellerStoreId(person),uid:await sellerUid(sellerStoreId(person),person.id)})));
        const paths=profiles.flatMap(({uid})=>[`pulseAccess/${uid}`,`pulseStatus/${uid}`,`pulseAttempts/${uid}`]);
        const records=paths.length?await db.getMany(paths):[];
        const writes=[db.verify('pulse/catalog',precondition(c))];
        for(let i=0;i<profiles.length;i++) {
          const {person,storeId,uid}=profiles[i],[old,status,attempt]=records.slice(i*3,i*3+3);
          const access={active:false,storeId,sellerId:Number(person.id),sellerKey:`s${Number(person.id)}`,version:crypto.randomUUID(),resetGeneration:OPEN_PIN_RESET};
          writes.push(db.write(`pulseAccess/${uid}`,access,precondition(old)),db.write(`pulseStatus/${uid}`,accessStatus(access,status),precondition(status)));
          if(attempt)writes.push(db.delete(`pulseAttempts/${uid}`,precondition(attempt)));
        }
        const finished=remaining.length<=group.length;
        const next=finished?{state:'done',finishedAt:Date.now(),cursor:group.length?Number(group.at(-1).id):cursor}:
          {state:'running',cursor:Number(group.at(-1).id),lockId,lockUntil:Date.now()+45000};
        writes.push(db.write(RESET_PATH,next,precondition(marker)));
        try {await db.commit(writes);}
        catch(e){if(conflict(e)&&collisions++<8)continue;throw e;}
        if(finished){resetComplete=true;return;}
        completedGroups++;
      }
      // Une grande équipe peut dépasser la limite de sous-requêtes Workers Free.
      // Libérer le verrou pour qu'un appel suivant reprenne au curseur enregistré.
      marker=await db.get(RESET_PATH);
      if(marker?.data?.lockId===lockId)await db.commit([db.write(RESET_PATH,{state:'running',cursor:marker.data.cursor,lockUntil:0},precondition(marker))]);
      fail(503,'Mise à jour des accès en cours. Réessayez dans un instant.');
    } catch(e) {
      // Une panne après un lot ne peut pas l'annuler ; le curseur transactionnel
      // permet de reprendre sans réinitialiser de nouveau les profils traités.
      try {marker=await db.get(RESET_PATH);if(marker?.data?.lockId===lockId)await db.commit([db.write(RESET_PATH,{state:'running',cursor:marker.data.cursor||0,lockUntil:0},precondition(marker))]);}catch{}
      throw e;
    }
  }
  async function login(req,env,db,body) {
    const {storeId,sellerId,proof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(proof||''))fail(400,'Sélection ou code PIN invalide.');
    const uid=await sellerUid(storeId,Number(sellerId));
    await limitAuthentication(env,uid);
    const [attempt,a,c]=await Promise.all([db.get(`pulseAttempts/${uid}`),db.get(`pulseAccess/${uid}`),catalog(db)]);
    if(attempt?.data?.lockUntil>Date.now())fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
    // Une ancienne interface ne sait pas créer le nouveau PIN après remise à zéro.
    // Lui demander de se mettre à jour plutôt que de bloquer le profil par erreurs.
    if(!a?.data?.active&&a?.data?.resetGeneration===OPEN_PIN_RESET&&body.openPinFlow!==true)
      fail(409,'Votre accès a été réinitialisé. Fermez puis rouvrez Fnac Pulse pour choisir un nouveau PIN.');
    if(!a?.data?.active||!selectedProfile(c,body)||!(await verifyPin(env,uid,proof,a.data.pinMac||''))) {
      await recordFailure(db,uid);fail(401,'Profil ou code PIN incorrect.');
    }
    await clearFailures(db,uid);
    return signedIn(env,uid,a.data);
  }
  async function pinStatus(db,body) {
    const {storeId,sellerId}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId))fail(400,'Sélectionnez votre magasin et votre profil.');
    await ensureOpenPinReset(db);
    const uid=await sellerUid(storeId,Number(sellerId)),[a,c]=await Promise.all([db.get(`pulseAccess/${uid}`),catalog(db)]);
    if(!selectedProfile(c,body))fail(400,'Ce profil n’est plus disponible. Contactez votre responsable.');
    return {needsPin:!a?.data?.active};
  }
  async function resetPin(db,body) {
    const {storeId,sellerId}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||body.pin!==undefined||body.proof!==undefined||body.newProof!==undefined)fail(400,'Choisissez un magasin et un vendeur.');
    await ensureOpenPinReset(db);
    const uid=await sellerUid(storeId,Number(sellerId)),accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`;
    for(let retry=0;retry<8;retry++) {
      const [old,status,c]=await Promise.all([db.get(accessPath),db.get(statusPath),catalog(db)]);
      if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId,storeId))fail(400,'Magasin ou vendeur invalide.');
      const access={active:false,storeId,sellerId:Number(sellerId),sellerKey:`s${Number(sellerId)}`,version:crypto.randomUUID(),resetGeneration:OPEN_PIN_RESET};
      try {
        await db.commit([db.verify('pulse/catalog',precondition(c)),db.write(accessPath,access,precondition(old)),db.write(statusPath,accessStatus(access,status),precondition(status))]);
        await clearFailures(db,uid);return {ok:true};
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Accès modifié simultanément. Réessayez.');
  }
  async function claimPin(env,db,body) {
    const {storeId,sellerId,newProof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(newProof||''))fail(400,'Sélection ou code PIN invalide.');
    await ensureOpenPinReset(db);
    const uid=await sellerUid(storeId,Number(sellerId)),accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`;
    await limitAuthentication(env,uid);
    for(let retry=0;retry<8;retry++) {
      const [attempt,a,c,status]=await Promise.all([db.get(`pulseAttempts/${uid}`),db.get(accessPath),catalog(db),db.get(statusPath)]);
      if(attempt?.data?.lockUntil>Date.now())fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
      if(!selectedProfile(c,body))fail(400,'Ce profil n’est plus disponible. Contactez votre responsable.');
      if(a?.data?.active)fail(409,'Ce profil possède déjà un PIN. Connectez-vous avec ce code.');
      const access={active:true,storeId,sellerId:Number(sellerId),sellerKey:`s${Number(sellerId)}`,version:crypto.randomUUID(),
        pinPersonal:true,resetGeneration:OPEN_PIN_RESET,pinMac:await pinMac(env,uid,newProof)};
      try {
        // La première création l'emporte : un second appareil ne peut ni remplacer
        // le PIN choisi, ni obtenir un jeton avec son propre PIN.
        await db.commit([db.verify('pulse/catalog',precondition(c)),db.write(accessPath,access,precondition(a)),db.write(statusPath,accessStatus(access,status),precondition(status))]);
        await clearFailures(db,uid);return signedIn(env,uid,access);
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Accès modifié simultanément. Recommencez la connexion.');
  }
  // Les objectifs sont privés : seuls le Worker et l'administrateur peuvent lire
  // pulseGoals. pulseStatus ne reçoit qu'un marqueur pour signaler un changement.
  async function goalOwner(db,storeId,sellerId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId,storeId))fail(400,'Choisissez un vendeur de ce magasin.');
    return {uid:await sellerUid(storeId,Number(sellerId)),storeId,sellerId:Number(sellerId),catalog:c.data};
  }
  function goalPayload(data) {
    return {goals:data?.goals||{},workdays:normalizeWorkdays(data?.workdays),workdaysRevision:data?.workdaysRevision||null};
  }
  async function readGoals(db,owner) {
    const doc=await db.get(`pulseGoals/${owner.uid}`);
    return goalPayload(doc?.data);
  }
  async function readSummaryGoals(db,session) {
    const storeId=session.claims.storeId,c=session.catalog;
    const members=c.sellers.filter(s=>s.active&&sellerStoreId(s)===storeId);
    const paths=await Promise.all(members.map(async s=>`pulseGoals/${await sellerUid(storeId,s.id)}`));
    const docs=db.getMany?await db.getMany(paths):await Promise.all(paths.map(path=>db.get(path)));
    const people=members.map((member,index)=>({...member,goals:docs[index]?.data?.goals||{},workdays:docs[index]?.data?.workdays}));
    return summaryGoals(people,c.services,departmentsForStore(c,storeId,{activeOnly:false}),today());
  }
  async function saveGoals(db,owner,body,accessVersion=null) {
    const serviceId=Number(body.serviceId), values=body.values, expected=body.revision;
    if(!isId(serviceId)||!serviceBy(owner.catalog,serviceId))fail(400,'Choisissez un service actif.');
    if(!validGoalValues(values))fail(400,'Les objectifs doivent être des entiers entre 0 et 9 999, ou être laissés vides.');
    if(expected!==null&&(typeof expected!=='string'||!SAFE_ID.test(expected)))fail(400,'Actualisez les objectifs avant de les modifier.');
    const goalPath=`pulseGoals/${owner.uid}`,statusPath=`pulseStatus/${owner.uid}`,key=`s${serviceId}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [goalDoc,statusDoc]=await Promise.all([db.get(goalPath),db.get(statusPath)]);
      // Une modification du PIN invalide immédiatement une écriture vendeur en cours.
      if(accessVersion!==null&&(!statusDoc?.data?.active||statusDoc.data.version!==accessVersion))fail(403,'Profil désactivé ou code PIN modifié. Reconnectez-vous.');
      const previous=goalDoc?.data?.goals?.[key];
      if((previous?.revision||null)!==expected)fail(409,'Cet objectif a changé. Rechargez ses valeurs avant de le modifier.');
      const entry={...Object.fromEntries(GOAL_PERIODS.map(period=>[period,values[period]])),revision:crypto.randomUUID()};
      // Préserver le planning personnel et les autres champs lors d'une cible.
      const next={...(goalDoc?.data||{}),storeId:owner.storeId,sellerId:owner.sellerId,goals:{...(goalDoc?.data?.goals||{}),[key]:entry}};
      const writes=[db.write(goalPath,next,precondition(goalDoc)),db.write(goalsMarkerPath(owner.storeId),{revision:crypto.randomUUID()})];
      if(statusDoc)writes.push(db.write(statusPath,{...statusDoc.data,goalsRevision:crypto.randomUUID()},precondition(statusDoc)));
      // Si le PIN est créé en parallèle, recommencer avec le statut apparu afin de
      // notifier le vendeur. Supprimer un document absent sous précondition ne le crée pas.
      else writes.push(db.delete(statusPath,{exists:false}));
      try {await db.commit(writes);return goalPayload(next);}
      catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Plusieurs modifications simultanées. Rechargez les objectifs puis réessayez.');
  }
  // Le planning est privé et réservé à l'administrateur. Une révision distincte
  // protège deux éditions simultanées, sans écraser les cibles du vendeur.
  async function saveWorkdays(db,owner,body) {
    const {workdays,revision:expected}=body;
    if(!validWorkdays(workdays))fail(400,'Choisissez de un à sept jours différents, du lundi au dimanche.');
    if(expected!==null&&(typeof expected!=='string'||!SAFE_ID.test(expected)))fail(400,'Actualisez les jours travaillés avant de les modifier.');
    const goalPath=`pulseGoals/${owner.uid}`,statusPath=`pulseStatus/${owner.uid}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [goalDoc,statusDoc]=await Promise.all([db.get(goalPath),db.get(statusPath)]);
      if((goalDoc?.data?.workdaysRevision||null)!==expected)fail(409,'Les jours travaillés ont changé. Rechargez-les avant de recommencer.');
      const next={...(goalDoc?.data||{}),storeId:owner.storeId,sellerId:owner.sellerId,
        goals:goalDoc?.data?.goals||{},workdays:normalizeWorkdays(workdays),workdaysRevision:crypto.randomUUID()};
      const writes=[db.write(goalPath,next,precondition(goalDoc)),db.write(goalsMarkerPath(owner.storeId),{revision:crypto.randomUUID()})];
      if(statusDoc)writes.push(db.write(statusPath,{...statusDoc.data,goalsRevision:crypto.randomUUID()},precondition(statusDoc)));
      else writes.push(db.delete(statusPath,{exists:false}));
      try {await db.commit(writes);return goalPayload(next);}
      catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Plusieurs modifications simultanées. Rechargez les jours travaillés puis réessayez.');
  }
  async function mutateCatalog(db,kind,id,body,method) {
    const c=await catalog(db), d=structuredClone(c.data), list=d[kind];
    if(!list || !['sellers','services'].includes(kind))fail(404,'Rubrique inconnue.');
    const duplicate=(row,name)=>list.some(x=>x.id!==row?.id&&x.active&&
      (kind!=='sellers'||sellerStoreId(x)===sellerStoreId(row))&&
      x.name.localeCompare(name,'fr',{sensitivity:'base'})===0);
    if(method==='POST') {
      const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');
      if(list.length>=(kind==='sellers'?1000:200))fail(400,'Nombre maximal atteint.');
      if(kind==='sellers'&&!validStore(d,body.storeId))fail(400,'Choisissez d’abord un magasin valide.');
      const departmentId=body.departmentId||TECH_DEPARTMENT_ID;
      if(kind==='sellers'&&!departmentsForStore(d,body.storeId).some(x=>x.id===departmentId))fail(400,'Choisissez un département actif de ce magasin.');
      const row={name,...(kind==='sellers'?{storeId:body.storeId}:{})};
      if(duplicate(row,name))fail(409,'Ce nom existe déjà dans cette liste.');
      const next=kind==='sellers'?'nextSellerId':'nextServiceId', newId=d[next]++;
      list.push({id:newId,name,active:true,...(kind==='services'?{icon:'other'}:{storeId:body.storeId,departmentId})});id=newId;
    } else {
      const row=list.find(x=>x.id===Number(id));if(!row)fail(404,'Élément introuvable.');
      if(kind==='sellers'&&body.storeId!==undefined&&body.storeId!==sellerStoreId(row))fail(400,'Ce vendeur appartient à un autre magasin.');
      if(typeof body.name==='string') {const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');row.name=name;}
      if(kind==='sellers'&&body.departmentId!==undefined) {
        if(!departmentsForStore(d,sellerStoreId(row)).some(x=>x.id===body.departmentId))fail(400,'Choisissez un département actif de ce magasin.');
        row.departmentId=body.departmentId;
      }
      if(typeof body.active==='boolean')row.active=body.active;
      if(kind==='sellers'&&row.active&&!departmentsForStore(d,sellerStoreId(row)).some(x=>x.id===sellerDepartmentId(row)))fail(409,'Réaffectez ce vendeur à un département actif.');
      if(row.active&&duplicate(row,row.name))fail(409,'Ce nom existe déjà dans cette liste.');
    }
    try{await db.commit([db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})]);}
    catch(e){if(conflict(e))fail(409,'Une modification simultanée a eu lieu. Réessayez.');throw e;}
    return {id:Number(id),ok:true};
  }
  async function mutateDepartment(db,id,body,method) {
    const c=await catalog(db),d=structuredClone(c.data),storeId=body.storeId;
    if(!validStore(d,storeId))fail(400,'Choisissez d’abord un magasin valide.');
    const list=structuredClone(departmentsForStore(d,storeId,{activeOnly:false}));
    if(method==='POST') {
      const name=cleanName(body.name);if(!name)fail(400,'Saisissez le nom du département.');
      if(list.length>=30)fail(400,'Nombre maximal de départements atteint.');
      id=`dep-${crypto.randomUUID()}`;list.push({id,name,active:true});
    } else {
      if(!STORE_ID.test(id||''))fail(400,'Département invalide.');
      const row=list.find(x=>x.id===id);if(!row)fail(404,'Département introuvable.');
      if(typeof body.name==='string'){const name=cleanName(body.name);if(!name)fail(400,'Saisissez le nom du département.');row.name=name;}
      if(typeof body.active==='boolean') {
        if(!body.active&&d.sellers.some(s=>s.active&&sellerStoreId(s)===storeId&&sellerDepartmentId(s)===id))fail(409,'Réaffectez les vendeurs actifs avant d’archiver ce département.');
        if(!body.active&&list.filter(x=>x.active).length<=1)fail(409,'Conservez au moins un département actif.');
        row.active=body.active;
      }
    }
    const changed=list.find(x=>x.id===id);
    if(changed.active&&list.some(x=>x.id!==id&&x.active&&x.name.localeCompare(changed.name,'fr',{sensitivity:'base'})===0))fail(409,'Ce département existe déjà dans ce magasin.');
    d.departmentsByStore={...(d.departmentsByStore||{}),[storeId]:list};
    try{await db.commit([db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})]);}
    catch(e){if(conflict(e))fail(409,'Une modification simultanée a eu lieu. Réessayez.');throw e;}
    return {id,ok:true};
  }
  async function saveServiceOrder(db,body) {
    const c=await catalog(db),d=structuredClone(c.data),ids=body.serviceIds;
    if(!validStore(d,body.storeId))fail(400,'Choisissez d’abord un magasin valide.');
    if(!Array.isArray(ids)||ids.length!==d.services.length||ids.some(id=>!isId(id))||new Set(ids.map(Number)).size!==ids.length||
       ids.some(id=>!d.services.some(s=>s.id===Number(id))))fail(400,'La liste des services a changé. Actualisez et réessayez.');
    d.serviceOrders={...(d.serviceOrders||{}),[body.storeId]:ids.map(Number)};
    try{await db.commit([db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})]);}
    catch(e){if(conflict(e))fail(409,'Une modification simultanée a eu lieu. Réessayez.');throw e;}
    return {ok:true};
  }
  async function addStore(db,body) {
    const c=await catalog(db),d=structuredClone(c.data),name=cleanName(body.name),lat=body.lat,lon=body.lon;
    const empty=(lat===''||lat==null)&&(lon===''||lon==null);
    if(!name)fail(400,'Saisissez le nom du magasin.');
    if(!empty&&(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||lat===''||lon===''||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180))fail(400,'Coordonnées GPS invalides.');
    if(d.stores.length>=500)fail(400,'Nombre maximal de magasins atteint.');
    if(d.stores.some(s=>s.active&&s.name.toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr')))fail(409,'Ce magasin existe déjà.');
    const id=`custom-${crypto.randomUUID()}`;d.stores.push({id,name,city:'',address:'',lat:empty?null:Number(lat),lon:empty?null:Number(lon),active:true});
    try{await db.commit([db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})]);}
    catch(e){if(conflict(e))fail(409,'Une modification simultanée a eu lieu. Réessayez.');throw e;}
    return {id};
  }
  async function findToday(db,storeId) {
    const rows=await db.query(`pulseStores/${storeId}/sales`,'businessDate','EQUAL',today(),2001);
    if(rows.length>2000)fail(409,'Plus de 2 000 opérations ce jour : correction indisponible, contactez l’administrateur.');
    return rows;
  }
  function saleAuthorizationChecks(db,session) {
    return [db.verify(`pulseAccess/${session.claims.sub}`,precondition(session.accessDoc)),db.verify('pulse/catalog',precondition(session.catalogDoc))];
  }
  async function addSale(req,env,db,ctx,body) {
    const s=await seller(req,env,db),service=serviceBy(s.catalog,body.serviceId),requestId=body.requestId;
    if(!service||!SAFE_ID.test(requestId||''))fail(400,'Service ou identifiant de vente invalide.');
    const storeId=s.claims.storeId,sellerId=Number(s.claims.sellerId),person=sellerBy(s.catalog,sellerId,storeId),departmentId=sellerDepartmentId(person);
    const data={id:requestId,storeId,sellerId,departmentId,serviceId:service.id,createdAt:new Date().toISOString(),businessDate:today(),deletedAt:null,source:'sale',clientId:typeof body.clientId==='string'?body.clientId.slice(0,80):'',ownerUid:s.claims.sub};
    const outbox={saleId:requestId,storeId,departmentId,sellerName:person.name,serviceName:service.name,status:'pending',createdAt:Date.now(),leaseUntil:0};
    try {await db.commit([...saleAuthorizationChecks(db,s),db.write(docPath(storeId,requestId),data,{exists:false}),db.write(`pulseOutbox/${requestId}`,outbox,{exists:false}),db.write(guardPath(storeId),{revision:crypto.randomUUID()})]);}
    catch(e) {
      if(!conflict(e))throw e;
      const existing=await db.get(docPath(storeId,requestId));
      if(!existing)fail(409,'Votre accès ou le catalogue a changé. Actualisez avant de réessayer.');
      if(existing.data.ownerUid!==s.claims.sub || existing.data.serviceId!==service.id)fail(409,'Identifiant de vente déjà utilisé.');
      ctx.waitUntil(dispatch(env,db,requestId).catch(e=>logPushError('dispatch',e)));return {id:requestId,duplicate:true};
    }
    ctx.waitUntil(dispatch(env,db,requestId).catch(e=>logPushError('dispatch',e)));return {id:requestId};
  }
  async function deleteSale(req,env,db,id) {
    if(!SAFE_ID.test(id||''))fail(400,'Vente invalide.');
    const s=await seller(req,env,db),path=docPath(s.claims.storeId,id),d=await db.get(path);
    if(!d||d.data.ownerUid!==s.claims.sub||d.data.businessDate!==today()||d.data.deletedAt)fail(409,'Cette vente ne peut plus être annulée.');
    try {await db.commit([...saleAuthorizationChecks(db,s),db.write(path,{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}),db.write(guardPath(s.claims.storeId),{revision:crypto.randomUUID()})]);}
    catch(e){if(conflict(e))fail(409,'Votre accès, le catalogue ou cette vente a changé. Actualisez avant de réessayer.');throw e;}
    return {ok:true,id};
  }
  async function removeLatest(req,env,db,body) {
    const s=await seller(req,env,db);if(!serviceBy(s.catalog,body.serviceId))fail(400,'Service invalide.');
    const departmentId=sellerDepartmentId(sellerBy(s.catalog,s.claims.sellerId,s.claims.storeId));
    const rows=(await findToday(db,s.claims.storeId)).filter(x=>x.data.ownerUid===s.claims.sub&&saleDepartmentId(x.data)===departmentId&&x.data.serviceId===Number(body.serviceId)&&!x.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    if(!rows.length)fail(409,'Aucune vente à retirer pour ce service aujourd’hui.');
    return deleteSale(req,env,db,rows[0].id);
  }
  async function adjust(db,body) {
    const {storeId,sellerId,serviceId,count}=body,c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId,storeId)||!serviceBy(c.data,serviceId)||!Number.isInteger(count)||count<0||count>100)fail(400,'Choisissez une quantité entre 0 et 100.');
    const guard=await db.get(guardPath(storeId));
    const rows=(await findToday(db,storeId)).filter(d=>d.data.sellerId===Number(sellerId)&&d.data.serviceId===Number(serviceId)&&!d.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    const delta=count-rows.length;if(Math.abs(delta)>100)fail(400,'Modifiez le total par étapes de 100 maximum.');
    const writes=[db.write(guardPath(storeId),{revision:crypto.randomUUID()},precondition(guard))];
    if(delta<0)for(const d of rows.slice(0,-delta))writes.push(db.write(docPath(storeId,d.id),{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}));
    if(delta>0)for(let i=0;i<delta;i++) {
      const id=crypto.randomUUID();writes.push(db.write(docPath(storeId,id),{id,storeId,sellerId:Number(sellerId),departmentId:sellerDepartmentId(sellerBy(c.data,sellerId,storeId)),serviceId:Number(serviceId),createdAt:new Date().toISOString(),businessDate:today(),deletedAt:null,source:'adjustment',clientId:'',ownerUid:await sellerUid(storeId,Number(sellerId))},{exists:false}));
    }
    try{await db.commit(writes);}catch(e){if(conflict(e))fail(409,'Les ventes ont changé pendant la correction. Réessayez.');throw e;}
    return {ok:true};
  }
  async function tokenSubscribe(req,env,db,body,method) {
    const s=await seller(req,env,db),token=body.token;
    if(typeof token!=='string'||token.length<20||token.length>4096||/[\s]/.test(token))fail(400,'Jeton de notification invalide.');
    const id=await digestBase64(token),path=`pulseTokens/${id}`,existing=await db.get(path);
    if(method==='DELETE') {
      if(existing&&existing.data.uid===s.claims.sub)try{await db.commit([db.delete(path,{updateTime:existing.updateTime})]);}catch(e){if(!conflict(e))throw e;}
    } else {
      if(!existing||existing.data.storeId!==s.claims.storeId) {
        const count=await db.query('pulseTokens','storeId','EQUAL',s.claims.storeId,1001);
        if(count.length>=1000)fail(409,'Nombre maximal d’appareils atteint pour ce magasin.');
      }
      await db.commit([db.write(path,{token,uid:s.claims.sub,storeId:s.claims.storeId,accessVersion:s.claims.accessVersion,updatedAt:Date.now()})]);
    }
    return {ok:true};
  }
  async function dispatch(env,db,id) {
    if(!env.PULSE_QUEUE)return;
    const path=`pulseOutbox/${id}`,item=await db.get(path),now=Date.now();
    if(!item||item.data.status==='queued'||(item.data.status==='dispatching'&&item.data.leaseUntil>now))return;
    if(now-item.data.createdAt>60*60*1000) {await db.commit([db.write(path,{...item.data,status:'expired'},precondition(item))]);return;}
    const claim={...item.data,status:'dispatching',leaseUntil:now+120000};
    try{await db.commit([db.write(path,claim,precondition(item))]);}catch(e){if(conflict(e))return;throw e;}
    try {
      const tokens=await db.query('pulseTokens','storeId','EQUAL',item.data.storeId,1001);
      if(tokens.length>1000)throw new Error('Trop d’appareils pour ce magasin');
      // Ne mettre en file que les appareils du département concerné. Les accès
      // sont lus par lots pour rester sous les limites de sous-requêtes du Worker.
      const paths=[...new Set(tokens.map(t=>`pulseAccess/${t.data.uid}`))];
      const [c,accesses]=await Promise.all([catalog(db),db.getMany?db.getMany(paths):Promise.all(paths.map(p=>db.get(p)))]);
      const byPath=new Map(paths.map((p,i)=>[p,accesses[i]?.data]));
      const eligible=tokens.filter(t=>{
        const a=byPath.get(`pulseAccess/${t.data.uid}`),recipient=a&&sellerBy(c.data,a.sellerId,item.data.storeId);
        return a?.active&&a.version===t.data.accessVersion&&a.storeId===item.data.storeId&&recipient&&validStore(c.data,item.data.storeId)&&
          sellerDepartmentId(recipient)===saleDepartmentId(item.data);
      });
      for(let i=0;i<eligible.length;i+=100)await env.PULSE_QUEUE.sendBatch(eligible.slice(i,i+100).map(t=>({body:{saleId:id,tokenId:t.id,storeId:item.data.storeId}})));
      const current=await db.get(path);
      if(current?.data.status==='dispatching')await db.commit([db.write(path,{...current.data,status:'queued',leaseUntil:0},precondition(current))]);
    } catch(e) {
      // A scheduled retry recovers the persistent outbox after a transient queue error.
      const current=await db.get(path).catch(()=>null);
      if(current?.data.status==='dispatching')await db.commit([db.write(path,{...current.data,status:'pending',leaseUntil:0},precondition(current))]).catch(()=>{});
      throw e;
    }
  }
  async function consume(env,db,msg) {
    const {saleId,tokenId,storeId}=msg.body||{};
    if(!SAFE_ID.test(saleId||'')||!PROOF.test(tokenId||'')||!STORE_ID.test(storeId||'')){msg.ack();return;}
    const path=`pulseDeliveries/${saleId}_${tokenId}`,prior=await db.get(path),now=Date.now();
    if(prior?.data.status==='sent'||prior?.data.status==='skipped'){msg.ack();return;}
    if(prior?.data.status==='sending'&&prior.data.leaseUntil>now){msg.retry({delaySeconds:30});return;}
    const claim={status:'sending',leaseUntil:now+60000};
    try{await db.commit([db.write(path,claim,precondition(prior))]);}catch(e){if(conflict(e)){msg.retry({delaySeconds:30});return;}throw e;}
    let stage='load';
    try {
      const skip=async()=>{const current=await db.get(path);if(current)await db.commit([db.write(path,{status:'skipped',leaseUntil:0},precondition(current))]);msg.ack();};
      const [tokenDoc,outbox]=await Promise.all([db.get(`pulseTokens/${tokenId}`),db.get(`pulseOutbox/${saleId}`)]);
      if(!tokenDoc || !outbox || tokenDoc.data.storeId!==storeId || outbox.data.storeId!==storeId || Date.now()-outbox.data.createdAt>60*60*1000) {await skip();return;}
      stage='authorize';
      const [a,c]=await Promise.all([db.get(`pulseAccess/${tokenDoc.data.uid}`),catalog(db)]);
      const recipient=a?.data&&sellerBy(c.data,a.data.sellerId,storeId);
      if(!a?.data.active||a.data.version!==tokenDoc.data.accessVersion||a.data.storeId!==storeId||!recipient||!validStore(c.data,storeId)||
         sellerDepartmentId(recipient)!==saleDepartmentId(outbox.data)){await skip();return;}
      stage='fcm';await send(env,tokenDoc.data.token,outbox.data);
      stage='mark';const current=await db.get(path);if(current)await db.commit([db.write(path,{status:'sent',leaseUntil:0,sentAt:Date.now()},precondition(current))]);
      msg.ack();
    } catch(e) {
      logPushError(stage,e);
      if(e.unregistered){const t=await db.get(`pulseTokens/${tokenId}`).catch(()=>null);if(t)await db.commit([db.delete(`pulseTokens/${tokenId}`,precondition(t))]).catch(()=>{});msg.ack();return;}
      const current=await db.get(path).catch(()=>null);if(current)await db.commit([db.write(path,{status:'pending',leaseUntil:0},precondition(current))]).catch(()=>{});
      msg.retry();
    }
  }
  async function routes(req,env,ctx) {
    const db=createDb(env),url=new URL(req.url),path=url.pathname,method=req.method;
    if(method==='GET'&&path==='/api/health')return {ok:true};
    if(method==='GET'&&path==='/api/bootstrap')return publicCatalog((await catalog(db)).data,url.searchParams.get('storeId'));
    if(method==='POST'&&path==='/api/auth/login')return login(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/initialize'){await ensureOpenPinReset(db);return {ok:true};}
    if(method==='POST'&&path==='/api/auth/status')return pinStatus(db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/claim')return claimPin(env,db,await readBody(req));
    if(method==='POST'&&(path==='/api/auth/activate'||path==='/api/auth/personal-pin'))fail(409,'Mettez Fnac Pulse à jour en la fermant puis en la rouvrant.');
    if((method==='GET'||method==='POST')&&path==='/api/goals') {
      const s=await seller(req,env,db);
      const owner={uid:s.claims.sub,storeId:s.claims.storeId,sellerId:Number(s.claims.sellerId),catalog:s.catalog};
      const selection=method==='GET'?Object.fromEntries(url.searchParams):await readBody(req);
      // Le jeton reste la source de vérité ; refuser une ancienne sélection si
      // l'identité du navigateur change pendant qu'une requête est en cours.
      if((Object.hasOwn(selection,'storeId')&&selection.storeId!==owner.storeId)||
         (Object.hasOwn(selection,'sellerId')&&Number(selection.sellerId)!==owner.sellerId))fail(403,'Votre profil a changé. Reconnectez-vous.');
      return method==='GET'?readGoals(db,owner):saveGoals(db,owner,selection,s.claims.accessVersion);
    }
    if(method==='GET'&&path==='/api/summary-goals') {
      const s=await seller(req,env,db),requested=url.searchParams.get('storeId');
      if(requested&&requested!==s.claims.storeId)fail(403,'Accès à ce magasin refusé.');
      return readSummaryGoals(db,s);
    }
    if(method==='POST'&&path==='/api/sales')return addSale(req,env,db,ctx,await readBody(req));
    if(method==='POST'&&path==='/api/sales/remove')return removeLatest(req,env,db,await readBody(req));
    const sale=path.match(/^\/api\/sales\/([A-Za-z0-9_-]+)$/);
    if(method==='DELETE'&&sale)return deleteSale(req,env,db,sale[1]);
    if((method==='POST'||method==='DELETE')&&path==='/api/push/subscribe')return tokenSubscribe(req,env,db,await readBody(req),method);
    if(path.startsWith('/api/admin/')) {
      await admin(req,env);
      if(method==='GET'&&path==='/api/admin/all'){const d=(await catalog(db)).data;return {sellers:d.sellers,services:d.services,serviceOrders:d.serviceOrders||{},departmentsByStore:d.departmentsByStore||{},directorySync:d.directorySync||null};}
      if(method==='POST'&&path==='/api/admin/stores/sync')return refreshDirectory(db);
      const department=path.match(/^\/api\/admin\/departments(?:\/([A-Za-z0-9_-]+))?$/);
      if(department&&((method==='POST'&&!department[1])||(method==='PATCH'&&department[1])))return mutateDepartment(db,department[1],await readBody(req),method);
      if(method==='POST'&&path==='/api/admin/pin-reset')return resetPin(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/pin-activation')fail(409,'Mettez Fnac Pulse à jour en la fermant puis en la rouvrant.');
      if(method==='GET'&&path==='/api/admin/goals')return readGoals(db,await goalOwner(db,url.searchParams.get('storeId'),url.searchParams.get('sellerId')));
      if(method==='POST'&&path==='/api/admin/goals') {
        const body=await readBody(req), owner=await goalOwner(db,body.storeId,body.sellerId);
        return saveGoals(db,owner,body);
      }
      if(method==='POST'&&path==='/api/admin/workdays') {
        const body=await readBody(req), owner=await goalOwner(db,body.storeId,body.sellerId);
        return saveWorkdays(db,owner,body);
      }
      if(method==='POST'&&path==='/api/admin/services/order')return saveServiceOrder(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/stores')return addStore(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/adjust')return adjust(db,await readBody(req));
      const entity=path.match(/^\/api\/admin\/entities\/(sellers|services)(?:\/(\d+))?$/);
      if(entity&&((method==='POST'&&!entity[2])||(method==='PATCH'&&entity[2])))return mutateCatalog(db,entity[1],entity[2],await readBody(req),method);
      if(method==='GET'&&path==='/api/admin/counts') {
        const storeId=url.searchParams.get('storeId'),sellerId=Number(url.searchParams.get('sellerId')),c=(await catalog(db)).data;
        if(!validStore(c,storeId)||!sellerBy(c,sellerId,storeId))fail(400,'Sélection invalide.');
        const counts=new Map();for(const x of await findToday(db,storeId))if(x.data.sellerId===sellerId&&!x.data.deletedAt)counts.set(x.data.serviceId,(counts.get(x.data.serviceId)||0)+1);
        return {counts:[...counts].map(([serviceId,count])=>({serviceId,count}))};
      }
    }
    fail(404,'Adresse introuvable.');
  }
  return {
    async fetch(req,env,ctx) {
      const origin=req.headers.get('Origin');
      if(origin&&origin!==env.ALLOWED_ORIGIN)return response({error:'Origine non autorisée.'},403);
      const cors=origin?{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','vary':'Origin'}:{};
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
      try {const out=await routes(req,env,ctx);const res=response(out);for(const [k,v] of Object.entries(cors))res.headers.set(k,v);return res;}
      catch(e) {
        const status=e instanceof HttpError?e.status:(e instanceof FirebaseError&&e.status===429?503:500);
        const message=e instanceof HttpError?e.message:'Service temporairement indisponible. Réessayez.';
        if(status===500)console.error('Erreur Fnac Pulse Worker:',e?.code||e?.name||'unknown');
        const res=response({error:message},status);for(const [k,v] of Object.entries(cors))res.headers.set(k,v);return res;
      }
    },
    async scheduled(event,env,ctx) {
      const db=createDb(env);
      if(event.cron==='0 6 1 * *') {
        ctx.waitUntil(refreshDirectory(db).catch(e=>console.warn('PULSE_DIRECTORY_SYNC',e?.code||e?.name||'error')));
        return;
      }
      ctx.waitUntil((async()=>{
        for(const status of ['pending','dispatching']) {
          const jobs=await db.query('pulseOutbox','status','EQUAL',status,1);
          for(const j of jobs)await dispatch(env,db,j.id).catch(e=>logPushError('dispatch',e));
        }
      })());
    },
    async queue(batch,env) {const db=createDb(env);for(const msg of batch.messages)await consume(env,db,msg);},
  };
}
export default createWorker();
