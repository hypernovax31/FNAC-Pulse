import locations from '../server/locations.json' with {type:'json'};
import directorySnapshot from '../server/fnac-directory.json' with {type:'json'};
import { DIRECTORY_VERSION, REGIONAL_CHOICES_VERSION, mergeStoreDirectory, mergeRegionalChoices, initialDirectorySync } from '../src/store-directory.js';
import { fetchFnacDirectory, assertDirectoryCoverage, validateFnacDirectoryCopy, DirectorySourceError } from './fnac-source.js';
import { FirestoreRest, FirebaseError, googleAccessToken, verifyIdToken, makeCustomToken, lookupFirebaseAccount, digestBase64, pinMac, verifyPin } from './firebase.js';
import { LEGACY_STORE_ID, comparePeople, sellerStoreId, serviceRemovedForStore, servicesForStore } from '../src/catalog.js';
import { validGoalValues, validWorkdays, normalizeWorkdays } from '../src/goals.js';
import { updateGoalEntry } from '../src/goal-policy.js';
import { saleMessage } from '../src/sale-message.js';
import { departmentsForStore, sellerDepartmentId, saleDepartmentId, TECH_DEPARTMENT_ID } from '../src/departments.js';
import { summaryGoals } from '../src/summary-goals.js';
import { SALES_RESET_CONFIRMATION, salesGeneration, saleInGeneration } from '../src/sales-reset.js';
import { GOALS_RESET_CONFIRMATION } from '../src/goals-reset.js';
import { SELLER_DELETE_CONFIRMATION } from '../src/seller-delete.js';
import { SERVICE_DELETE_CONFIRMATION } from '../src/service-delete.js';
import { MAX_SALE_CORRECTION, SALE_CORRECTION_CONFIRMATION, SALE_ADDITION_CONFIRMATION, saleHistoryRange, validAdditionDate, saleCorrectionFingerprintInput, saleAdditionFingerprintInput } from '../src/sale-history.js';
import { cleanSellerName, sameSellerName, validSellerName } from '../src/seller-registration.js';
import { createAdminCode, formatAdminCode, normalizeAdminCode } from '../src/admin-code.js';

const SELLERS=['Morgan','Anthony','Cedric','Philippe','Fabien','Florent','Eric','Tamera','Ikram','Selenia','Johan','Alice'];
const SERVICES=[['DMax','play'],['Assu Téléph','phone'],['Assu Multim','devices'],['Garantie','shield'],['FVD','package'],['FNAC +','badge'],['TRC','repeat'],['Reprise','refresh'],['Canal +','tv'],['Free','wifi'],['Autre','other']];
const PROOF=/^[A-Za-z0-9_-]{43}$/;
const PIN_SALT=/^[A-Za-z0-9_-]{16,80}$/;
// Identifiant historique conservé pour reconnaître les réinitialisations
// ciblées. Le reset global de 2026 est terminé et ne peut plus être relancé.
const OPEN_PIN_RESET='open-pin-reset-2026-10-29';
const SAFE_ID=/^[A-Za-z0-9_-]{8,80}$/;
const SALE_DOC_ID=/^[A-Za-z0-9_-]{1,128}$/;
const STORE_ID=/^[A-Za-z0-9_-]{1,80}$/;
// Les UID enregistrés comme administrateurs sont uniquement ceux de Firebase
// Auth, jamais un e-mail ni une identité fournie sans jeton signé.
const ADMIN_ID=/^[A-Za-z0-9_-]{1,128}$/;
const ADMIN_RECENT_SECONDS=5*60;
const ADMIN_INVITATION_MS=7*24*60*60*1000;
// Une reprise d'une création interrompue est autorisée pendant sept jours ;
// seul un compte Firebase né après cette réservation peut bénéficier de
// l'exception de confirmation d'adresse consentie par l'administrateur.
const ADMIN_DIRECT_MS=7*24*60*60*1000;
const ADMIN_CODE_TTL_MS=24*60*60*1000;
const ADMIN_CODE_RESUME_MS=7*24*60*60*1000;
const ADMIN_DIRECT_SOURCE='direct-v1';
const ADMIN_MANUAL_SOURCE='manual-approval-v1';
const ADMIN_CODE_METHOD='code-v1';
const normalizeAdminEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validAdminEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
// Marqueur public sans donnée personnelle, lisible par les vendeurs du magasin.
// Les documents de suivi et d'idempotence restent privés au Worker.
const salesMarkerPath=store=>`pulseStores/${store}/sales/~sales-reset~`;
const salesResetPath=store=>`pulseSalesResets/${store}`;
const salesResetRequestPath=id=>`pulseSalesResetRequests/${id}`;
// Le suivi du reset des objectifs est privé : seuls les marqueurs existants de
// statut vendeur et de récapitulatif sont visibles par les clients autorisés.
const goalsResetPath=store=>`pulseGoalsResets/${store}`;
const goalsResetRequestPath=id=>`pulseGoalsResetRequests/${id}`;
const sellerDeletePath=store=>`pulseSellerDeletes/${store}`;
const sellerDeleteRequestPath=id=>`pulseSellerDeleteRequests/${id}`;
const serviceDeletePath=store=>`pulseServiceDeletes/${store}`;
const serviceDeleteRequestPath=id=>`pulseServiceDeleteRequests/${id}`;
const SERVICE_DELETE_BATCH_SIZE=20;
const SERVICE_GOAL_BATCH_SIZE=10;
const RESET_BATCH_SIZE=20;
const GOALS_RESET_BATCH_SIZE=10;
const SELLER_DELETE_BATCH_SIZE=20;
function withFlags(data) {
  return {...data,
    sellerFlags:Object.fromEntries(data.sellers.map(s=>[`s${s.id}`,!!s.active])),
    sellerStores:Object.fromEntries(data.sellers.map(s=>[`s${s.id}`,sellerStoreId(s)])),
    storeFlags:Object.fromEntries(data.stores.map(s=>[s.id,!!s.active]))};
}
// Une sauvegarde créée pendant une suppression ne doit pas réintroduire le profil.
function backupCatalog(data) {
  if(!data.sellers?.some(s=>s.deletingJob))return data;
  return withFlags({...data,sellers:data.sellers.filter(s=>!s.deletingJob)});
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
  const regional=mergeRegionalChoices(merged.stores,directorySnapshot.unlinkedRegions);
  return scopedCatalog({sellers,services,stores:regional.stores,nextSellerId:sellers.length+1,nextServiceId:services.length+1,
    directoryRegions:directorySnapshot.unlinkedRegions.map(({name})=>name),
    storeDirectoryVersion:DIRECTORY_VERSION,storeRegionalChoicesVersion:REGIONAL_CHOICES_VERSION,
    directorySync:{...initialDirectorySync(directorySnapshot),reviewCount:merged.review.length,regionalReviewCount:regional.review.length,regionalReview:regional.review}});
}
const publicCatalog=(data,storeId)=>({
  sellers:data.sellers.filter(s=>s.active).sort(comparePeople).map(s=>({id:s.id,name:s.name,storeId:sellerStoreId(s),departmentId:sellerDepartmentId(s)})),
  services:servicesForStore(data,storeId).map(({id,name,icon})=>({id,name,icon})),
  departmentsByStore:data.departmentsByStore||{}, directoryRegions:data.directoryRegions||[],
  stores:data.stores.filter(s=>s.active&&s.directoryStatus!=='region').map(({active,...s})=>s),today:today(),stats:null,
});
function validStore(data,id) {return typeof id==='string'&&STORE_ID.test(id)&&data.storeFlags[id]===true;}
function sellerBy(data,id,storeId) {return isId(id)?data.sellers.find(s=>s.id===Number(id)&&s.active&&sellerStoreId(s)===storeId):null;}
function serviceBy(data,id,storeId) {return isId(id)&&!serviceRemovedForStore(data,storeId,id)?data.services.find(s=>s.id===Number(id)&&s.active):null;}
function precondition(doc) {return doc?{updateTime:doc.updateTime}:{exists:false};}
function conflict(error) {return error?.status===409 || error?.code==='ABORTED' || error?.code==='FAILED_PRECONDITION' || error?.code==='ALREADY_EXISTS';}
function response(json,status=200) {return new Response(JSON.stringify(json),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
async function readBody(req,max=16384) {
  const length=Number(req.headers.get('Content-Length')||0);
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
        const regionalNeeded=c.data.storeRegionalChoicesVersion!==REGIONAL_CHOICES_VERSION;
        if(!scopeNeeded&&!directoryNeeded&&!regionalNeeded)return c;
        // La fusion clone les magasins qu’elle modifie ; ne pas recopier toutes
        // les autres données du catalogue, surtout sur le plan Workers gratuit.
        let next=scopeNeeded?scopedCatalog(c.data):{...c.data};
        if(directoryNeeded) {
          const merged=initialStores(next.stores);
          next=withFlags({...next,stores:merged.stores,storeDirectoryVersion:DIRECTORY_VERSION,
            directoryRegions:directorySnapshot.unlinkedRegions.map(({name})=>name),
            directorySync:next.directorySync||{...initialDirectorySync(directorySnapshot),reviewCount:merged.review.length}});
        }
        if(regionalNeeded) {
          const regional=mergeRegionalChoices(next.stores,directorySnapshot.unlinkedRegions);
          next=withFlags({...next,stores:regional.stores,storeRegionalChoicesVersion:REGIONAL_CHOICES_VERSION,
            directorySync:{...(next.directorySync||initialDirectorySync(directorySnapshot)),regionalReviewCount:regional.review.length,regionalReview:regional.review}});
        }
        const writes=[];
        for(const backupPath of [
          ...(scopeNeeded?['pulseBackups/catalog-before-store-scoping-v1']:[]),
          ...(directoryNeeded?['pulseBackups/catalog-before-fnac-directory-v1']:[]),
          ...(regionalNeeded?['pulseBackups/catalog-before-fnac-regional-choices-v1']:[]),
        ]) {
          if(!await db.get(backupPath))writes.push(db.write(backupPath,{catalog:backupCatalog(c.data),savedAt:new Date().toISOString()},{exists:false}));
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
// Réserver une tentative avant de vérifier le dérivé : même en cas de requêtes
// simultanées, cinq essais au plus peuvent atteindre la comparaison du PIN.
// Une vérification réussie efface ensuite le compteur.
async function reservePinAttempt(db,uid,accessDoc) {
  const path=`pulseAttempts/${uid}`;
  for(let i=0;i<8;i++) {
    const current=await db.get(path), now=Date.now();
    const old=current?.data||{};
    if(old.lockUntil>now)fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
    const failures=old.lastFailure && now-old.lastFailure<15*60*1000?(old.failures||0)+1:1;
    const next={failures,lastFailure:now,lockUntil:failures>=5?now+15*60*1000:0};
    // Empêche une requête PIN déjà en cours de recréer un compteur après
    // suppression ou désactivation de l'accès vendeur.
    try {await db.commit([db.verify(`pulseAccess/${uid}`,precondition(accessDoc)),db.write(path,next,precondition(current))]);return;}
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
      // Trois impulsions courtes, uniquement lorsque le navigateur et le
      // système autorisent encore cette option Web Push non standard.
      webpush:{headers:{TTL:'3600',Urgency:'normal'},notification:{icon,badge:icon,tag:`sale-${sale.saleId}`,vibrate:[70,70,70,70,70]},fcm_options:{link:appUrl.href}},
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
  const lookupAccount=deps.lookupFirebaseAccount || lookupFirebaseAccount;
  const send=deps.sendFcm || sendFcm;
  const directoryFetch=deps.fetchDirectory || fetch;

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
        if(!await db.get(backupPath))writes.push(db.write(backupPath,{catalog:backupCatalog(c.data),savedAt:when},{exists:false}));
      }
      writes.push(db.write('pulse/catalog',next,{updateTime:c.updateTime}));
      try {await db.commit(writes);return {ok:!!merged,result:status.lastResult,reviewCount:status.reviewCount||0};}
      catch(e){if(!conflict(e))throw e;}
    }
    throw new Error('Actualisation des magasins impossible après modifications simultanées');
  }
  // Repli explicite : l'administrateur fournit une copie de la page complète.
  // Sa provenance et sa date ne peuvent pas être attestées par le serveur :
  // aucun magasin absent n'est rétrogradé ou supprimé et verifiedAt ne bouge pas.
  async function importDirectoryCopy(db,body) {
    let source;try {source=validateFnacDirectoryCopy(body?.declared,body?.entries);}
    catch(e) {fail(400,e?.code==='incomplete'?'Copie incomplète : aucun magasin n’a été modifié.':'Copie de l’annuaire invalide : aucun magasin n’a été modifié.');}
    const started=Date.now(),when=new Date(started).toISOString();
    for(let attempt=0;attempt<8;attempt++) {
      const c=await catalog(db),old=c.data.directorySync||initialDirectorySync(directorySnapshot);
      if(Date.parse(old.lastManualImport||0)>started)fail(409,'Un import plus récent a déjà été effectué.');
      if(Date.parse(old.lastSuccessfulSync||0)>started)fail(409,'Une vérification officielle plus récente a abouti. Rechargez l’annuaire avant d’importer.');
      let merged;
      try {
        assertDirectoryCoverage(source.entries,c.data.stores);
        merged=mergeStoreDirectory(c.data.stores,source.entries,{retireMissing:false,manual:true});
      } catch(e) {fail(409,e?.code==='incomplete'?'Copie trop incomplète par rapport à la liste conservée : aucun magasin n’a été modifié.':e?.message==='Trop de noms historiques pour ce magasin'?'Un magasin possède trop de noms précédents à conserver : vérification nécessaire. Aucun magasin n’a été modifié.':'Correspondances ambiguës : aucun magasin n’a été modifié.');}
      const status={...old,lastManualImport:when,manualDeclared:source.declared,manualCount:source.entries.length,
        manualReviewCount:merged.review.length,manualReview:merged.review.slice(0,50)};
      const next=withFlags({...c.data,stores:merged.stores,directorySync:status}),writes=[];
      const backupPath=`pulseBackups/catalog-before-fnac-manual-${when.slice(0,7)}`;
      if(!await db.get(backupPath))writes.push(db.write(backupPath,{catalog:backupCatalog(c.data),savedAt:when},{exists:false}));
      writes.push(db.write('pulse/catalog',next,{updateTime:c.updateTime}));
      try {await db.commit(writes);return {ok:true,imported:source.entries.length-merged.review.length,reviewCount:merged.review.length};}
      catch(e){if(!conflict(e))throw e;}
    }
    throw new Error('Import de l’annuaire impossible après modifications simultanées');
  }
  async function checkAdminGrant(payload,grant,{allowPasswordChange=false}={}) {
    if(!ADMIN_ID.test(payload.sub||'')||payload.role==='seller'||payload.firebase?.sign_in_provider!=='password'||!grant?.data?.active)
      fail(403,'Accès administrateur refusé.');
    const email=normalizeAdminEmail(payload.email);
    if(grant.data.source===ADMIN_MANUAL_SOURCE) {
      // L'UID ET l'adresse approuvés sont liés, même si Firebase signale plus
      // tard une autre adresse comme vérifiée. L'approbation humaine ne
      // prétend jamais être une vérification Firebase de la boîte e-mail.
      if(grant.data.requiresVerifiedEmail!==false||!validAdminEmail(email)||
         grant.data.manualEmailDigest!==await digestBase64(`manual-admin-email:${email}`))fail(403,'L’adresse du compte ne correspond plus à l’accès validé.');
    } else if(payload.email_verified!==true) {
      const direct=grant.data.source===ADMIN_DIRECT_SOURCE&&grant.data.requiresVerifiedEmail===false&&
        validAdminEmail(email)&&grant.data.directEmailDigest===await digestBase64(`direct-admin-email:${email}`);
      if(!direct)fail(403,'Confirmez votre adresse e-mail avec le lien reçu avant de vous connecter.');
    }
    if(grant.data.source===ADMIN_DIRECT_SOURCE&&!allowPasswordChange) {
      if(grant.data.passwordChangeRequired!==false)fail(403,'Choisissez d’abord votre propre mot de passe administrateur.');
      const changed=grant.data.passwordChangedAt;
      if(!Number.isFinite(changed)||!Number.isFinite(payload.auth_time)||payload.auth_time<=Math.floor(changed/1000))
        fail(401,'Reconnectez-vous avec votre nouveau mot de passe.');
    }
  }
  async function admin(req,env,db,{allowPasswordChange=false}={}) {
    if(!env.ADMIN_UID)fail(503,'Administration non configurée.');
    let payload;try{payload=await verify(env,authHeader(req));}catch{fail(401,'Session administrateur expirée. Reconnectez-vous.');}
    // L'UID historique conserve exactement son accès et ses sessions.
    if(payload.sub===env.ADMIN_UID)return payload;
    await checkAdminGrant(payload,await db.get(`pulseAdmins/${payload.sub}`),{allowPasswordChange});
    return payload;
  }
  async function adminActorChecks(db,env,actor) {
    if(actor.sub===env.ADMIN_UID)return [];
    const path=`pulseAdmins/${actor.sub}`,grant=await db.get(path);
    await checkAdminGrant(actor,grant);
    return [db.verify(path,precondition(grant))];
  }
  function recentAdminAuthentication(payload) {
    const now=Math.floor(Date.now()/1000);
    return Number.isFinite(payload?.auth_time)&&payload.auth_time>=now-ADMIN_RECENT_SECONDS&&payload.auth_time<=now+10;
  }
  const validManualEmail=email=>validAdminEmail(email)&&!/[;,<>]/.test(email);
  async function manualRequestPath(email) {
    return `pulseAdminAccessRequests/${await digestBase64(`manual-admin-request:${email}`)}`;
  }
  function noPasswordBody(body) {
    return body&&body.password===undefined&&body.currentPassword===undefined&&body.newPassword===undefined;
  }
  async function addManualAdminRequest(env,db,actor,body) {
    const email=normalizeAdminEmail(body?.email);
    if(!noPasswordBody(body)||!validManualEmail(email))fail(400,'Indiquez une adresse e-mail valide.');
    if(normalizeAdminEmail(actor.email)===email)fail(409,'Cette adresse correspond à votre propre compte.');
    await limitAuthentication(env,`manual-admin-add:${actor.sub}`);
    const path=await manualRequestPath(email);
    for(let attempt=0;attempt<8;attempt++) {
      const [previous,checks]=await Promise.all([db.get(path),adminActorChecks(db,env,actor)]),old=previous?.data;
      if(old&&['invited','pending','approved'].includes(old.status))
        return {ok:true,already:true,status:old.status};
      const now=Date.now(),record={requestId:crypto.randomUUID(),email,status:'invited',createdBy:actor.sub,createdAt:now};
      try {await db.commit([...checks,db.write(path,record,precondition(previous))]);return {ok:true,already:false,status:'invited'};}
      catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'La demande a changé. Actualisez la liste.');
  }
  async function listManualAdminRequests(db,after='') {
    // Le curseur est le hash de l’adresse (nom du document), jamais l’adresse
    // elle-même. Seuls les dossiers encore ouverts sont lus, par pages bornées.
    if(after&&!/^[A-Za-z0-9_-]{43}$/.test(after))fail(400,'Curseur de demandes invalide.');
    const rows=await db.page('pulseAdminAccessRequests',{field:'status',op:'IN',value:['invited','pending'],limit:51,after});
    const page=rows.slice(0,50);
    return {requests:page.map(x=>x.data).filter(x=>['invited','pending'].includes(x.status)&&
      validManualEmail(normalizeAdminEmail(x.email))&&SAFE_ID.test(x.requestId||''))
      .map(x=>({requestId:x.requestId,email:x.email,status:x.status,createdAt:x.createdAt,
        ...(x.status==='pending'&&ADMIN_ID.test(x.claimantUid||'')?{claimantUid:x.claimantUid,claimedAt:x.claimedAt}:{})}))
      .sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||b.createdAt-a.createdAt),
      next:rows.length>50?page.at(-1).id:null};
  }
  async function checkManualAdminRequest(req,env,db,body) {
    const email=normalizeAdminEmail(body?.email);
    if(!noPasswordBody(body)||!validManualEmail(email))fail(400,'Indiquez une adresse e-mail valide.');
    const raw=req.headers.get('cf-connecting-ip')||'unknown',address=raw.length<=80?raw:'unknown';
    await limitAuthentication(env,`manual-admin-check:${await digestBase64(address)}`);
    const request=await db.get(await manualRequestPath(email));
    return {allowed:!!request&&['invited','pending','approved'].includes(request.data.status)};
  }
  async function claimManualAdminRequest(req,env,db,body) {
    if(!noPasswordBody(body))fail(400,'Demande invalide.');
    let user;try {user=await verify(env,authHeader(req));}catch{fail(401,'Reconnectez-vous avec l’adresse et le mot de passe du compte.');}
    const email=normalizeAdminEmail(user.email);
    if(!ADMIN_ID.test(user.sub||'')||user.sub===env.ADMIN_UID||user.role==='seller'||
       user.firebase?.sign_in_provider!=='password'||!validManualEmail(email)||!recentAdminAuthentication(user))
      fail(403,'Reconnectez-vous avec l’adresse et le mot de passe du compte.');
    await limitAuthentication(env,`manual-admin-claim:${user.sub}`);
    const path=await manualRequestPath(email),adminPath=`pulseAdmins/${user.sub}`,accessPath=`pulseAccess/${user.sub}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [request,grant,access]=await Promise.all([db.get(path),db.get(adminPath),db.get(accessPath)]),r=request?.data;
      if(!r||r.email!==email||!['invited','pending','approved'].includes(r.status))
        fail(403,'Cette adresse n’a pas été ajoutée ou la demande a été annulée. Contactez un administrateur.');
      if(r.status==='approved') {
        const digest=await digestBase64(`manual-admin-email:${email}`);
        if(r.claimantUid===user.sub&&grant?.data?.active&&grant.data.source===ADMIN_MANUAL_SOURCE&&grant.data.manualEmailDigest===digest)
          return {ok:true,status:'approved'};
        fail(409,'Cette demande ne correspond plus à ce compte. Contactez un administrateur.');
      }
      if(access||grant)fail(409,'Ce compte possède déjà un accès. Ses droits n’ont pas été modifiés.');
      if(r.status==='pending') {
        if(r.claimantUid===user.sub)return {ok:true,status:'pending'};
        fail(409,'Une demande existe déjà pour cette adresse. Contactez un administrateur.');
      }
      const next={...r,status:'pending',claimantUid:user.sub,claimedAt:Date.now()};
      try {
        await db.commit([db.verify(adminPath,precondition(grant)),db.verify(accessPath,precondition(access)),db.write(path,next,precondition(request))]);
        return {ok:true,status:'pending'};
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'La demande a changé. Reconnectez-vous avec les mêmes informations.');
  }
  async function manualAdminRequestStatus(req,env,db,body) {
    if(!noPasswordBody(body))fail(400,'Demande invalide.');
    let user;try {user=await verify(env,authHeader(req));}catch{fail(401,'Session expirée. Reconnectez-vous.');}
    const email=normalizeAdminEmail(user.email);
    if(!ADMIN_ID.test(user.sub||'')||user.role==='seller'||user.firebase?.sign_in_provider!=='password'||!validManualEmail(email))
      fail(403,'Session invalide. Reconnectez-vous.');
    const request=await db.get(await manualRequestPath(email)),r=request?.data;
    if(!r||r.email!==email||r.claimantUid!==user.sub||!['pending','approved'].includes(r.status))
      fail(403,'Cette demande n’est plus disponible. Contactez un administrateur.');
    if(r.status==='approved')await checkAdminGrant(user,await db.get(`pulseAdmins/${user.sub}`));
    return {ok:true,status:r.status};
  }
  async function decideManualAdminRequest(env,db,actor,body,approve) {
    const email=normalizeAdminEmail(body?.email),requestId=body?.requestId,claimantUid=body?.claimantUid||'';
    if(!noPasswordBody(body)||!validManualEmail(email)||!SAFE_ID.test(requestId||'')||
       (claimantUid&&!ADMIN_ID.test(claimantUid))||body?.confirmed!==true||
       (approve&&(body?.identityVerified!==true||!claimantUid)))fail(400,'Confirmez la demande et la vérification de l’identité.');
    const path=await manualRequestPath(email);
    for(let attempt=0;attempt<8;attempt++) {
      const [request,checks]=await Promise.all([db.get(path),adminActorChecks(db,env,actor)]),r=request?.data;
      if(!r||r.email!==email||r.requestId!==requestId)fail(409,'Cette demande a changé. Actualisez la liste.');
      if(!approve) {
        if(r.status==='cancelled')return {ok:true,already:true};
        if(!['invited','pending'].includes(r.status)||(r.status==='pending'&&r.claimantUid!==claimantUid))
          fail(409,'Cette demande a changé. Actualisez la liste.');
        const cancelled={...r,status:'cancelled',cancelledAt:Date.now(),cancelledBy:actor.sub};
        try {await db.commit([...checks,db.write(path,cancelled,precondition(request))]);return {ok:true,already:false};}
        catch(e){if(!conflict(e))throw e;}
        continue;
      }
      if(r.claimantUid!==claimantUid||claimantUid===env.ADMIN_UID||claimantUid===actor.sub)
        fail(409,'Cette demande ne correspond plus au compte présenté. Actualisez la liste.');
      const adminPath=`pulseAdmins/${claimantUid}`,accessPath=`pulseAccess/${claimantUid}`;
      const [grant,access]=await Promise.all([db.get(adminPath),db.get(accessPath)]);
      const digest=await digestBase64(`manual-admin-email:${email}`);
      if(r.status==='approved') {
        if(grant?.data?.active&&grant.data.source===ADMIN_MANUAL_SOURCE&&grant.data.manualEmailDigest===digest)return {ok:true,already:true};
        fail(409,'Cette demande a déjà été traitée.');
      }
      if(r.status!=='pending'||access||grant)fail(409,'Ce compte ou cette demande a changé ; aucun nouveau droit n’a été ajouté.');
      const now=Date.now(),next={...r,status:'approved',approvedAt:now,approvedBy:actor.sub};
      const newGrant={active:true,source:ADMIN_MANUAL_SOURCE,requiresVerifiedEmail:false,manualEmailDigest:digest,
        createdAt:new Date(now).toISOString(),createdBy:actor.sub,identityVerifiedManually:true};
      try {
        await db.commit([...checks,db.verify(accessPath,precondition(access)),db.write(adminPath,newGrant,{exists:false}),db.write(path,next,precondition(request))]);
        return {ok:true,already:false};
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'La demande a changé. Actualisez la liste.');
  }
  async function enrollmentCodePath(code) {
    return `pulseAdminCodes/${await digestBase64(`admin-code-v1:${code}`)}`;
  }
  async function limitEnrollment(req,env,code='') {
    const raw=req.headers.get('cf-connecting-ip')||'unknown',address=raw.length<=80?raw:'unknown';
    await limitAuthentication(env,`admin-code-ip:${await digestBase64(address)}`);
    if(code)await limitAuthentication(env,`admin-code:${await digestBase64(code)}`);
  }
  async function activeCodeIssuer(db,env,issuerId) {
    if(issuerId===env.ADMIN_UID)return null;
    if(!ADMIN_ID.test(issuerId||''))fail(403,'Code invalide ou expiré.');
    const path=`pulseAdmins/${issuerId}`,doc=await db.get(path);
    if(!doc?.data?.active||(doc.data.source===ADMIN_DIRECT_SOURCE&&doc.data.passwordChangeRequired!==false))
      fail(403,'Code invalide ou expiré.');
    return {path,doc};
  }
  async function issueAdminCode(env,db,actor,body) {
    if(body?.confirmed!==true||body?.password!==undefined||body?.currentPassword!==undefined)
      fail(400,'Confirmez la création du code administrateur.');
    // Le choix explicite est d'utiliser la session déjà ouverte, sans demander
    // une nouvelle fois le mot de passe de l'administrateur.
    await limitAuthentication(env,`admin-code-issue:${actor.sub}`);
    for(let attempt=0;attempt<5;attempt++) {
      const code=createAdminCode(),path=await enrollmentCodePath(code),now=Date.now();
      const record={status:'pending',createdBy:actor.sub,createdAt:now,expiresAt:now+ADMIN_CODE_TTL_MS};
      try {await db.commit([db.write(path,record,{exists:false})]);return {ok:true,code:formatAdminCode(code),expiresAt:record.expiresAt};}
      catch(error){if(!conflict(error))throw error;}
    }
    fail(503,'Création du code impossible. Réessayez.');
  }
  async function cancelAdminCode(env,db,actor,body) {
    const code=normalizeAdminCode(body?.code);if(!code)fail(400,'Code invalide.');
    const path=await enrollmentCodePath(code);
    for(let attempt=0;attempt<8;attempt++) {
      const item=await db.get(path),r=item?.data;
      if(!r||r.createdBy!==actor.sub)fail(403,'Code invalide ou indisponible.');
      if(r.status==='revoked')return {ok:true,already:true};
      if(r.status==='completed')fail(409,'Ce code a déjà été utilisé : son annulation ne retire pas les droits du compte créé.');
      if(!['pending','reserved'].includes(r.status))fail(409,'Ce code ne peut plus être annulé.');
      try {await db.commit([db.write(path,{...r,status:'revoked',revokedAt:Date.now()},precondition(item))]);return {ok:true,already:false};}
      catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Code modifié simultanément. Réessayez.');
  }
  async function prepareAdminCode(req,env,db,body) {
    const code=normalizeAdminCode(body?.code),email=normalizeAdminEmail(body?.email);
    await limitEnrollment(req,env,code);
    if(!code||!validAdminEmail(email)||body?.confirmed!==true||body?.password!==undefined||body?.currentPassword!==undefined)
      fail(400,'Vérifiez le code et l’adresse e-mail, puis confirmez les droits.');
    const path=await enrollmentCodePath(code),emailDigest=await digestBase64(`direct-admin-email:${email}`);
    for(let attempt=0;attempt<8;attempt++) {
      const item=await db.get(path),r=item?.data,now=Date.now();
      if(!r||!Number.isFinite(r.expiresAt))fail(403,'Code invalide ou expiré.');
      if(r.status==='pending') {
        if(r.expiresAt<=now)fail(403,'Code invalide ou expiré.');
        const issuer=await activeCodeIssuer(db,env,r.createdBy);
        const reserved={...r,status:'reserved',emailDigest,reservedAt:now,resumeUntil:now+ADMIN_CODE_RESUME_MS};
        try {
          await db.commit([...(issuer?[db.verify(issuer.path,precondition(issuer.doc))]:[]),db.write(path,reserved,precondition(item))]);
          return {ok:true,resume:false};
        } catch(error){if(!conflict(error))throw error;}
        continue;
      }
      if((r.status==='reserved'||r.status==='completed')&&r.emailDigest===emailDigest&&Number.isFinite(r.resumeUntil)&&r.resumeUntil>now) {
        if(r.status==='reserved')await activeCodeIssuer(db,env,r.createdBy);
        return {ok:true,resume:true};
      }
      fail(403,'Code invalide, expiré ou déjà utilisé pour une autre adresse.');
    }
    fail(409,'Code modifié simultanément. Réessayez.');
  }
  async function completeAdminCode(req,env,db,body) {
    const code=normalizeAdminCode(body?.code);await limitEnrollment(req,env,code);
    if(!code||body?.password!==undefined||body?.currentPassword!==undefined)fail(400,'Code invalide.');
    const token=authHeader(req);let target;
    try{target=await verify(env,token);}catch{fail(401,'Session du nouveau compte expirée. Reprenez avec votre code.');}
    const email=normalizeAdminEmail(target.email);
    if(!ADMIN_ID.test(target.sub||'')||target.sub===env.ADMIN_UID||target.role==='seller'||
       target.firebase?.sign_in_provider!=='password'||!validAdminEmail(email)||!recentAdminAuthentication(target))
      fail(403,'Connectez le nouveau compte avec son adresse et son mot de passe provisoire.');
    const path=await enrollmentCodePath(code),adminPath=`pulseAdmins/${target.sub}`,accessPath=`pulseAccess/${target.sub}`;
    const emailDigest=await digestBase64(`direct-admin-email:${email}`);
    for(let attempt=0;attempt<8;attempt++) {
      const [request,access,existing]=await Promise.all([db.get(path),db.get(accessPath),db.get(adminPath)]),r=request?.data,now=Date.now();
      if(!r||r.emailDigest!==emailDigest||!Number.isFinite(r.resumeUntil)||r.resumeUntil<=now)
        fail(403,'Code invalide ou expiré.');
      if(r.status==='completed') {
        if(r.targetUid===target.sub&&existing?.data?.active&&existing.data.provisionMethod===ADMIN_CODE_METHOD)return {ok:true,already:true};
        fail(403,'Code déjà utilisé.');
      }
      if(r.status!=='reserved'||!Number.isFinite(r.reservedAt)||!Number.isFinite(r.expiresAt)||r.reservedAt>=r.expiresAt)
        fail(403,'Code invalide ou expiré.');
      if(target.sub===r.createdBy)fail(409,'Utilisez un compte différent du créateur du code.');
      const issuer=await activeCodeIssuer(db,env,r.createdBy);
      if(access)fail(409,'Utilisez un compte distinct du profil vendeur.');
      if(existing)fail(409,'Ce compte possède déjà des droits ; aucune protection n’a été changée.');
      let account;try{account=await lookupAccount(env,token);}catch{fail(503,'Vérification Firebase indisponible. Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Reprenez avec les mêmes informations.');}
      if(account?.localId!==target.sub||normalizeAdminEmail(account.email)!==email||account.disabled===true||
         !Number.isFinite(account.createdAt)||account.createdAt<=r.reservedAt||account.createdAt>Date.now()+10000||
         !Number.isFinite(account.passwordUpdatedAt)||account.passwordUpdatedAt<=0)
        fail(409,'Cette adresse possède déjà un compte ou ses informations ne peuvent pas être vérifiées. Aucun nouveau droit n’a été attribué.');
      const grant={active:true,createdBy:r.createdBy,createdAt:new Date().toISOString(),source:ADMIN_DIRECT_SOURCE,provisionMethod:ADMIN_CODE_METHOD,
        requiresVerifiedEmail:false,directEmailDigest:emailDigest,passwordChangeRequired:true,
        initialPasswordUpdatedAt:account.passwordUpdatedAt,firebaseCreatedAt:account.createdAt};
      const completed={...r,status:'completed',targetUid:target.sub,completedAt:now};
      try {
        await db.commit([...(issuer?[db.verify(issuer.path,precondition(issuer.doc))]:[]),db.verify(accessPath,precondition(access)),
          db.write(adminPath,grant,{exists:false}),db.write(path,completed,precondition(request))]);
        return {ok:true,already:false};
      } catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Code modifié simultanément. Reprenez avec les mêmes informations.');
  }
  async function directReservationPath(actor,email) {
    return `pulseAdminDirectRequests/${await digestBase64(`direct-admin-request:${actor.sub}:${email}`)}`;
  }
  async function beginDirectAdministrator(env,db,actor,body) {
    if(!recentAdminAuthentication(actor))fail(401,'Confirmez à nouveau votre mot de passe administrateur.');
    const email=normalizeAdminEmail(body?.email);
    if(!validAdminEmail(email)||body?.confirmed!==true||body?.password!==undefined||body?.currentPassword!==undefined)
      fail(400,'Vérifiez l’adresse et confirmez la création sans e-mail.');
    if(normalizeAdminEmail(actor.email)===email)fail(409,'Cette adresse correspond à votre propre compte administrateur.');
    await limitAuthentication(env,`admin-direct:${actor.sub}`);
    const path=await directReservationPath(actor,email);
    for(let attempt=0;attempt<8;attempt++) {
      const previous=await db.get(path),now=Date.now(),old=previous?.data;
      if(old?.createdBy===actor.sub&&SAFE_ID.test(old.requestId||'')&&
         (old.status==='completed'||(old.status==='pending'&&Number.isFinite(old.expiresAt)&&old.expiresAt>now)))
        return {ok:true,requestId:old.requestId,resume:true};
      const next={createdBy:actor.sub,requestId:crypto.randomUUID(),status:'pending',startedAt:now,expiresAt:now+ADMIN_DIRECT_MS};
      try {await db.commit([db.write(path,next,precondition(previous))]);return {ok:true,requestId:next.requestId,resume:false};}
      catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Création modifiée simultanément. Réessayez.');
  }
  async function completeDirectAdministrator(env,db,actor,body) {
    if(!recentAdminAuthentication(actor))fail(401,'Confirmez à nouveau votre mot de passe administrateur.');
    const email=normalizeAdminEmail(body?.email),requestId=body?.requestId;
    if(!validAdminEmail(email)||!SAFE_ID.test(requestId||'')||typeof body?.userToken!=='string'||
       body.userToken.length<20||body.userToken.length>8192||body?.password!==undefined||body?.currentPassword!==undefined)
      fail(400,'Création du compte invalide.');
    let target;try{target=await verify(env,body.userToken);}catch{fail(400,'Compte à ajouter invalide.');}
    if(!ADMIN_ID.test(target.sub||'')||target.sub===env.ADMIN_UID||target.sub===actor.sub||target.role==='seller'||
       target.firebase?.sign_in_provider!=='password'||normalizeAdminEmail(target.email)!==email||!recentAdminAuthentication(target))
      fail(400,'Le nouveau compte doit être connecté avec l’adresse et le mot de passe indiqués.');
    const path=await directReservationPath(actor,email),adminPath=`pulseAdmins/${target.sub}`,accessPath=`pulseAccess/${target.sub}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [request,access,existing]=await Promise.all([db.get(path),db.get(accessPath),db.get(adminPath)]),r=request?.data;
      if(!r||r.createdBy!==actor.sub||r.requestId!==requestId)fail(409,'Cette demande de création a changé. Recommencez.');
      if(r.status==='completed') {
        if(r.targetUid===target.sub&&existing?.data?.active&&existing.data.source===ADMIN_DIRECT_SOURCE)return {ok:true,already:true};
        fail(409,'Ce compte administrateur ne peut pas être modifié par cette demande.');
      }
      if(r.status!=='pending'||!Number.isFinite(r.startedAt)||!Number.isFinite(r.expiresAt)||r.expiresAt<=Date.now())
        fail(409,'Cette demande de création a expiré. Recommencez.');
      if(access)fail(409,'Utilisez un compte distinct du profil vendeur.');
      if(existing)fail(409,'Ce compte possède déjà des droits. Ses protections restent inchangées.');
      let account;try{account=await lookupAccount(env,body.userToken);}catch{fail(503,'Vérification Firebase indisponible. Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Réessayez avec les mêmes identifiants.');}
      if(account?.localId!==target.sub||normalizeAdminEmail(account.email)!==email||account.disabled===true||
         !Number.isFinite(account.createdAt)||account.createdAt<r.startedAt||account.createdAt>Date.now()+10000||
         !Number.isFinite(account.passwordUpdatedAt)||account.passwordUpdatedAt<=0)
        fail(409,'Cette adresse possède déjà un compte ou ses informations ne peuvent pas être vérifiées. Aucun nouveau droit n’a été attribué.');
      const grant={active:true,createdBy:actor.sub,createdAt:new Date().toISOString(),source:ADMIN_DIRECT_SOURCE,
        requiresVerifiedEmail:false,directEmailDigest:await digestBase64(`direct-admin-email:${email}`),
        passwordChangeRequired:true,initialPasswordUpdatedAt:account.passwordUpdatedAt,firebaseCreatedAt:account.createdAt};
      const complete={...r,status:'completed',targetUid:target.sub,completedAt:Date.now()};
      try {
        // Auth et Firestore ne sont pas atomiques, mais l'absence de profil
        // vendeur, le droit et la consommation de la réservation le sont.
        await db.commit([db.verify(accessPath,precondition(access)),db.write(adminPath,grant,{exists:false}),db.write(path,complete,precondition(request))]);
        return {ok:true,already:false};
      } catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Création modifiée simultanément. Réessayez avec les mêmes identifiants.');
  }
  // Nettoyage strictement ciblé de l'ancien parcours direct : l'adresse est
  // saisie par l'administrateur dans l'application, jamais devinée. Le compte
  // Firebase n'est pas supprimé ici ; il faut son propre mot de passe ou la
  // console Firebase. Les autres droits et sessions ne sont pas touchés.
  async function oldTestAccountSnapshot(env,db,actor,email) {
    const digest=await digestBase64(`direct-admin-email:${email}`);
    const [matches,reservation]=await Promise.all([
      db.query('pulseAdmins','directEmailDigest','EQUAL',digest,2),
      db.get(await directReservationPath(actor,email)),
    ]);
    if(matches.length>1)fail(409,'Plusieurs droits correspondent : vérification manuelle nécessaire. Rien n’a été modifié.');
    const grant=matches[0]||null,r=reservation?.data;
    if(grant&&(grant.data.source!==ADMIN_DIRECT_SOURCE||grant.data.createdBy!==actor.sub||!ADMIN_ID.test(grant.id||'')))
      fail(409,'Ce droit ne correspond pas à une création directe par votre compte. Rien n’a été modifié.');
    if(reservation&&r.createdBy!==actor.sub)fail(409,'Cette ancienne demande ne correspond pas à votre compte.');
    const uid=grant?.id||(['completed','revoked'].includes(r?.status)&&ADMIN_ID.test(r.targetUid||'')?r.targetUid:'');
    if(grant&&r?.targetUid&&r.targetUid!==grant.id)fail(409,'Les identifiants ne correspondent pas. Rien n’a été modifié.');
    if(uid&&(uid===env.ADMIN_UID||uid===actor.sub))fail(403,'Votre compte administrateur ne peut pas être supprimé ici.');
    const [access,byUid]=uid?await Promise.all([db.get(`pulseAccess/${uid}`),db.get(`pulseAdmins/${uid}`)]):[null,null];
    if(access)fail(409,'Ce compte est lié à un profil vendeur. Rien n’a été modifié.');
    if(byUid&&(!grant||byUid.updateTime!==grant.updateTime))fail(409,'Ce compte possède un autre droit administrateur. Rien n’a été modifié.');
    return {grant,reservation,uid,access};
  }
  async function inspectOldTestAccount(env,db,actor,body) {
    const email=normalizeAdminEmail(body?.email);
    if(!noPasswordBody(body)||!validManualEmail(email))fail(400,'Indiquez l’adresse exacte du compte de test.');
    await limitAuthentication(env,`old-admin-test:${actor.sub}`);
    const {grant,reservation,uid}=await oldTestAccountSnapshot(env,db,actor,email);
    return {found:!!(grant||reservation),email,uid,grantActive:grant?.data?.active===true,
      reservationStatus:reservation?.data?.status||'',createdAt:grant?.data?.createdAt||null};
  }
  async function revokeOldTestAccount(env,db,actor,body) {
    const email=normalizeAdminEmail(body?.email),expectedUid=body?.uid||'';
    if(!noPasswordBody(body)||!validManualEmail(email)||(expectedUid&&!ADMIN_ID.test(expectedUid))||body?.confirmed!==true)
      fail(400,'Confirmez le compte de test exact.');
    for(let attempt=0;attempt<8;attempt++) {
      const [{grant,reservation,uid,access},checks]=await Promise.all([oldTestAccountSnapshot(env,db,actor,email),adminActorChecks(db,env,actor)]);
      if(uid!==expectedUid||(!grant&&!reservation))fail(409,'Le compte ou la demande a changé. Recherchez l’adresse à nouveau.');
      const writes=[...checks];
      if(uid){writes.push(db.verify(`pulseAccess/${uid}`,precondition(access)));if(!grant)writes.push(db.verify(`pulseAdmins/${uid}`,{exists:false}));}
      if(grant&&grant.data.active!==false)writes.push(db.write(`pulseAdmins/${uid}`,{...grant.data,active:false,revokedAt:new Date().toISOString(),revokedReason:'test-cleanup'},precondition(grant)));
      if(reservation&&reservation.data.status!=='revoked')writes.push(db.write(await directReservationPath(actor,email),{...reservation.data,status:'revoked',revokedAt:Date.now()},precondition(reservation)));
      if(!writes.length||(!grant&&reservation?.data.status==='revoked'))return {ok:true,uid,already:true};
      try {await db.commit(writes);return {ok:true,uid,already:false};}
      catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Le compte a changé. Recherchez l’adresse à nouveau.');
  }
  async function authorizeOldTestDeletion(env,db,actor,body) {
    const email=normalizeAdminEmail(body?.email),uid=body?.uid,token=body?.userToken;
    if(!noPasswordBody(body)||!validManualEmail(email)||!ADMIN_ID.test(uid||'')||typeof token!=='string'||token.length<20||token.length>8192||body?.confirmed!==true)
      fail(400,'Vérifiez le compte de test.');
    let target;try{target=await verify(env,token);}catch{fail(401,'La session du compte de test a expiré.');}
    if(target.sub!==uid||normalizeAdminEmail(target.email)!==email||target.role==='seller'||target.firebase?.sign_in_provider!=='password'||!recentAdminAuthentication(target))
      fail(403,'Le compte connecté ne correspond pas au compte de test vérifié.');
    const [{grant,reservation,uid:found},checks]=await Promise.all([oldTestAccountSnapshot(env,db,actor,email),adminActorChecks(db,env,actor)]);
    if(found!==uid||(!grant&&!reservation)||grant?.data?.active===true||(reservation&&reservation.data.status!=='revoked'))
      fail(409,'Retirez d’abord les droits et vérifiez l’ancien compte.');
    // Vérifie les préconditions juste avant le geste Firebase. Les deux
    // systèmes ne permettent cependant pas une suppression transactionnelle.
    const verifies=[...checks,db.verify(`pulseAccess/${uid}`,{exists:false}),db.verify(`pulseAdmins/${uid}`,precondition(grant))];
    if(reservation)verifies.push(db.verify(await directReservationPath(actor,email),precondition(reservation)));
    try {await db.commit(verifies);}catch(e){if(conflict(e))fail(409,'Le compte a changé. Recherchez-le à nouveau.');throw e;}
    return {ok:true};
  }
  async function administratorAccountStatus(req,env,db) {
    const user=await admin(req,env,db,{allowPasswordChange:true});
    if(user.sub===env.ADMIN_UID)return {passwordChangeRequired:false};
    const path=`pulseAdmins/${user.sub}`;
    for(let attempt=0;attempt<8;attempt++) {
      const grant=await db.get(path),g=grant?.data;
      if(!g?.active)fail(403,'Accès administrateur refusé.');
      if(g.source!==ADMIN_DIRECT_SOURCE)return {passwordChangeRequired:false};
      if(g.passwordChangeRequired===false) {
        if(!Number.isFinite(g.passwordChangedAt))fail(503,'Vérification du compte indisponible. Réessayez plus tard.');
        return {passwordChangeRequired:false,...(user.auth_time<=Math.floor(g.passwordChangedAt/1000)?{reauthenticate:true}:{})};
      }
      if(!Number.isFinite(g.initialPasswordUpdatedAt)||g.initialPasswordUpdatedAt<=0||!Number.isFinite(g.firebaseCreatedAt))
        fail(503,'Vérification du compte indisponible. Réessayez plus tard.');
      let account;try{account=await lookupAccount(env,authHeader(req));}catch{fail(503,'Vérification Firebase indisponible. Réessayez plus tard.');}
      if(account?.localId!==user.sub||normalizeAdminEmail(account.email)!==normalizeAdminEmail(user.email)||account.disabled===true||
         account.createdAt!==g.firebaseCreatedAt||!Number.isFinite(account.passwordUpdatedAt))
        fail(403,'Vérification du compte administrateur impossible.');
      if(account.passwordUpdatedAt<=g.initialPasswordUpdatedAt)return {passwordChangeRequired:true,...(g.provisionMethod===ADMIN_CODE_METHOD?{method:'code'}:{})};
      try {
        await db.commit([db.write(path,{...g,passwordChangeRequired:false,passwordChangedAt:account.passwordUpdatedAt},precondition(grant))]);
        return {passwordChangeRequired:false,...(user.auth_time<=Math.floor(account.passwordUpdatedAt/1000)?{reauthenticate:true}:{})};
      } catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Compte modifié simultanément. Reconnectez-vous.');
  }
  async function grantAdministrator(env,db,actor,body) {
    if(!recentAdminAuthentication(actor))fail(401,'Confirmez à nouveau votre mot de passe administrateur.');
    if(typeof body?.userToken!=='string'||body.userToken.length<20||body.userToken.length>8192)fail(400,'Compte à ajouter invalide.');
    let target;try{target=await verify(env,body.userToken);}catch{fail(400,'Compte à ajouter invalide.');}
    if(!ADMIN_ID.test(target.sub||'')||target.role==='seller'||target.firebase?.sign_in_provider!=='password'||
       typeof target.email!=='string'||!target.email||!recentAdminAuthentication(target))fail(400,'Connectez le compte à ajouter avec son e-mail et son mot de passe.');
    if(target.sub===env.ADMIN_UID||target.sub===actor.sub)fail(409,'Ce compte est déjà administrateur.');
    // Un compte vendeur ne devient jamais administrateur par confusion d'UID.
    const [access,existing]=await Promise.all([db.get(`pulseAccess/${target.sub}`),db.get(`pulseAdmins/${target.sub}`)]);
    if(access)fail(409,'Utilisez un compte distinct du profil vendeur.');
    if(existing?.data?.active)return {ok:true,already:true};
    if(existing)fail(409,'Ce compte administrateur est désactivé.');
    const grant={active:true,createdBy:actor.sub,createdAt:new Date().toISOString(),requiresVerifiedEmail:true};
    try {await db.commit([db.write(`pulseAdmins/${target.sub}`,grant,{exists:false})]);}
    catch(error) {
      // Réponse perdue ou deux demandes simultanées : ne pas modifier un droit
      // existant, mais reconnaître une attribution déjà effectuée.
      if(!conflict(error))throw error;
      if((await db.get(`pulseAdmins/${target.sub}`))?.data?.active)return {ok:true,already:true};
      throw error;
    }
    return {ok:true,already:false};
  }
  // L’invitation ne donne aucun droit à elle seule. Les nouvelles invitations
  // gardent l’adresse dans une collection privée pour pouvoir être annulées ;
  // les anciennes, qui ne l’enregistraient pas, restent compatibles.
  async function emailInvitationPath(email) {
    return `pulseAdminInvitations/${await digestBase64(`admin-invitation:${email}`)}`;
  }
  async function inviteAdministrator(env,db,actor,body) {
    if(!recentAdminAuthentication(actor))fail(401,'Confirmez à nouveau votre mot de passe administrateur.');
    const email=normalizeAdminEmail(body?.email),requestId=body?.requestId;
    if(body?.activation!==undefined&&body.activation!=='email-link-v1')fail(400,'Mode d’activation invalide.');
    if(!validManualEmail(email)||!SAFE_ID.test(requestId||'')||!noPasswordBody(body))fail(400,'Adresse ou invitation invalide.');
    if(normalizeAdminEmail(actor.email)===email)fail(409,'Cette adresse correspond à votre propre compte administrateur.');
    await limitAuthentication(env,`admin-invite:${actor.sub}`);
    const path=await emailInvitationPath(email);
    for(let attempt=0;attempt<8;attempt++) {
      const [previous,checks]=await Promise.all([db.get(path),adminActorChecks(db,env,actor)]);
      if(previous?.data?.requestId===requestId&&previous.data.createdBy!==actor.sub)
        fail(409,'Cette demande appartient à un autre administrateur.');
      if(previous?.data?.status==='accepted') {
        const uid=previous.data.acceptedBy;
        const grant=ADMIN_ID.test(uid||'')?await db.get(`pulseAdmins/${uid}`):null;
        if(grant?.data?.active)return {ok:true,status:'accepted',expiresAt:previous.data.expiresAt};
        fail(409,'Cet accès a déjà été traité. Aucun droit n’a été modifié.');
      }
      if(previous?.data?.requestId===requestId)return {ok:true,status:previous.data.status,expiresAt:previous.data.expiresAt};
      const now=Date.now(),next={status:'pending',createdBy:actor.sub,requestId,createdAt:now,expiresAt:now+ADMIN_INVITATION_MS,
        issuerMustBeActive:true,...(body?.activation==='email-link-v1'?{activation:'email-link-v1'}:{}),...(body?.showInPanel===true?{email}:{})};
      try {await db.commit([...checks,db.write(path,next,precondition(previous))]);return {ok:true,status:'pending',expiresAt:next.expiresAt};}
      catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Invitation modifiée simultanément. Réessayez.');
  }
  async function listEmailInvitations(db,after='') {
    if(after&&!/^[A-Za-z0-9_-]{43}$/.test(after))fail(400,'Curseur d’invitations invalide.');
    const rows=await db.page('pulseAdminInvitations',{field:'status',op:'EQUAL',value:'pending',limit:51,after});
    const page=rows.slice(0,50),now=Date.now();
    return {invitations:page.map(x=>x.data).filter(x=>validManualEmail(normalizeAdminEmail(x.email))&&
      SAFE_ID.test(x.requestId||'')&&Number.isFinite(x.expiresAt)&&x.expiresAt>now)
      .map(x=>({email:x.email,requestId:x.requestId,createdAt:x.createdAt,expiresAt:x.expiresAt}))
      .sort((a,b)=>b.createdAt-a.createdAt),next:rows.length>50?page.at(-1).id:null};
  }
  async function cancelEmailInvitation(env,db,actor,body) {
    const email=normalizeAdminEmail(body?.email),requestId=body?.requestId;
    if(!noPasswordBody(body)||!validManualEmail(email)||!SAFE_ID.test(requestId||'')||body?.confirmed!==true)
      fail(400,'Confirmez l’invitation à annuler.');
    const path=await emailInvitationPath(email);
    for(let attempt=0;attempt<8;attempt++) {
      const [invitation,checks]=await Promise.all([db.get(path),adminActorChecks(db,env,actor)]),item=invitation?.data;
      if(!item||item.requestId!==requestId||item.email!==email)fail(409,'Cette invitation a changé. Actualisez la liste.');
      if(item.status==='cancelled')return {ok:true,already:true};
      if(item.status!=='pending')fail(409,'Cette invitation a déjà été utilisée. Aucun accès n’a été retiré.');
      try {await db.commit([...checks,db.write(path,{...item,status:'cancelled',cancelledAt:Date.now(),cancelledBy:actor.sub},precondition(invitation))]);return {ok:true,already:false};}
      catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Cette invitation a changé. Actualisez la liste.');
  }
  async function invitationIssuerChecks(db,env,invitation) {
    // Le marqueur est ajouté par le serveur, même avec un ancien client.
    // Les invitations historiques sans marqueur gardent leur règle d’origine.
    if(invitation?.data?.issuerMustBeActive!==true)return [];
    const uid=invitation?.data?.createdBy;
    if(uid===env.ADMIN_UID)return [];
    if(!ADMIN_ID.test(uid||''))fail(403,'L’invitation n’est plus valide. Demandez-en une nouvelle.');
    const path=`pulseAdmins/${uid}`,grant=await db.get(path);
    if(!grant?.data?.active||(grant.data.source===ADMIN_DIRECT_SOURCE&&grant.data.passwordChangeRequired!==false))
      fail(403,'L’invitation n’est plus valide. Demandez-en une nouvelle.');
    return [db.verify(path,precondition(grant))];
  }
  async function acceptAdministratorInvitation(req,env,db,body) {
    if(body?.confirmed!==true)fail(400,'Confirmez explicitement l’acceptation de l’invitation.');
    let user;try{user=await verify(env,authHeader(req));}catch{fail(401,'Session expirée. Reconnectez-vous.');}
    const email=normalizeAdminEmail(user.email);
    if(!ADMIN_ID.test(user.sub||'')||user.role==='seller'||user.firebase?.sign_in_provider!=='password'||!validAdminEmail(email))
      fail(403,'Connectez-vous avec le compte invité et son mot de passe.');
    if(user.email_verified!==true) {
      // Une ancienne demande manuelle sans invitation e-mail doit pouvoir
      // suivre son parcours historique. Une invitation e-mail valide prime :
      // elle demande la confirmation plutôt qu'une seconde approbation.
      const pending=await db.get(await emailInvitationPath(email));
      if(pending?.data?.status==='pending'&&Number.isFinite(pending.data.expiresAt)&&pending.data.expiresAt>Date.now())
        fail(403,'Confirmez d’abord l’adresse e-mail du compte invité.');
      fail(403,'Aucune invitation valide pour cette adresse. Demandez à un administrateur de vous inviter à nouveau.');
    }
    if(!recentAdminAuthentication(user))fail(401,'Reconnectez-vous avant d’accepter l’invitation.');
    await limitAuthentication(env,`admin-accept:${user.sub}`);
    const invitePath=`pulseAdminInvitations/${await digestBase64(`admin-invitation:${email}`)}`;
    const adminPath=`pulseAdmins/${user.sub}`,accessPath=`pulseAccess/${user.sub}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [invitation,access,existing]=await Promise.all([db.get(invitePath),db.get(accessPath),db.get(adminPath)]);
      if(access)fail(409,'Utilisez un compte distinct du profil vendeur.');
      if(user.sub===env.ADMIN_UID||existing?.data?.active)return {ok:true,already:true};
      if(existing)fail(409,'Ce compte administrateur est désactivé.');
      if(!invitation||invitation.data.status!=='pending'||!Number.isFinite(invitation.data.expiresAt)||invitation.data.expiresAt<=Date.now())
        fail(403,'Aucune invitation valide pour cette adresse. Demandez à un administrateur de vous inviter à nouveau.');
      const issuerChecks=await invitationIssuerChecks(db,env,invitation);
      if(invitation.data.activation==='email-link-v1') {
        let account;try{account=await lookupAccount(env,authHeader(req));}catch{fail(503,'Vérification Firebase indisponible. Réessayez.');}
        if(account?.localId!==user.sub||normalizeAdminEmail(account.email)!==email||account.disabled===true)fail(403,'Compte invité invalide.');
        if(!Number.isFinite(account.passwordUpdatedAt)||account.passwordUpdatedAt<=0)fail(403,'Créez d’abord votre mot de passe pour activer votre compte.');
      }
      const now=Date.now(),grant={active:true,createdBy:invitation.data.createdBy,createdAt:new Date(now).toISOString(),requiresVerifiedEmail:true};
      const accepted={...invitation.data,status:'accepted',acceptedBy:user.sub,acceptedAt:now};
      try {
        // Attribution, consommation et validité de l’invitant sont atomiques.
        await db.commit([...issuerChecks,db.verify(accessPath,precondition(access)),db.write(adminPath,grant,{exists:false}),db.write(invitePath,accepted,precondition(invitation))]);
        return {ok:true,already:false};
      } catch(error){if(!conflict(error))throw error;}
    }
    fail(409,'Invitation modifiée simultanément. Réessayez.');
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
  async function login(req,env,db,body) {
    const {storeId,sellerId,proof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(proof||''))fail(400,'Sélection ou code PIN invalide.');
    const uid=await sellerUid(storeId,Number(sellerId));
    await limitAuthentication(env,uid);
    const [a,c]=await Promise.all([db.get(`pulseAccess/${uid}`),catalog(db)]);
    // Ne pas compter les anciennes interfaces qui ne savent pas utiliser le
    // nouveau parcours : elles reçoivent seulement l'invitation à se mettre à jour.
    if(!a?.data?.active&&a?.data?.resetGeneration===OPEN_PIN_RESET&&body.openPinFlow!==true)
      fail(409,'Votre accès a été réinitialisé. Fermez puis rouvrez Fnac Pulse pour choisir un nouveau PIN.');
    if(a?.data?.active&&a.data.pinLength===4&&body.pinFlowVersion!==2)
      fail(409,'Fermez puis rouvrez Fnac Pulse en ligne pour utiliser votre PIN à 4 chiffres.');
    if(!a?.data?.active||!selectedProfile(c,body))fail(401,'Profil ou code PIN incorrect.');
    await reservePinAttempt(db,uid,a);
    if(!(await verifyPin(env,uid,proof,a.data.pinMac||'')))fail(401,'Profil ou code PIN incorrect.');
    await clearFailures(db,uid);
    return signedIn(env,uid,a.data);
  }
  async function pinStatus(db,body) {
    const {storeId,sellerId}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId))fail(400,'Sélectionnez votre magasin et votre profil.');
    const uid=await sellerUid(storeId,Number(sellerId)),[a,c]=await Promise.all([db.get(`pulseAccess/${uid}`),catalog(db)]);
    if(!selectedProfile(c,body))fail(400,'Ce profil n’est plus disponible. Contactez votre responsable.');
    const active=!!a?.data?.active;
    return {needsPin:!active,...(active&&a.data.pinLength===4?{pinLength:4,...(a.data.pinSalt?{pinSalt:a.data.pinSalt}:{})}:{})};
  }
  async function resetPin(db,body) {
    const {storeId,sellerId}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||body.pin!==undefined||body.proof!==undefined||body.newProof!==undefined)fail(400,'Choisissez un magasin et un vendeur.');
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
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(newProof||'')||![undefined,4].includes(body.pinLength)||body.pin!==undefined)fail(400,'Sélection ou code PIN invalide.');
    const uid=await sellerUid(storeId,Number(sellerId)),accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`;
    await limitAuthentication(env,uid);
    for(let retry=0;retry<8;retry++) {
      const [attempt,a,c,status]=await Promise.all([db.get(`pulseAttempts/${uid}`),db.get(accessPath),catalog(db),db.get(statusPath)]);
      if(attempt?.data?.lockUntil>Date.now())fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
      if(!selectedProfile(c,body))fail(400,'Ce profil n’est plus disponible. Contactez votre responsable.');
      if(a?.data?.active)fail(409,'Ce profil possède déjà un PIN. Connectez-vous avec ce code.');
      const access={active:true,storeId,sellerId:Number(sellerId),sellerKey:`s${Number(sellerId)}`,version:crypto.randomUUID(),
        pinPersonal:true,resetGeneration:OPEN_PIN_RESET,pinMac:await pinMac(env,uid,newProof),...(body.pinLength===4?{pinLength:4}:{})};
      try {
        // La première création l'emporte : un second appareil ne peut ni remplacer
        // le PIN choisi, ni obtenir un jeton avec son propre PIN.
        await db.commit([db.verify('pulse/catalog',precondition(c)),db.write(accessPath,access,precondition(a)),db.write(statusPath,accessStatus(access,status),precondition(status))]);
        await clearFailures(db,uid);return signedIn(env,uid,access);
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Accès modifié simultanément. Recommencez la connexion.');
  }
  // Création libre d'un vendeur : catalogue, accès et suivi idempotent sont
  // enregistrés ensemble. Aucun PIN ni dérivé réutilisable n'est stocké en clair.
  async function registerSeller(req,env,db,body) {
    const {storeId,departmentId,registrationId,pinSalt,newProof}=body,name=cleanSellerName(body.name);
    if(typeof body.name!=='string'||body.name.length>80||!validSellerName(name)||!STORE_ID.test(storeId||'')||!STORE_ID.test(departmentId||'')||
       !SAFE_ID.test(registrationId||'')||!PIN_SALT.test(pinSalt||'')||!PROOF.test(newProof||'')||body.pin!==undefined||body.confirmPin!==undefined)
      fail(400,'Prénom, magasin, département ou code PIN invalide.');
    // Limiter les créations publiques par magasin et par adresse Cloudflare.
    const address=req.headers.get('cf-connecting-ip')||'unknown';
    await Promise.all([limitAuthentication(env,`register-store:${storeId}`),limitAuthentication(env,`register-ip:${address}`)]);
    const requestPath=`pulseRegistrations/${registrationId}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [c,request]=await Promise.all([catalog(db),db.get(requestPath)]);
      if(request) {
        const r=request.data;
        if(r.storeId!==storeId||r.departmentId!==departmentId||r.pinSalt!==pinSalt||r.name!==name)
          fail(409,'Cette demande d’inscription a déjà été utilisée.');
        await limitAuthentication(env,r.uid);
        const access=await db.get(`pulseAccess/${r.uid}`);
        if(!access?.data?.active||access.data.pinLength!==4||access.data.pinSalt!==pinSalt||!selectedProfile(c,{storeId,departmentId,sellerId:r.sellerId}))
          fail(409,'Ce profil existe déjà. Reconnectez-vous avec votre PIN.');
        await reservePinAttempt(db,r.uid,access);
        if(!(await verifyPin(env,r.uid,newProof,access.data.pinMac||'')))fail(409,'Ce profil existe déjà. Reconnectez-vous avec votre PIN.');
        await clearFailures(db,r.uid);
        return {...await signedIn(env,r.uid,access.data),sellerId:r.sellerId};
      }
      if(!validStore(c.data,storeId)||!departmentsForStore(c.data,storeId).some(d=>d.id===departmentId))fail(400,'Choisissez un magasin et un département actifs.');
      // Empêcher les anciennes PWA de créer sans avertissement dans un espace
      // régional commun. Les connexions et les reprises restent inchangées.
      if(c.data.stores.find(s=>s.id===storeId)?.directoryStatus==='regional-choice'&&body.regionalConsent!==true)
        fail(400,'Cet espace régional partage les bilans et notifications. Mettez l’application à jour puis confirmez cet avertissement avant de créer votre profil.');
      // Un profil archivé doit être restauré par l'administrateur, et non dupliqué.
      if(c.data.sellers.some(s=>sellerStoreId(s)===storeId&&sameSellerName(s.name,name)))
        fail(409,'Ce prénom existe déjà dans ce magasin. Choisissez le profil existant ou contactez votre responsable.');
      if(c.data.sellers.length>=1000)fail(400,'Nombre maximal de vendeurs atteint. Contactez votre responsable.');
      const sellerId=Number(c.data.nextSellerId);
      if(!isId(sellerId)||c.data.sellers.some(s=>Number(s.id)===sellerId))fail(503,'Création du profil indisponible. Contactez votre responsable.');
      const uid=await sellerUid(storeId,sellerId),accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`;
      const access={active:true,storeId,sellerId,sellerKey:`s${sellerId}`,version:crypto.randomUUID(),pinPersonal:true,
        resetGeneration:OPEN_PIN_RESET,pinLength:4,pinSalt,pinMac:await pinMac(env,uid,newProof)};
      const next=withFlags({...c.data,sellers:[...c.data.sellers,{id:sellerId,name,active:true,storeId,departmentId}],nextSellerId:sellerId+1});
      try {
        await db.commit([db.write('pulse/catalog',next,precondition(c)),db.write(accessPath,access,{exists:false}),
          db.write(statusPath,accessStatus(access,null),{exists:false}),
          db.write(requestPath,{storeId,departmentId,name,sellerId,uid,pinSalt},{exists:false})]);
        return {...await signedIn(env,uid,access),sellerId};
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Le magasin a changé pendant l’inscription. Actualisez puis réessayez.');
  }
  // Après déconnexion, l'ancien code vérifie la propriété du profil avant de
  // passer à quatre chiffres ; la version d'accès ne change pas afin de ne pas
  // déconnecter les autres appareils déjà authentifiés.
  async function changeLegacyPin(env,db,body) {
    const {storeId,sellerId,oldProof,newProof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(oldProof||'')||!PROOF.test(newProof||'')||body.pin!==undefined)
      fail(400,'Sélection ou code PIN invalide.');
    const uid=await sellerUid(storeId,Number(sellerId)),accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`;
    await limitAuthentication(env,uid);
    const [initialAccess,initialCatalog]=await Promise.all([db.get(accessPath),catalog(db)]);
    if(!initialAccess?.data?.active||!selectedProfile(initialCatalog,body))fail(401,'Profil ou ancien PIN incorrect.');
    await reservePinAttempt(db,uid,initialAccess);
    for(let attempt=0;attempt<8;attempt++) {
      const [a,c,status]=await Promise.all([db.get(accessPath),catalog(db),db.get(statusPath)]);
      if(!a?.data?.active||!selectedProfile(c,body))fail(401,'Profil ou ancien PIN incorrect.');
      if(a.data.pinLength===4) {
        // Si la réponse du premier changement a été perdue, le nouveau dérivé
        // permet de récupérer la même session sans modifier le profil une seconde fois.
        if(await verifyPin(env,uid,newProof,a.data.pinMac||'')){await clearFailures(db,uid);return signedIn(env,uid,a.data);}
        fail(401,'Profil ou code PIN incorrect.');
      }
      if(!(await verifyPin(env,uid,oldProof,a.data.pinMac||'')))fail(401,'Profil ou ancien PIN incorrect.');
      const next={...a.data,pinLength:4,pinMac:await pinMac(env,uid,newProof)};
      try {
        await db.commit([db.verify('pulse/catalog',precondition(c)),db.write(accessPath,next,precondition(a)),db.write(statusPath,accessStatus(next,status),precondition(status))]);
        await clearFailures(db,uid);return signedIn(env,uid,next);
      } catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Ce profil a changé simultanément. Réessayez.');
  }
  // Les objectifs sont privés : seuls le Worker et l'administrateur peuvent lire
  // pulseGoals. pulseStatus ne reçoit qu'un marqueur pour signaler un changement.
  async function goalOwner(db,storeId,sellerId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId,storeId))fail(400,'Choisissez un vendeur de ce magasin.');
    return {uid:await sellerUid(storeId,Number(sellerId)),storeId,sellerId:Number(sellerId),catalog:c.data,catalogDoc:c};
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
    return summaryGoals(people,servicesForStore(c,storeId,{activeOnly:false}),departmentsForStore(c,storeId,{activeOnly:false}),today());
  }
  async function saveGoals(db,owner,body,{admin=false,sellerVersion}={}) {
    const serviceId=Number(body.serviceId), values=body.values, expected=body.revision;
    if(!isId(serviceId)||!serviceBy(owner.catalog,serviceId,owner.storeId))fail(400,'Choisissez un service actif dans ce magasin.');
    if(!validGoalValues(values))fail(400,'Les objectifs doivent être des entiers entre 0 et 9 999, ou être laissés vides.');
    if(expected!==null&&(typeof expected!=='string'||!SAFE_ID.test(expected)))fail(400,'Actualisez les objectifs avant de les modifier.');
    const goalPath=`pulseGoals/${owner.uid}`,statusPath=`pulseStatus/${owner.uid}`,key=`s${serviceId}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [goalDoc,statusDoc,reset]=await Promise.all([db.get(goalPath),db.get(statusPath),db.get(goalsResetPath(owner.storeId))]);
      // Les vendeurs ciblés peuvent redéfinir leurs objectifs dès que leur lot a
      // été traité. Avant cela, une nouvelle cible serait écrasée par le reset.
      if(reset?.data?.status==='running') {
        const index=(reset.data.sellerIds||[]).indexOf(owner.sellerId);
        if(index>=Number(reset.data.processedSellers||0))fail(409,'La réinitialisation des objectifs de votre département est en cours. Réessayez dans quelques instants.');
      }
      // Une modification du PIN invalide immédiatement une écriture vendeur en cours.
      if(!admin&&(!statusDoc?.data?.active||statusDoc.data.version!==sellerVersion))fail(403,'Profil désactivé ou code PIN modifié. Reconnectez-vous.');
      const previous=goalDoc?.data?.goals?.[key];
      if((previous?.revision||null)!==expected)fail(409,'Cet objectif a changé. Rechargez ses valeurs avant de le modifier.');
      let updated;try{updated=updateGoalEntry(previous,values,{admin});}
      catch(error){fail(403,error.message);}
      const entry={...updated,revision:crypto.randomUUID()};
      // Préserver le planning personnel et les autres champs lors d'une cible.
      const next={...(goalDoc?.data||{}),storeId:owner.storeId,sellerId:owner.sellerId,goals:{...(goalDoc?.data?.goals||{}),[key]:entry}};
      // Une écriture concurrente au lancement ou à la progression du reset
      // relit son état avant de valider : aucune cible récente n'est effacée après coup.
      // L'administrateur peut avoir ouvert ce profil avant sa suppression :
      // la précondition catalogue empêche toute recréation après désactivation.
      const writes=[db.verify('pulse/catalog',precondition(owner.catalogDoc)),db.verify(goalsResetPath(owner.storeId),precondition(reset)),db.write(goalPath,next,precondition(goalDoc)),db.write(goalsMarkerPath(owner.storeId),{revision:crypto.randomUUID()})];
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
      const writes=[db.verify('pulse/catalog',precondition(owner.catalogDoc)),db.write(goalPath,next,precondition(goalDoc)),db.write(goalsMarkerPath(owner.storeId),{revision:crypto.randomUUID()})];
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
    const duplicate=(row,name)=>list.some(x=>x.id!==row?.id&&(x.active||x.deletingJob)&&
      (kind!=='sellers'||sellerStoreId(x)===sellerStoreId(row))&&
      x.name.localeCompare(name,'fr',{sensitivity:'base'})===0);
    let initialPlanning=null;
    if(method==='POST') {
      const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');
      if(list.length>=(kind==='sellers'?1000:200))fail(400,'Nombre maximal atteint.');
      if(kind==='sellers'&&!validStore(d,body.storeId))fail(400,'Choisissez d’abord un magasin valide.');
      const departmentId=body.departmentId;
      if(kind==='sellers'&&(typeof departmentId!=='string'||!departmentsForStore(d,body.storeId).some(x=>x.id===departmentId)))
        fail(400,'Choisissez un département actif de ce magasin.');
      // Une ancienne PWA ne peut plus créer silencieusement un planning par défaut.
      if(kind==='sellers'&&!validWorkdays(body.workdays))
        fail(400,'Choisissez au moins un jour travaillé. Si ce choix n’apparaît pas, mettez l’application à jour.');
      const row={name,...(kind==='sellers'?{storeId:body.storeId}:{})};
      if(duplicate(row,name))fail(409,'Ce nom existe déjà dans cette liste.');
      const next=kind==='sellers'?'nextSellerId':'nextServiceId', newId=d[next]++;
      if(kind==='sellers'&&(!isId(newId)||list.some(s=>Number(s.id)===Number(newId))))
        fail(503,'Création du vendeur indisponible. Réessayez.');
      list.push({id:newId,name,active:true,...(kind==='services'?{icon:'other'}:{storeId:body.storeId,departmentId})});id=newId;
      if(kind==='sellers') {
        const uid=await sellerUid(body.storeId,newId);
        initialPlanning={uid,path:`pulseGoals/${uid}`,data:{storeId:body.storeId,sellerId:newId,goals:{},
          workdays:normalizeWorkdays(body.workdays),workdaysRevision:crypto.randomUUID()}};
      }
    } else {
      const row=list.find(x=>x.id===Number(id));if(!row)fail(404,'Élément introuvable.');
      if(kind==='sellers'&&row.deletingJob)fail(409,'La suppression définitive de ce vendeur est en cours.');
      if(kind==='sellers'&&body.storeId!==undefined&&body.storeId!==sellerStoreId(row))fail(400,'Ce vendeur appartient à un autre magasin.');
      if(typeof body.name==='string') {
        if(body.expectedName!==undefined&&(typeof body.expectedName!=='string'||body.expectedName!==row.name))
          fail(409,'Ce nom a changé ailleurs. Rechargez les valeurs avant de le modifier.');
        const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');row.name=name;
      }
      // Le département est choisi à la création et reste définitif, y compris
      // pour les anciennes interfaces qui proposaient une réaffectation.
      if(kind==='sellers'&&body.departmentId!==undefined&&body.departmentId!==sellerDepartmentId(row))
        fail(409,'Le département de ce vendeur ne peut pas être modifié après sa création.');
      if(typeof body.active==='boolean')row.active=body.active;
      if(kind==='sellers'&&row.active&&!departmentsForStore(d,sellerStoreId(row)).some(x=>x.id===sellerDepartmentId(row)))fail(409,'Restaurez d’abord le département de ce vendeur.');
      if(row.active&&duplicate(row,row.name))fail(409,'Ce nom existe déjà dans cette liste.');
    }
    // Création atomique : le vendeur n'apparaît jamais sans son planning.
    // Un éventuel ancien planning ou accès ne doit ni être écrasé ni rattaché.
    const writes=[db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})];
    if(initialPlanning)writes.push(db.verify(`pulseAccess/${initialPlanning.uid}`,{exists:false}),
      db.verify(`pulseStatus/${initialPlanning.uid}`,{exists:false}),db.write(initialPlanning.path,initialPlanning.data,{exists:false}));
    try{await db.commit(writes);}
    catch(e){if(conflict(e))fail(409,initialPlanning?'Une modification simultanée ou des données préexistantes empêchent la création. Rechargez et réessayez.':'Une modification simultanée a eu lieu. Réessayez.');throw e;}
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
      if(typeof body.name==='string'){
        if(body.expectedName!==undefined&&(typeof body.expectedName!=='string'||body.expectedName!==row.name))
          fail(409,'Ce nom a changé ailleurs. Rechargez les valeurs avant de le modifier.');
        const name=cleanName(body.name);if(!name)fail(400,'Saisissez le nom du département.');row.name=name;
      }
      if(typeof body.active==='boolean') {
        if(!body.active&&d.sellers.some(s=>s.active&&sellerStoreId(s)===storeId&&sellerDepartmentId(s)===id))fail(409,'Archivez les vendeurs actifs avant d’archiver leur département.');
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
  function resetStatus(record) {
    const data=record?.data;
    if(!data)return {status:'idle',jobId:null,deletedSales:0};
    return {status:data.status,jobId:data.jobId,deletedSales:Number(data.deletedSales)||0,startedAt:data.startedAt,finishedAt:data.finishedAt||null};
  }
  async function enqueueSalesReset(env,storeId,jobId) {
    if(!env.PULSE_QUEUE?.sendBatch)throw new Error('File de réinitialisation indisponible');
    await env.PULSE_QUEUE.sendBatch([{body:{kind:'sales-reset',storeId,jobId}}]);
  }
  async function readSalesReset(db,storeId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
    return resetStatus(await db.get(salesResetPath(storeId)));
  }
  async function startSalesReset(db,env,body) {
    const {storeId,jobId,confirmation}=body;
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)||confirmation!==SALES_RESET_CONFIRMATION)
      fail(400,'Confirmation ou sélection du magasin invalide.');
    if(!env.PULSE_QUEUE?.sendBatch)fail(503,'La file de réinitialisation est indisponible.');
    for(let attempt=0;attempt<8;attempt++) {
      const [c,request,previous,marker,deletion,serviceDeletion]=await Promise.all([
        catalog(db),db.get(salesResetRequestPath(jobId)),db.get(salesResetPath(storeId)),db.get(salesMarkerPath(storeId)),db.get(sellerDeletePath(storeId)),db.get(serviceDeletePath(storeId)),
      ]);
      if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
      if(request) {
        if(request.data.storeId!==storeId)fail(409,'Identifiant de réinitialisation déjà utilisé.');
        if(previous?.data.jobId!==jobId)return {status:'superseded',jobId,deletedSales:0};
        if(previous.data.status==='running')await enqueueSalesReset(env,storeId,jobId).catch(()=>{});
        return resetStatus(previous);
      }
      if(previous?.data.status==='running')fail(409,'Une réinitialisation est déjà en cours pour ce magasin.');
      if(previous&&previous.data.status!=='done')fail(503,'État de réinitialisation indisponible. Réessayez plus tard.');
      if(deletion?.data.status==='running'||serviceDeletion?.data.status==='running')fail(409,'Une suppression est en cours dans ce magasin. Réessayez après son achèvement.');
      const next={status:'running',jobId,phase:'sales',cursor:'',deletedSales:0,startedAt:Date.now()};
      const writes=[
        db.verify('pulse/catalog',precondition(c)),db.verify(sellerDeletePath(storeId),precondition(deletion)),db.verify(serviceDeletePath(storeId),precondition(serviceDeletion)),
        db.write(salesResetRequestPath(jobId),{storeId},{exists:false}),
        db.write(salesResetPath(storeId),next,precondition(previous)),
        db.write(salesMarkerPath(storeId),{generation:jobId},precondition(marker)),
        db.write(guardPath(storeId),{revision:crypto.randomUUID()}),
      ];
      try {await db.commit(writes);}
      catch(e){if(conflict(e))continue;throw e;}
      // Si l’envoi échoue ou si la réponse est perdue après le commit, le cron
      // retrouve le travail durable. Un même jobId ne peut jamais lancer un second reset.
      await enqueueSalesReset(env,storeId,jobId).catch(()=>console.warn('PULSE_SALES_RESET_QUEUE indisponible'));
      return resetStatus({data:next});
    }
    fail(409,'Le magasin a changé. Actualisez avant de réessayer.');
  }
  async function processSalesReset(db,storeId,jobId) {
    const path=salesResetPath(storeId),state=await db.get(path);
    if(!state||state.data.status!=='running'||state.data.jobId!==jobId)return {running:false};
    const outboxes=state.data.phase==='outboxes',collection=outboxes?'pulseOutbox':`pulseStores/${storeId}/sales`;
    const rows=await db.page(collection,{...(outboxes?{field:'storeId',value:storeId}:{}),limit:RESET_BATCH_SIZE,after:state.data.cursor||''});
    let next,writes=[];
    if(!rows.length) {
      next=outboxes?{...state.data,status:'done',phase:'done',cursor:'',finishedAt:Date.now()}:
        {...state.data,phase:'outboxes',cursor:''};
    } else {
      let removed=0;
      for(const row of rows) {
        if(saleInGeneration(row.data,jobId))continue;
        if(outboxes) {
          // Garder seulement un tombstone technique : il empêche un ancien
          // identifiant de requête de recréer une vente après le reset.
          writes.push(db.write(`${collection}/${row.id}`,{status:'reset'},precondition(row)));
        } else if(!row.id.startsWith('~')) {
          writes.push(db.delete(`${collection}/${row.id}`,precondition(row)));removed++;
        }
      }
      next={...state.data,cursor:rows.at(-1).id,deletedSales:(Number(state.data.deletedSales)||0)+removed};
    }
    writes.push(db.write(path,next,precondition(state)));
    try {await db.commit(writes);}
    catch(e){if(conflict(e))return {running:true,conflict:true};throw e;}
    return {running:next.status==='running'};
  }
  function goalsResetStatus(record) {
    const data=record?.data;
    if(!data)return {status:'idle',jobId:null,departmentId:null,departmentName:'',totalSellers:0,processedSellers:0,resetSellers:0};
    // Ne jamais renvoyer la liste des vendeurs ni leurs objectifs dans le statut.
    return {status:data.status,jobId:data.jobId,departmentId:data.departmentId,departmentName:data.departmentName,
      totalSellers:Number(data.totalSellers)||0,processedSellers:Number(data.processedSellers)||0,resetSellers:Number(data.resetSellers)||0,
      startedAt:data.startedAt,finishedAt:data.finishedAt||null};
  }
  async function enqueueGoalsReset(env,storeId,jobId) {
    if(!env.PULSE_QUEUE?.sendBatch)throw new Error('File de réinitialisation indisponible');
    await env.PULSE_QUEUE.sendBatch([{body:{kind:'goals-reset',storeId,jobId}}]);
  }
  async function readGoalsReset(db,storeId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
    return goalsResetStatus(await db.get(goalsResetPath(storeId)));
  }
  async function startGoalsReset(db,env,body) {
    const {storeId,departmentId,jobId,confirmation}=body;
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof departmentId!=='string'||!STORE_ID.test(departmentId)||
       typeof jobId!=='string'||!SAFE_ID.test(jobId)||confirmation!==GOALS_RESET_CONFIRMATION)
      fail(400,'Confirmation, magasin ou département invalide.');
    if(!env.PULSE_QUEUE?.sendBatch)fail(503,'La file de réinitialisation est indisponible.');
    for(let attempt=0;attempt<8;attempt++) {
      const [c,request,previous,deletion,serviceDeletion]=await Promise.all([catalog(db),db.get(goalsResetRequestPath(jobId)),db.get(goalsResetPath(storeId)),db.get(sellerDeletePath(storeId)),db.get(serviceDeletePath(storeId))]);
      if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
      if(request) {
        if(request.data.storeId!==storeId||request.data.departmentId!==departmentId)fail(409,'Identifiant de réinitialisation déjà utilisé.');
        if(previous?.data.jobId!==jobId)return {status:'superseded',jobId,departmentId};
        if(previous.data.status==='running')await enqueueGoalsReset(env,storeId,jobId).catch(()=>{});
        return goalsResetStatus(previous);
      }
      if(previous?.data.status==='running')fail(409,'Un reset des objectifs est déjà en cours pour ce magasin.');
      if(previous&&previous.data.status!=='done')fail(503,'État de réinitialisation indisponible. Réessayez plus tard.');
      if(deletion?.data.status==='running'||serviceDeletion?.data.status==='running')fail(409,'Une suppression est en cours dans ce magasin. Réessayez après son achèvement.');
      const department=departmentsForStore(c.data,storeId,{activeOnly:false}).find(d=>d.id===departmentId);
      if(!department)fail(400,'Choisissez un département de ce magasin.');
      // Photo exacte au moment de la confirmation, vendeurs archivés compris.
      // Une réaffectation ultérieure ne modifie pas cette liste déjà confirmée.
      const sellerIds=c.data.sellers.filter(s=>sellerStoreId(s)===storeId&&sellerDepartmentId(s)===departmentId).map(s=>s.id);
      const now=Date.now(),next={status:sellerIds.length?'running':'done',jobId,departmentId,departmentName:department.name,
        sellerIds,totalSellers:sellerIds.length,processedSellers:0,resetSellers:0,startedAt:now,...(!sellerIds.length?{finishedAt:now}:{})};
      const writes=[db.verify('pulse/catalog',precondition(c)),db.verify(sellerDeletePath(storeId),precondition(deletion)),db.verify(serviceDeletePath(storeId),precondition(serviceDeletion)),db.write(goalsResetRequestPath(jobId),{storeId,departmentId},{exists:false}),
        db.write(goalsResetPath(storeId),next,precondition(previous))];
      try {await db.commit(writes);}
      catch(e){if(conflict(e))continue;throw e;}
      // Le suivi est durable : si la file ou la réponse réseau tombe, le cron
      // reprend le même travail sans jamais relancer un second effacement.
      if(sellerIds.length)await enqueueGoalsReset(env,storeId,jobId).catch(()=>console.warn('PULSE_GOALS_RESET_QUEUE indisponible'));
      return goalsResetStatus({data:next});
    }
    fail(409,'Le magasin ou le département a changé. Actualisez avant de réessayer.');
  }
  async function processGoalsReset(db,storeId,jobId) {
    const path=goalsResetPath(storeId),state=await db.get(path);
    if(!state||state.data.status!=='running'||state.data.jobId!==jobId)return {running:false};
    const start=Number(state.data.processedSellers)||0,ids=state.data.sellerIds.slice(start,start+GOALS_RESET_BATCH_SIZE);
    const uids=await Promise.all(ids.map(id=>sellerUid(storeId,id)));
    const paths=uids.flatMap(uid=>[`pulseGoals/${uid}`,`pulseStatus/${uid}`]);
    const docs=await db.getMany(paths),writes=[];let cleared=0;
    for(let i=0;i<ids.length;i++) {
      const goal=docs[2*i],status=docs[2*i+1],goalPath=paths[2*i],statusPath=paths[2*i+1];
      if(!goal||!Object.keys(goal.data.goals||{}).length)continue;
      // Ne retirer que les cibles : les jours travaillés, leur révision et tout
      // autre champ personnel restent intacts, même en cas de changement simultané.
      writes.push(db.write(goalPath,{...goal.data,goals:{}},precondition(goal)));cleared++;
      if(status)writes.push(db.write(statusPath,{...status.data,goalsRevision:crypto.randomUUID()},precondition(status)));
      else writes.push(db.verify(statusPath,{exists:false}));
    }
    const processed=start+ids.length,done=processed>=state.data.sellerIds.length;
    const next={...state.data,processedSellers:processed,resetSellers:(Number(state.data.resetSellers)||0)+cleared,
      ...(done?{status:'done',finishedAt:Date.now()}:{})};
    // Le récapitulatif est invalidé à la fin, et non à chaque lot, pour éviter
    // des rafales de lectures Firestore sur tous les téléphones du magasin.
    if(done&&next.resetSellers)writes.push(db.write(goalsMarkerPath(storeId),{revision:crypto.randomUUID()}));
    writes.push(db.write(path,next,precondition(state)));
    try {await db.commit(writes);}
    catch(e){if(conflict(e))return {running:true,conflict:true};throw e;}
    return {running:!done};
  }
  // Le catalogue des services reste commun. Une exclusion propre au magasin
  // bloque immédiatement les nouvelles écritures ; les données historiques du
  // seul service ciblé sont ensuite effacées par lots durables et rejouables.
  function serviceDeleteStatus(record) {
    const data=record?.data;
    if(!data)return {status:'idle',jobId:null,deletedSales:0,deletedGoals:0};
    return {status:data.status,jobId:data.jobId,serviceId:data.serviceId,serviceName:data.serviceName,
      deletedSales:Number(data.deletedSales)||0,deletedGoals:Number(data.deletedGoals)||0,
      skippedGoals:Number(data.skippedGoals)||0,phase:data.phase,startedAt:data.startedAt,finishedAt:data.finishedAt||null};
  }
  async function enqueueServiceDelete(env,storeId,jobId) {
    if(!env.PULSE_QUEUE?.sendBatch)throw new Error('File de suppression indisponible');
    await env.PULSE_QUEUE.sendBatch([{body:{kind:'service-delete',storeId,jobId}}]);
  }
  async function readServiceDelete(db,storeId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
    return serviceDeleteStatus(await db.get(serviceDeletePath(storeId)));
  }
  async function startServiceDelete(db,env,body) {
    const {storeId,serviceId,jobId,confirmation,expectedName,expectedStoreName}=body;
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||!isId(serviceId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)||
       confirmation!==SERVICE_DELETE_CONFIRMATION||typeof expectedName!=='string'||typeof expectedStoreName!=='string')
      fail(400,'Confirmation, magasin ou service invalide.');
    if(!env.PULSE_QUEUE?.sendBatch)fail(503,'La file de suppression est indisponible.');
    const id=Number(serviceId);
    for(let attempt=0;attempt<8;attempt++) {
      const [c,request,previous,salesReset,goalsReset,sellerDeletion]=await Promise.all([
        catalog(db),db.get(serviceDeleteRequestPath(jobId)),db.get(serviceDeletePath(storeId)),
        db.get(salesResetPath(storeId)),db.get(goalsResetPath(storeId)),db.get(sellerDeletePath(storeId)),
      ]);
      if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
      if(request) {
        if(request.data.storeId!==storeId||request.data.serviceId!==id)fail(409,'Identifiant de suppression déjà utilisé.');
        if(previous?.data.jobId!==jobId)return {status:'superseded',jobId,serviceId:id,deletedSales:0,deletedGoals:0};
        if(previous.data.status==='running')await enqueueServiceDelete(env,storeId,jobId).catch(()=>{});
        return serviceDeleteStatus(previous);
      }
      if(previous?.data.status==='running')fail(409,'Une suppression de service est déjà en cours dans ce magasin.');
      if(previous&&previous.data.status!=='done')fail(503,'État de suppression indisponible. Réessayez plus tard.');
      if(salesReset?.data.status==='running'||goalsReset?.data.status==='running'||sellerDeletion?.data.status==='running')
        fail(409,'Une autre suppression ou réinitialisation est en cours dans ce magasin. Attendez sa fin.');
      const service=c.data.services.find(s=>Number(s.id)===id),store=c.data.stores.find(s=>s.id===storeId);
      if(!service||serviceRemovedForStore(c.data,storeId,id))fail(400,'Choisissez un service présent dans ce magasin.');
      if(service.name!==expectedName||store?.name!==expectedStoreName)
        fail(409,'Le service ou le magasin a changé. Vérifiez votre choix avant de réessayer.');
      const nextCatalog=structuredClone(c.data),removed=nextCatalog.serviceRemovalsByStore?.[storeId]||[];
      if(!Array.isArray(removed))fail(409,'La configuration de services de ce magasin doit être vérifiée.');
      nextCatalog.serviceRemovalsByStore={...(nextCatalog.serviceRemovalsByStore||{}),[storeId]:[...removed,id]};
      // Tous les vendeurs connus, archivés compris : cette photo permet aussi de
      // traiter les anciens documents d'objectifs sans champ storeId.
      const sellerIds=c.data.sellers.filter(s=>sellerStoreId(s)===storeId).map(s=>Number(s.id));
      const next={status:'running',jobId,serviceId:id,serviceName:service.name,phase:'sales',cursor:'',sellerIds,processedSellers:0,
        deletedSales:0,deletedGoals:0,skippedGoals:0,startedAt:Date.now()};
      const writes=[db.verify(salesResetPath(storeId),precondition(salesReset)),db.verify(goalsResetPath(storeId),precondition(goalsReset)),
        db.verify(sellerDeletePath(storeId),precondition(sellerDeletion)),db.write('pulse/catalog',withFlags(nextCatalog),precondition(c)),
        db.write(serviceDeleteRequestPath(jobId),{storeId,serviceId:id},{exists:false}),db.write(serviceDeletePath(storeId),next,precondition(previous))];
      try {await db.commit(writes);}
      catch(e){if(conflict(e))continue;throw e;}
      await enqueueServiceDelete(env,storeId,jobId).catch(()=>console.warn('PULSE_SERVICE_DELETE_QUEUE indisponible'));
      return serviceDeleteStatus({data:next});
    }
    fail(409,'Le service ou le magasin a changé. Actualisez avant de réessayer.');
  }
  async function restoreStoreService(db,body) {
    const {storeId,serviceId,expectedName,expectedStoreName}=body;
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||!isId(serviceId)||typeof expectedName!=='string'||typeof expectedStoreName!=='string')
      fail(400,'Magasin ou service invalide.');
    const id=Number(serviceId);
    for(let attempt=0;attempt<8;attempt++) {
      const [c,deletion]=await Promise.all([catalog(db),db.get(serviceDeletePath(storeId))]);
      if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
      if(deletion&&deletion.data.status!=='done')fail(409,'La suppression en cours ou à vérifier doit être résolue avant toute réactivation.');
      const service=c.data.services.find(s=>Number(s.id)===id),store=c.data.stores.find(s=>s.id===storeId);
      if(!service||!serviceRemovedForStore(c.data,storeId,id))fail(400,'Ce service n’est pas retiré de ce magasin.');
      if(service.name!==expectedName||store?.name!==expectedStoreName)fail(409,'Le service ou le magasin a changé. Vérifiez votre choix.');
      const next=structuredClone(c.data),removed=(next.serviceRemovalsByStore[storeId]||[]).filter(x=>Number(x)!==id);
      if(removed.length)next.serviceRemovalsByStore[storeId]=removed;else delete next.serviceRemovalsByStore[storeId];
      try {await db.commit([db.verify(serviceDeletePath(storeId),precondition(deletion)),db.write('pulse/catalog',withFlags(next),precondition(c))]);return {ok:true};}
      catch(e){if(!conflict(e))throw e;}
    }
    fail(409,'Le service ou le magasin a changé. Actualisez avant de réessayer.');
  }
  async function processServiceDelete(db,storeId,jobId) {
    const path=serviceDeletePath(storeId),state=await db.get(path);
    if(!state||state.data.status!=='running'||state.data.jobId!==jobId)return {running:false};
    const {serviceId,phase}=state.data,key=`s${serviceId}`;
    let next,writes=[];
    if(phase==='sales') {
      const collection=`pulseStores/${storeId}/sales`;
      const rows=await db.page(collection,{field:'serviceId',value:Number(serviceId),limit:SERVICE_DELETE_BATCH_SIZE,after:state.data.cursor||''});
      if(!rows.length)next={...state.data,phase:'goals',cursor:''};
      else {
        const outboxes=await db.getMany(rows.map(row=>`pulseOutbox/${row.id}`));
        for(let i=0;i<rows.length;i++) {
          const row=rows[i],outbox=outboxes[i];
          writes.push(db.delete(`${collection}/${row.id}`,precondition(row)));
          // Bloquer le rejeu d'un ancien identifiant, sans toucher à une outbox
          // qui appartiendrait à un autre magasin.
          if(!outbox)writes.push(db.write(`pulseOutbox/${row.id}`,{status:'reset'},{exists:false}));
          else if(outbox.data.storeId===storeId&&outbox.data.saleId===row.id)
            writes.push(db.write(`pulseOutbox/${row.id}`,{status:'reset'},precondition(outbox)));
        }
        next={...state.data,cursor:rows.at(-1).id,deletedSales:(Number(state.data.deletedSales)||0)+rows.length};
      }
    } else if(phase==='goals') {
      const start=Number(state.data.processedSellers)||0,ids=(state.data.sellerIds||[]).slice(start,start+SERVICE_GOAL_BATCH_SIZE);
      const uids=await Promise.all(ids.map(id=>sellerUid(storeId,id)));
      const paths=uids.flatMap(uid=>[`pulseGoals/${uid}`,`pulseStatus/${uid}`]),docs=await db.getMany(paths);let cleared=0,skipped=0;
      for(let i=0;i<ids.length;i++) {
        const goal=docs[2*i],status=docs[2*i+1];
        if(!goal||!Object.hasOwn(goal.data.goals||{},key))continue;
        if((goal.data.storeId&&goal.data.storeId!==storeId)||(goal.data.sellerId&&Number(goal.data.sellerId)!==ids[i])){skipped++;continue;}
        const goals={...goal.data.goals};delete goals[key];
        writes.push(db.write(paths[2*i],{...goal.data,goals},precondition(goal)));cleared++;
        if(status)writes.push(db.write(paths[2*i+1],{...status.data,goalsRevision:crypto.randomUUID()},precondition(status)));
        else writes.push(db.verify(paths[2*i+1],{exists:false}));
      }
      const processed=start+ids.length,finished=processed>=(state.data.sellerIds||[]).length;
      next={...state.data,processedSellers:processed,deletedGoals:(Number(state.data.deletedGoals)||0)+cleared,skippedGoals:(Number(state.data.skippedGoals)||0)+skipped,
        ...(finished?{phase:'orphan-goals',cursor:''}:{})};
    } else if(phase==='orphan-goals') {
      // Des documents orphelins correctement rattachés au magasin peuvent
      // subsister hors du catalogue : les traiter sans toucher aux autres magasins.
      const rows=await db.page('pulseGoals',{field:'storeId',value:storeId,limit:SERVICE_GOAL_BATCH_SIZE,after:state.data.cursor||''});
      if(!rows.length) {
        next={...state.data,status:Number(state.data.skippedGoals)>0?'needs-review':'done',phase:'done',cursor:'',finishedAt:Date.now()};
        writes.push(db.write(goalsMarkerPath(storeId),{revision:crypto.randomUUID()}));
      } else {
        const candidates=[];let skipped=0;
        for(const row of rows)if(Object.hasOwn(row.data.goals||{},key)) {
          // Un UID déterministe correspondant au magasin et au vendeur est
          // indispensable avant d'effacer une cible d'un document orphelin.
          if(!isId(row.data.sellerId)||row.id!==await sellerUid(storeId,Number(row.data.sellerId))){skipped++;continue;}
          candidates.push(row);
        }
        const statusPaths=candidates.map(row=>`pulseStatus/${row.id}`),statuses=await db.getMany(statusPaths);
        for(let i=0;i<candidates.length;i++) {
          const goal=candidates[i],status=statuses[i],goals={...goal.data.goals};delete goals[key];
          writes.push(db.write(`pulseGoals/${goal.id}`,{...goal.data,goals},precondition(goal)));
          if(status)writes.push(db.write(statusPaths[i],{...status.data,goalsRevision:crypto.randomUUID()},precondition(status)));
          else writes.push(db.verify(statusPaths[i],{exists:false}));
        }
        next={...state.data,cursor:rows.at(-1).id,deletedGoals:(Number(state.data.deletedGoals)||0)+candidates.length,skippedGoals:(Number(state.data.skippedGoals)||0)+skipped};
      }
    } else throw new Error('Étape de suppression de service inconnue');
    writes.push(db.write(path,next,precondition(state)));
    try {await db.commit(writes);}
    catch(e){if(conflict(e))return {running:true,conflict:true};throw e;}
    return {running:next.status==='running'};
  }

  // Suppression d'un seul vendeur. Le lancement révoque son accès atomiquement ;
  // les lots sont ensuite rejouables et récupérés par la file ou le cron.
  function sellerDeleteStatus(record) {
    const data=record?.data;
    if(!data)return {status:'idle',jobId:null,deletedSales:0};
    return {status:data.status,jobId:data.jobId,deletedSales:Number(data.deletedSales)||0,
      ...(data.status==='running'?{sellerId:data.sellerId,sellerName:data.sellerName,phase:data.phase}:{}),
      startedAt:data.startedAt,finishedAt:data.finishedAt||null};
  }
  async function enqueueSellerDelete(env,storeId,jobId) {
    if(!env.PULSE_QUEUE?.sendBatch)throw new Error('File de suppression indisponible');
    await env.PULSE_QUEUE.sendBatch([{body:{kind:'seller-delete',storeId,jobId}}]);
  }
  async function readSellerDelete(db,storeId) {
    const c=await catalog(db);
    if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
    return sellerDeleteStatus(await db.get(sellerDeletePath(storeId)));
  }
  async function startSellerDelete(db,env,body) {
    const {storeId,sellerId,jobId,confirmation}=body;
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||!isId(sellerId)||
       typeof jobId!=='string'||!SAFE_ID.test(jobId)||confirmation!==SELLER_DELETE_CONFIRMATION)
      fail(400,'Confirmation, magasin ou vendeur invalide.');
    if(!env.PULSE_QUEUE?.sendBatch)fail(503,'La file de suppression est indisponible.');
    const id=Number(sellerId),uid=await sellerUid(storeId,id),accessPath=`pulseAccess/${uid}`,
      statusPath=`pulseStatus/${uid}`,goalPath=`pulseGoals/${uid}`,attemptPath=`pulseAttempts/${uid}`;
    for(let attempt=0;attempt<8;attempt++) {
      const [c,request,previous,salesReset,goalsReset,serviceDeletion,access,status,goal,attempts]=await Promise.all([
        catalog(db),db.get(sellerDeleteRequestPath(jobId)),db.get(sellerDeletePath(storeId)),
        db.get(salesResetPath(storeId)),db.get(goalsResetPath(storeId)),db.get(serviceDeletePath(storeId)),db.get(accessPath),db.get(statusPath),db.get(goalPath),db.get(attemptPath),
      ]);
      if(!validStore(c.data,storeId))fail(400,'Choisissez un magasin valide.');
      if(request) {
        if(request.data.storeId!==storeId||request.data.sellerId!==id)fail(409,'Identifiant de suppression déjà utilisé.');
        if(previous?.data.jobId!==jobId)return {status:'superseded',jobId,deletedSales:0};
        if(previous.data.status==='running')await enqueueSellerDelete(env,storeId,jobId).catch(()=>{});
        return sellerDeleteStatus(previous);
      }
      if(previous?.data.status==='running')fail(409,'Une suppression de vendeur est déjà en cours pour ce magasin.');
      if(previous&&previous.data.status!=='done')fail(503,'État de suppression indisponible. Réessayez plus tard.');
      if(salesReset?.data.status==='running'||goalsReset?.data.status==='running'||serviceDeletion?.data.status==='running')
        fail(409,'Une réinitialisation ou suppression est en cours dans ce magasin. Attendez sa fin avant de supprimer un vendeur.');
      const member=c.data.sellers.find(s=>Number(s.id)===id&&sellerStoreId(s)===storeId);
      if(!member||member.deletingJob)fail(400,'Choisissez un vendeur de ce magasin.');
      if((body.expectedName!==undefined&&member.name!==body.expectedName)||
         (body.expectedDepartmentId!==undefined&&sellerDepartmentId(member)!==body.expectedDepartmentId)||
         (body.expectedStoreName!==undefined&&c.data.stores.find(s=>s.id===storeId)?.name!==body.expectedStoreName))
        fail(409,'Le profil ou le magasin a changé. Vérifiez votre choix avant de réessayer.');
      const nextCatalog=structuredClone(c.data),row=nextCatalog.sellers.find(s=>Number(s.id)===id);
      row.active=false;row.deletingJob=jobId;
      const revoked={active:false,storeId,sellerId:id,sellerKey:`s${id}`,version:crypto.randomUUID()};
      const next={status:'running',jobId,sellerId:id,sellerName:member.name,uid,phase:'sales',cursor:'',deletedSales:0,startedAt:Date.now()};
      const writes=[
        db.verify(salesResetPath(storeId),precondition(salesReset)),db.verify(goalsResetPath(storeId),precondition(goalsReset)),db.verify(serviceDeletePath(storeId),precondition(serviceDeletion)),
        db.write('pulse/catalog',withFlags(nextCatalog),precondition(c)),
        db.write(accessPath,revoked,precondition(access)),db.write(statusPath,accessStatus(revoked,status),precondition(status)),
        db.delete(goalPath,precondition(goal)),db.delete(attemptPath,precondition(attempts)),
        db.write(goalsMarkerPath(storeId),{revision:crypto.randomUUID()}),
        db.write(sellerDeleteRequestPath(jobId),{storeId,sellerId:id},{exists:false}),
        db.write(sellerDeletePath(storeId),next,precondition(previous)),
      ];
      try {await db.commit(writes);}
      catch(e){if(conflict(e))continue;throw e;}
      await enqueueSellerDelete(env,storeId,jobId).catch(()=>console.warn('PULSE_SELLER_DELETE_QUEUE indisponible'));
      return sellerDeleteStatus({data:next});
    }
    fail(409,'Le profil ou le magasin a changé. Actualisez avant de réessayer.');
  }
  async function processSellerDelete(db,storeId,jobId) {
    const path=sellerDeletePath(storeId),state=await db.get(path);
    if(!state||state.data.status!=='running'||state.data.jobId!==jobId)return {running:false};
    const {sellerId,uid,phase}=state.data;
    let next,writes=[];
    if(phase==='sales') {
      const collection=`pulseStores/${storeId}/sales`;
      const rows=await db.page(collection,{field:'sellerId',value:Number(sellerId),limit:SELLER_DELETE_BATCH_SIZE,after:state.data.cursor||''});
      if(!rows.length)next={...state.data,phase:'tokens',cursor:''};
      else {
        const outboxes=await db.getMany(rows.map(row=>`pulseOutbox/${row.id}`));
        for(let i=0;i<rows.length;i++) {
          const row=rows[i],outbox=outboxes[i];
          writes.push(db.delete(`${collection}/${row.id}`,precondition(row)));
          // Un marqueur anonyme bloque le rejeu d'un ancien identifiant de vente.
          // Ne jamais toucher à une notification qui appartiendrait à un autre magasin.
          if(!outbox)writes.push(db.write(`pulseOutbox/${row.id}`,{status:'reset'},{exists:false}));
          else if(outbox.data.storeId===storeId&&outbox.data.saleId===row.id)
            writes.push(db.write(`pulseOutbox/${row.id}`,{status:'reset'},precondition(outbox)));
        }
        next={...state.data,cursor:rows.at(-1).id,deletedSales:(Number(state.data.deletedSales)||0)+rows.length};
      }
    } else if(phase==='tokens'||phase==='registrations') {
      const collection=phase==='tokens'?'pulseTokens':'pulseRegistrations';
      const rows=await db.page(collection,{field:'uid',value:uid,limit:SELLER_DELETE_BATCH_SIZE,after:state.data.cursor||''});
      if(!rows.length)next={...state.data,phase:phase==='tokens'?'registrations':'backups',cursor:''};
      else {
        for(const row of rows)writes.push(phase==='tokens'?db.delete(`${collection}/${row.id}`,precondition(row)):
          // Empêcher qu'une ancienne demande d'inscription recrée le profil,
          // sans conserver de nom, magasin, PIN, sel ou identifiant de vendeur.
          db.write(`${collection}/${row.id}`,{status:'removed'},precondition(row)));
        next={...state.data,cursor:rows.at(-1).id};
      }
    } else if(phase==='backups') {
      // Ces instantanés contiennent tout le catalogue ; traiter un seul gros
      // document à la fois pour rester dans la limite CPU des Workers gratuits.
      const rows=await db.page('pulseBackups',{limit:1,after:state.data.cursor||''});
      if(!rows.length)next={...state.data,phase:'finalize',cursor:''};
      else {
        for(const row of rows) {
          const copy=structuredClone(row.data),saved=copy.catalog;
          if(!Array.isArray(saved?.sellers)||!saved.sellers.some(s=>Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId))continue;
          saved.sellers=saved.sellers.filter(s=>!(Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId));
          if(saved.sellerFlags)delete saved.sellerFlags[`s${sellerId}`];
          if(saved.sellerStores)delete saved.sellerStores[`s${sellerId}`];
          writes.push(db.write(`pulseBackups/${row.id}`,copy,precondition(row)));
        }
        next={...state.data,cursor:rows.at(-1).id};
      }
    } else if(phase==='finalize') {
      const accessPath=`pulseAccess/${uid}`,statusPath=`pulseStatus/${uid}`,goalPath=`pulseGoals/${uid}`,attemptPath=`pulseAttempts/${uid}`;
      const [c,access,status,goal,attempts]=await Promise.all([catalog(db),db.get(accessPath),db.get(statusPath),db.get(goalPath),db.get(attemptPath)]);
      const member=c.data.sellers.find(s=>Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId);
      if(member&&member.deletingJob!==jobId)throw new Error('État de vendeur incohérent');
      const nextCatalog=structuredClone(c.data);
      nextCatalog.sellers=nextCatalog.sellers.filter(s=>!(Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId));
      // Aucun nom ou UID n'est conservé dans le statut terminé.
      next={status:'done',jobId,deletedSales:Number(state.data.deletedSales)||0,startedAt:state.data.startedAt,finishedAt:Date.now()};
      writes.push(db.write('pulse/catalog',withFlags(nextCatalog),precondition(c)),
        db.delete(accessPath,precondition(access)),db.delete(statusPath,precondition(status)),
        db.delete(goalPath,precondition(goal)),db.delete(attemptPath,precondition(attempts)));
    } else throw new Error('Étape de suppression inconnue');
    writes.push(db.write(path,next,precondition(state)));
    try {await db.commit(writes);}
    catch(e){if(conflict(e))return {running:true,conflict:true};throw e;}
    return {running:next.status==='running'};
  }
  async function findToday(db,storeId,marker=undefined) {
    const [rows,resetMarker]=await Promise.all([
      db.query(`pulseStores/${storeId}/sales`,'businessDate','EQUAL',today(),2001),
      marker===undefined?db.get(salesMarkerPath(storeId)):Promise.resolve(marker),
    ]);
    if(rows.length>2000)fail(409,'Plus de 2 000 opérations ce jour : correction indisponible, contactez l’administrateur.');
    const generation=salesGeneration(resetMarker?.data);
    return rows.filter(row=>saleInGeneration(row.data,generation));
  }
  function saleAuthorizationChecks(db,session) {
    return [db.verify(`pulseAccess/${session.claims.sub}`,precondition(session.accessDoc)),db.verify('pulse/catalog',precondition(session.catalogDoc))];
  }
  async function addSale(req,env,db,ctx,body) {
    const s=await seller(req,env,db),service=serviceBy(s.catalog,body.serviceId,s.claims.storeId),requestId=body.requestId;
    if(!service||!SAFE_ID.test(requestId||''))fail(400,'Service ou identifiant de vente invalide.');
    const storeId=s.claims.storeId,sellerId=Number(s.claims.sellerId),person=sellerBy(s.catalog,sellerId,storeId),departmentId=sellerDepartmentId(person),businessDate=today();
    if(Object.hasOwn(body,'expectedDate')&&(typeof body.expectedDate!=='string'||body.expectedDate!==businessDate))
      fail(409,'La journée a changé. Vérifiez le bilan avant de recommencer.');
    if(Object.hasOwn(body,'expectedDepartmentId')&&(typeof body.expectedDepartmentId!=='string'||body.expectedDepartmentId!==departmentId))
      fail(409,'Votre département a changé. Vérifiez le bilan avant de recommencer.');
    // Ces deux lectures indépendantes se font en parallèle ; les contrôles et
    // les préconditions du commit restent identiques.
    const tokenId=typeof body.originTokenId==='string'&&PROOF.test(body.originTokenId)?body.originTokenId:'';
    const [marker,originToken]=await Promise.all([db.get(salesMarkerPath(storeId)),tokenId?db.get(`pulseTokens/${tokenId}`):Promise.resolve(null)]);
    const generation=salesGeneration(marker?.data);
    // Une nouvelle interface lie aussi la demande à la génération affichée :
    // un rejeu incertain ne peut pas recréer une vente après un reset.
    if(Object.hasOwn(body,'expectedGeneration')&&(typeof body.expectedGeneration!=='string'||body.expectedGeneration!==generation))
      fail(409,'Les ventes ont été réinitialisées. Vérifiez le bilan avant de recommencer.');
    const data={id:requestId,storeId,sellerId,departmentId,serviceId:service.id,createdAt:new Date().toISOString(),businessDate,deletedAt:null,source:'sale',clientId:typeof body.clientId==='string'?body.clientId.slice(0,80):'',ownerUid:s.claims.sub,generation};
    // Le jeton émetteur n'est retenu que s'il appartient bien à cette session.
    const originTokenId=originToken?.data.uid===s.claims.sub&&originToken.data.storeId===storeId&&originToken.data.accessVersion===s.claims.accessVersion?tokenId:'';
    const outbox={saleId:requestId,storeId,sellerId,departmentId,sellerName:person.name,serviceName:service.name,status:'pending',createdAt:Date.now(),leaseUntil:0,generation,...(originTokenId?{originTokenId}:{})};
    try {await db.commit([...saleAuthorizationChecks(db,s),db.verify(salesMarkerPath(storeId),precondition(marker)),db.write(docPath(storeId,requestId),data,{exists:false}),db.write(`pulseOutbox/${requestId}`,outbox,{exists:false}),db.write(guardPath(storeId),{revision:crypto.randomUUID()})]);}
    catch(e) {
      if(!conflict(e))throw e;
      const [existing,latest,currentCatalog]=await Promise.all([db.get(docPath(storeId,requestId)),db.get(salesMarkerPath(storeId)),catalog(db)]);
      if(serviceRemovedForStore(currentCatalog.data,storeId,service.id)||!existing||!saleInGeneration(existing.data,salesGeneration(latest?.data)))fail(409,'La vente ne peut pas être confirmée. Si le service ou le magasin vient d’être réinitialisé, vérifiez le bilan avant de réessayer.');
      if(existing.data.ownerUid!==s.claims.sub || existing.data.serviceId!==service.id)fail(409,'Identifiant de vente déjà utilisé.');
      if(existing.data.deletedAt)fail(409,'Cette vente a déjà été annulée. Vérifiez le bilan avant de recommencer.');
      ctx.waitUntil(dispatch(env,db,requestId).catch(e=>logPushError('dispatch',e)));return {id:requestId,duplicate:true};
    }
    ctx.waitUntil(dispatch(env,db,requestId).catch(e=>logPushError('dispatch',e)));return {id:requestId};
  }
  async function deleteSale(req,env,db,id) {
    if(!SAFE_ID.test(id||''))fail(400,'Vente invalide.');
    const s=await seller(req,env,db),path=docPath(s.claims.storeId,id);
    const [d,marker]=await Promise.all([db.get(path),db.get(salesMarkerPath(s.claims.storeId))]);
    if(!d||d.data.ownerUid!==s.claims.sub||d.data.businessDate!==today()||d.data.deletedAt||serviceRemovedForStore(s.catalog,s.claims.storeId,d.data.serviceId)||!saleInGeneration(d.data,salesGeneration(marker?.data)))fail(409,'Cette vente ne peut plus être annulée.');
    try {await db.commit([...saleAuthorizationChecks(db,s),db.verify(salesMarkerPath(s.claims.storeId),precondition(marker)),db.write(path,{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}),db.write(guardPath(s.claims.storeId),{revision:crypto.randomUUID()})]);}
    catch(e){if(conflict(e))fail(409,'Votre accès, le catalogue ou cette vente a changé. Actualisez avant de réessayer.');throw e;}
    return {ok:true,id};
  }
  async function removeLatest(req,env,db,body) {
    const s=await seller(req,env,db);if(!serviceBy(s.catalog,body.serviceId,s.claims.storeId))fail(400,'Service invalide dans ce magasin.');
    const departmentId=sellerDepartmentId(sellerBy(s.catalog,s.claims.sellerId,s.claims.storeId));
    const rows=(await findToday(db,s.claims.storeId)).filter(x=>x.data.ownerUid===s.claims.sub&&saleDepartmentId(x.data)===departmentId&&x.data.serviceId===Number(body.serviceId)&&!x.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    if(!rows.length)fail(409,'Aucune vente à retirer pour ce service aujourd’hui.');
    return deleteSale(req,env,db,rows[0].id);
  }
  async function adjust(db,body) {
    const {storeId,sellerId,serviceId,count}=body,c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId,storeId)||!serviceBy(c.data,serviceId,storeId)||!Number.isInteger(count)||count<0||count>100)fail(400,'Choisissez une quantité entre 0 et 100.');
    const [guard,marker]=await Promise.all([db.get(guardPath(storeId)),db.get(salesMarkerPath(storeId))]);
    const generation=salesGeneration(marker?.data);
    const rows=(await findToday(db,storeId,marker)).filter(d=>d.data.sellerId===Number(sellerId)&&d.data.serviceId===Number(serviceId)&&!d.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    const delta=count-rows.length;if(Math.abs(delta)>100)fail(400,'Modifiez le total par étapes de 100 maximum.');
    const writes=[db.verify(salesMarkerPath(storeId),precondition(marker)),db.verify('pulse/catalog',precondition(c)),db.write(guardPath(storeId),{revision:crypto.randomUUID()},precondition(guard))];
    if(delta<0)for(const d of rows.slice(0,-delta))writes.push(db.write(docPath(storeId,d.id),{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}));
    if(delta>0)for(let i=0;i<delta;i++) {
      const id=crypto.randomUUID();writes.push(db.write(docPath(storeId,id),{id,storeId,sellerId:Number(sellerId),departmentId:sellerDepartmentId(sellerBy(c.data,sellerId,storeId)),serviceId:Number(serviceId),createdAt:new Date().toISOString(),businessDate:today(),deletedAt:null,source:'adjustment',clientId:'',ownerUid:await sellerUid(storeId,Number(sellerId)),generation},{exists:false}));
    }
    try{await db.commit(writes);}catch(e){if(conflict(e))fail(409,'Les ventes ont changé pendant la correction. Réessayez.');throw e;}
    return {ok:true};
  }
  // Historique administrateur : une page est filtrée sur la date commerciale
  // puis sur le vendeur. Le curseur suit les documents lus, même lorsque la
  // page ne contient aucune vente de ce vendeur.
  async function adminSalesHistory(db,selection) {
    const {storeId,sellerId,period,anchor,afterDate='',afterId=''}=selection;
    const range=saleHistoryRange(period,anchor,today());
    if(!range||!isId(sellerId)||!STORE_ID.test(storeId||'')||
       (!!afterDate!==!!afterId)||(afterDate&&(!saleHistoryRange('day',afterDate,afterDate)||afterDate<range.start||afterDate>range.end||!SALE_DOC_ID.test(afterId))))
      fail(400,'Choisissez un magasin, un vendeur et une période valides.');
    const c=await catalog(db),person=c.data.sellers.find(s=>Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId&&!s.deletingJob);
    if(!validStore(c.data,storeId)||!person)fail(400,'Choisissez un vendeur de ce magasin.');
    const collection=`pulseStores/${storeId}/sales`,pageSize=200;
    const [marker,rows]=await Promise.all([
      db.get(salesMarkerPath(storeId)),
      db.salesPeriodPage(collection,{...range,limit:pageSize,afterDate,afterId}),
    ]);
    const generation=salesGeneration(marker?.data);
    const sales=rows.filter(row=>SALE_DOC_ID.test(row.id)&&Number(row.data.sellerId)===Number(sellerId)&&
      (!row.data.storeId||row.data.storeId===storeId)&&!row.data.deletedAt&&
      !serviceRemovedForStore(c.data,storeId,row.data.serviceId)&&saleInGeneration(row.data,generation))
      .map(row=>({id:row.id,serviceId:Number(row.data.serviceId),businessDate:row.data.businessDate,
        createdAt:row.data.createdAt||'',departmentId:saleDepartmentId(row.data),source:row.data.source==='adjustment'?'adjustment':'sale'}));
    const last=rows.at(-1);
    if(last&&!SALE_DOC_ID.test(last.id))fail(409,'Une vente de cet historique nécessite une vérification.');
    return {sales,next:rows.length===pageSize?{date:last.data.businessDate,id:last.id}:null,range};
  }
  // Ajout administratif d'une ou plusieurs ventes à une date précise. Aucun
  // message FCM/outbox n'est créé : il s'agit d'une correction, pas d'une vente
  // en direct. Le marqueur privé rend une réponse perdue sans double ajout.
  async function addAdminSales(db,body) {
    const {storeId,sellerId,period,anchor,saleDate,serviceId,departmentId,quantity,requestId,confirmation,
      expectedSellerName,expectedStoreName,expectedServiceName,expectedDepartmentName}=body;
    const currentDate=today();
    if(typeof storeId!=='string'||!STORE_ID.test(storeId)||!isId(sellerId)||!isId(serviceId)||typeof departmentId!=='string'||!STORE_ID.test(departmentId)||
       !validAdditionDate(period,anchor,saleDate,currentDate)||!Number.isInteger(quantity)||quantity<1||quantity>MAX_SALE_CORRECTION||
       typeof requestId!=='string'||!SAFE_ID.test(requestId)||confirmation!==SALE_ADDITION_CONFIRMATION||
       [expectedSellerName,expectedStoreName,expectedServiceName,expectedDepartmentName].some(name=>typeof name!=='string'||!name))
      fail(400,'Vérifiez la date, le service, le département, la quantité et la confirmation.');
    const fingerprint=await digestBase64(saleAdditionFingerprintInput({storeId,sellerId,period,anchor,saleDate,serviceId,departmentId,quantity}));
    const requestPath=`pulseSalesCorrectionAdds/${requestId}`;
    const [request,c,marker,guard,reset,sellerDeletion,serviceDeletion]=await Promise.all([
      db.get(requestPath),catalog(db),db.get(salesMarkerPath(storeId)),db.get(guardPath(storeId)),
      db.get(salesResetPath(storeId)),db.get(sellerDeletePath(storeId)),db.get(serviceDeletePath(storeId)),
    ]);
    if(request) {
      if(request.data.fingerprint!==fingerprint)fail(409,'Cet identifiant de correction a déjà été utilisé.');
      return {ok:true,added:Number(request.data.count)||quantity,duplicate:true};
    }
    // Les anciens marqueurs restent rejouables sans rien écrire, mais une
    // nouvelle correction concerne uniquement le jour précisément sélectionné.
    if(period!=='day'||saleDate!==anchor)fail(400,'Choisissez une seule journée pour cette correction.');
    const person=c.data.sellers.find(s=>Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId&&!s.deletingJob);
    const store=c.data.stores.find(s=>s.id===storeId),service=c.data.services.find(s=>Number(s.id)===Number(serviceId));
    const department=departmentsForStore(c.data,storeId,{activeOnly:false}).find(d=>d.id===departmentId);
    if(!validStore(c.data,storeId)||!person||!service||serviceRemovedForStore(c.data,storeId,serviceId)||!department||
       sellerDepartmentId(person)!==departmentId||person.name!==expectedSellerName||store?.name!==expectedStoreName||service.name!==expectedServiceName||department.name!==expectedDepartmentName)
      fail(409,'Le vendeur, le service, le département ou le magasin a changé. Vérifiez votre sélection.');
    if(reset?.data.status==='running'||sellerDeletion?.data.status==='running'||serviceDeletion?.data.status==='running')
      fail(409,'Une suppression ou réinitialisation est en cours dans ce magasin. Attendez sa fin.');
    const generation=salesGeneration(marker?.data),createdAt=new Date().toISOString(),ownerUid=await sellerUid(storeId,Number(sellerId));
    const writes=[db.verify('pulse/catalog',precondition(c)),db.verify(salesMarkerPath(storeId),precondition(marker)),
      db.verify(salesResetPath(storeId),precondition(reset)),db.verify(sellerDeletePath(storeId),precondition(sellerDeletion)),
      db.verify(serviceDeletePath(storeId),precondition(serviceDeletion)),db.write(guardPath(storeId),{revision:crypto.randomUUID()},precondition(guard))];
    for(let i=0;i<quantity;i++) {
      const id=crypto.randomUUID();
      writes.push(db.write(docPath(storeId,id),{id,storeId,sellerId:Number(sellerId),departmentId,serviceId:Number(serviceId),
        createdAt,businessDate:saleDate,deletedAt:null,source:'adjustment',clientId:'',ownerUid,generation},{exists:false}));
    }
    writes.push(db.write(requestPath,{fingerprint,count:quantity,createdAt:Date.now()},{exists:false}));
    try {await db.commit(writes);}
    catch(error) {
      if(!conflict(error))throw error;
      const existing=await db.get(requestPath);
      if(existing?.data.fingerprint===fingerprint)return {ok:true,added:Number(existing.data.count)||quantity,duplicate:true};
      fail(409,'Les ventes ou le magasin ont changé. Rechargez la liste avant de recommencer.');
    }
    return {ok:true,added:quantity,duplicate:false};
  }
  // La confirmation, l'ensemble précis des identifiants et son empreinte sont
  // vérifiés avant une écriture atomique. Une réponse perdue peut être rejouée
  // sans répéter la correction ni effacer d'autres ventes.
  async function correctAdminSales(db,body) {
    const {storeId,sellerId,period,anchor,saleIds,requestId,confirmation,expectedSellerName,expectedStoreName}=body;
    const currentDate=today(),range=saleHistoryRange(period,anchor,currentDate);
    if(!range||!STORE_ID.test(storeId||'')||!isId(sellerId)||!SAFE_ID.test(requestId||'')||
       confirmation!==SALE_CORRECTION_CONFIRMATION||typeof expectedSellerName!=='string'||typeof expectedStoreName!=='string'||
       !Array.isArray(saleIds)||!saleIds.length||saleIds.length>MAX_SALE_CORRECTION||
       saleIds.some(id=>typeof id!=='string'||!SALE_DOC_ID.test(id))||new Set(saleIds).size!==saleIds.length)
      fail(400,'Confirmation ou sélection de ventes invalide.');
    const fingerprint=await digestBase64(saleCorrectionFingerprintInput({storeId,sellerId,period,anchor,saleIds}));
    const requestPath=`pulseSalesCorrections/${requestId}`,paths=saleIds.map(id=>docPath(storeId,id));
    const [request,c,marker,guard,reset,sellerDeletion,serviceDeletion,sales,outboxes]=await Promise.all([
      db.get(requestPath),catalog(db),db.get(salesMarkerPath(storeId)),db.get(guardPath(storeId)),
      db.get(salesResetPath(storeId)),db.get(sellerDeletePath(storeId)),db.get(serviceDeletePath(storeId)),
      db.getMany(paths),db.getMany(saleIds.map(id=>`pulseOutbox/${id}`)),
    ]);
    if(request) {
      if(request.data.fingerprint!==fingerprint)fail(409,'Cet identifiant de correction a déjà été utilisé.');
      return {ok:true,deleted:Number(request.data.count)||saleIds.length,duplicate:true};
    }
    if(period!=='day')fail(400,'Choisissez une seule journée pour cette correction.');
    const person=c.data.sellers.find(s=>Number(s.id)===Number(sellerId)&&sellerStoreId(s)===storeId&&!s.deletingJob);
    const store=c.data.stores.find(s=>s.id===storeId);
    if(!validStore(c.data,storeId)||!person||person.name!==expectedSellerName||store?.name!==expectedStoreName)
      fail(409,'Le vendeur ou le magasin a changé. Vérifiez votre sélection.');
    if(reset?.data.status==='running'||sellerDeletion?.data.status==='running'||serviceDeletion?.data.status==='running')
      fail(409,'Une suppression ou réinitialisation est en cours dans ce magasin. Attendez sa fin.');
    const generation=salesGeneration(marker?.data);
    if(sales.some(s=>!s||s.data.deletedAt||Number(s.data.sellerId)!==Number(sellerId)||
      (s.data.storeId&&s.data.storeId!==storeId)||!saleHistoryRange('day',s.data.businessDate,currentDate)||
      s.data.businessDate<range.start||s.data.businessDate>range.end||!isId(s.data.serviceId)||
      serviceRemovedForStore(c.data,storeId,s.data.serviceId)||!saleInGeneration(s.data,generation)))
      fail(409,'Une vente sélectionnée a changé ou n’appartient plus à cette période. Rechargez la liste.');
    const writes=[db.verify('pulse/catalog',precondition(c)),db.verify(salesMarkerPath(storeId),precondition(marker)),
      db.verify(salesResetPath(storeId),precondition(reset)),db.verify(sellerDeletePath(storeId),precondition(sellerDeletion)),
      db.verify(serviceDeletePath(storeId),precondition(serviceDeletion)),db.write(guardPath(storeId),{revision:crypto.randomUUID()},precondition(guard))];
    const deletedAt=new Date().toISOString();
    for(let i=0;i<sales.length;i++) {
      writes.push(db.write(paths[i],{...sales[i].data,deletedAt},precondition(sales[i])));
      const outbox=outboxes[i];
      if(outbox?.data.storeId===storeId&&outbox.data.saleId===saleIds[i])
        writes.push(db.write(`pulseOutbox/${saleIds[i]}`,{status:'reset'},precondition(outbox)));
    }
    // Aucune identité ni liste de ventes dans ce journal privé d'idempotence.
    writes.push(db.write(requestPath,{fingerprint,count:saleIds.length,createdAt:Date.now()},{exists:false}));
    try {await db.commit(writes);}
    catch(e) {
      if(!conflict(e))throw e;
      const existing=await db.get(requestPath);
      if(existing?.data.fingerprint===fingerprint)return {ok:true,deleted:Number(existing.data.count)||saleIds.length,duplicate:true};
      fail(409,'Les ventes ou le magasin ont changé. Rechargez la liste avant de recommencer.');
    }
    return {ok:true,deleted:saleIds.length};
  }
  async function tokenSubscribe(req,env,db,body,method) {
    const s=await seller(req,env,db),token=body.token;
    if(typeof token!=='string'||token.length<20||token.length>4096||/[\s]/.test(token))fail(400,'Jeton de notification invalide.');
    const id=await digestBase64(token),path=`pulseTokens/${id}`,existing=await db.get(path);
    if(method==='DELETE') {
      if(existing&&existing.data.uid===s.claims.sub)try{await db.commit([...saleAuthorizationChecks(db,s),db.delete(path,{updateTime:existing.updateTime})]);}catch(e){if(!conflict(e))throw e;}
    } else {
      if(!existing||existing.data.storeId!==s.claims.storeId) {
        const count=await db.query('pulseTokens','storeId','EQUAL',s.claims.storeId,1001);
        if(count.length>=1000)fail(409,'Nombre maximal d’appareils atteint pour ce magasin.');
      }
      try {
        await db.commit([...saleAuthorizationChecks(db,s),db.write(path,{token,uid:s.claims.sub,storeId:s.claims.storeId,accessVersion:s.claims.accessVersion,updatedAt:Date.now()},precondition(existing))]);
      } catch(e) {if(conflict(e))fail(409,'Accès ou appareil modifié simultanément. Réessayez.');throw e;}
    }
    return {ok:true};
  }
  async function dispatch(env,db,id) {
    if(!env.PULSE_QUEUE)return;
    const path=`pulseOutbox/${id}`,item=await db.get(path),now=Date.now();
    if(!item||item.data.status==='reset'||item.data.status==='queued'||(item.data.status==='dispatching'&&item.data.leaseUntil>now))return;
    const marker=await db.get(salesMarkerPath(item.data.storeId));
    if(!saleInGeneration(item.data,salesGeneration(marker?.data))) {
      try{await db.commit([db.write(path,{status:'reset'},precondition(item))]);}catch(e){if(!conflict(e))throw e;}
      return;
    }
    if(now-item.data.createdAt>60*60*1000) {await db.commit([db.write(path,{...item.data,status:'expired'},precondition(item))]);return;}
    const claim={...item.data,status:'dispatching',leaseUntil:now+120000};
    try{await db.commit([db.write(path,claim,precondition(item))]);}catch(e){if(conflict(e))return;throw e;}
    try {
      const tokens=await db.query('pulseTokens','storeId','EQUAL',item.data.storeId,1001);
      if(tokens.length>1000)throw new Error('Trop d’appareils pour ce magasin');
      // Ne mettre en file que les appareils du département concerné. Les accès
      // sont lus par lots pour rester sous les limites de sous-requêtes du Worker.
      const paths=[...new Set(tokens.map(t=>`pulseAccess/${t.data.uid}`))];
      // Relire la vente et l'outbox après la prise du bail : une correction a
      // pu intervenir pendant le chargement des appareils. Les anciens messages
      // sans sellerId retrouvent aussi leur auteur dans la vente.
      const [c,accesses,originSale,currentOutbox]=await Promise.all([
        catalog(db),db.getMany?db.getMany(paths):Promise.all(paths.map(p=>db.get(p))),
        db.get(docPath(item.data.storeId,id)),db.get(path),
      ]);
      if(currentOutbox?.data.status!=='dispatching'||currentOutbox.data.leaseUntil!==claim.leaseUntil)return;
      if(!originSale||originSale.data.deletedAt) {
        try{await db.commit([db.write(path,{status:'reset'},precondition(currentOutbox))]);}catch(e){if(!conflict(e))throw e;}
        return;
      }
      const authorId=isId(item.data.sellerId)?Number(item.data.sellerId):Number(originSale.data.sellerId);
      const byPath=new Map(paths.map((p,i)=>[p,accesses[i]?.data]));
      const eligible=tokens.filter(t=>{
        const a=byPath.get(`pulseAccess/${t.data.uid}`),recipient=a&&sellerBy(c.data,a.sellerId,item.data.storeId);
        return isId(authorId)&&Number(a?.sellerId)!==authorId&&t.id!==item.data.originTokenId&&
          a?.active&&a.version===t.data.accessVersion&&a.storeId===item.data.storeId&&recipient&&validStore(c.data,item.data.storeId)&&
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
    if(msg.body?.kind==='service-delete') {
      const {storeId,jobId}=msg.body;
      if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)){msg.ack();return;}
      try {
        const result=await processServiceDelete(db,storeId,jobId);
        if(result.conflict){msg.retry({delaySeconds:3});return;}
        if(result.running)await enqueueServiceDelete(env,storeId,jobId);
        msg.ack();
      } catch(e){console.warn('PULSE_SERVICE_DELETE',e?.code||e?.name||'error');msg.retry();}
      return;
    }
    if(msg.body?.kind==='seller-delete') {
      const {storeId,jobId}=msg.body;
      if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)){msg.ack();return;}
      try {
        const result=await processSellerDelete(db,storeId,jobId);
        if(result.conflict){msg.retry({delaySeconds:3});return;}
        if(result.running)await enqueueSellerDelete(env,storeId,jobId);
        msg.ack();
      } catch(e){console.warn('PULSE_SELLER_DELETE',e?.code||e?.name||'error');msg.retry();}
      return;
    }
    if(msg.body?.kind==='goals-reset') {
      const {storeId,jobId}=msg.body;
      if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)){msg.ack();return;}
      try {
        const result=await processGoalsReset(db,storeId,jobId);
        if(result.conflict){msg.retry({delaySeconds:3});return;}
        if(result.running)await enqueueGoalsReset(env,storeId,jobId);
        msg.ack();
      } catch(e){console.warn('PULSE_GOALS_RESET',e?.code||e?.name||'error');msg.retry();}
      return;
    }
    if(msg.body?.kind==='sales-reset') {
      const {storeId,jobId}=msg.body;
      if(typeof storeId!=='string'||!STORE_ID.test(storeId)||typeof jobId!=='string'||!SAFE_ID.test(jobId)){msg.ack();return;}
      try {
        const result=await processSalesReset(db,storeId,jobId);
        if(result.conflict){msg.retry({delaySeconds:3});return;}
        if(result.running)await enqueueSalesReset(env,storeId,jobId);
        msg.ack();
      } catch(e){console.warn('PULSE_SALES_RESET',e?.code||e?.name||'error');msg.retry();}
      return;
    }
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
      const [tokenDoc,outbox,marker,originSale]=await Promise.all([db.get(`pulseTokens/${tokenId}`),db.get(`pulseOutbox/${saleId}`),db.get(salesMarkerPath(storeId)),db.get(docPath(storeId,saleId))]);
      if(!tokenDoc||!outbox||!originSale||originSale.data.deletedAt||outbox.data.status==='reset'||
         tokenDoc.data.storeId!==storeId||outbox.data.storeId!==storeId||
         !saleInGeneration(outbox.data,salesGeneration(marker?.data))||!saleInGeneration(originSale.data,salesGeneration(marker?.data))||
         Date.now()-outbox.data.createdAt>60*60*1000) {await skip();return;}
      stage='authorize';
      const [a,c]=await Promise.all([db.get(`pulseAccess/${tokenDoc.data.uid}`),catalog(db)]);
      const recipient=a?.data&&sellerBy(c.data,a.data.sellerId,storeId);
      const author=originSale&&c.data.sellers.find(s=>Number(s.id)===Number(originSale.data.sellerId)&&sellerStoreId(s)===storeId);
      // Revérifier au dernier moment, notamment pour les messages déjà en file
      // avant cette mise à jour ou les abonnements réaffectés entre-temps.
      if(!originSale||!author||author.deletingJob||serviceRemovedForStore(c.data,storeId,originSale.data.serviceId)||!a?.data.active||a.data.version!==tokenDoc.data.accessVersion||a.data.storeId!==storeId||!recipient||!validStore(c.data,storeId)||
         Number(a.data.sellerId)===Number(originSale.data.sellerId)||tokenId===outbox.data.originTokenId||
         sellerDepartmentId(recipient)!==saleDepartmentId(outbox.data)){await skip();return;}
      // Réduire la fenêtre entre une correction et l'appel FCM. Un message
      // déjà remis à FCM ne peut toutefois pas être rappelé par la PWA.
      const [latestSale,latestOutbox,latestMarker]=await db.getMany([docPath(storeId,saleId),`pulseOutbox/${saleId}`,salesMarkerPath(storeId)]);
      const latestGeneration=salesGeneration(latestMarker?.data);
      if(!latestSale||latestSale.data.deletedAt||!latestOutbox||latestOutbox.data.status==='reset'||latestOutbox.data.storeId!==storeId||
         !saleInGeneration(latestSale.data,latestGeneration)||!saleInGeneration(latestOutbox.data,latestGeneration)) {await skip();return;}
      stage='fcm';await send(env,tokenDoc.data.token,latestOutbox.data);
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
    // Compatibilité avec les PWA précédentes : aucune migration ou révocation globale.
    if(method==='POST'&&path==='/api/auth/initialize')return {ok:true};
    if(method==='POST'&&path==='/api/auth/status')return pinStatus(db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/claim')return claimPin(env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/register')return registerSeller(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/pin/change')return changeLegacyPin(env,db,await readBody(req));
    if(method==='POST'&&(path==='/api/auth/activate'||path==='/api/auth/personal-pin'))fail(409,'Mettez Fnac Pulse à jour en la fermant puis en la rouvrant.');
    if((method==='GET'||method==='POST')&&path==='/api/goals') {
      const s=await seller(req,env,db);
      const owner={uid:s.claims.sub,storeId:s.claims.storeId,sellerId:Number(s.claims.sellerId),catalog:s.catalog,catalogDoc:s.catalogDoc};
      const selection=method==='GET'?Object.fromEntries(url.searchParams):await readBody(req);
      // Le jeton reste la source de vérité ; refuser une ancienne sélection si
      // l'identité du navigateur change pendant qu'une requête est en cours.
      if((Object.hasOwn(selection,'storeId')&&selection.storeId!==owner.storeId)||
         (Object.hasOwn(selection,'sellerId')&&Number(selection.sellerId)!==owner.sellerId))fail(403,'Votre profil a changé. Reconnectez-vous.');
      return method==='GET'?readGoals(db,owner):saveGoals(db,owner,selection,{sellerVersion:s.claims.accessVersion});
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
    if(method==='POST'&&path==='/api/auth/admin-invitations/accept')return acceptAdministratorInvitation(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/admin-access/check')return checkManualAdminRequest(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/admin-access/claim')return claimManualAdminRequest(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/admin-access/status')return manualAdminRequestStatus(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/admin-account-status')return administratorAccountStatus(req,env,db);
    if(method==='POST'&&path==='/api/auth/admin-code/prepare')return prepareAdminCode(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/auth/admin-code/complete')return completeAdminCode(req,env,db,await readBody(req));
    if(path.startsWith('/api/admin/')) {
      const administrator=await admin(req,env,db);
      if(method==='GET'&&path==='/api/admin/access-requests')return listManualAdminRequests(db,url.searchParams.get('after')||'');
      if(method==='POST'&&path==='/api/admin/access-requests')return addManualAdminRequest(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/access-requests/approve')return decideManualAdminRequest(env,db,administrator,await readBody(req),true);
      if(method==='POST'&&path==='/api/admin/access-requests/cancel')return decideManualAdminRequest(env,db,administrator,await readBody(req),false);
      if(method==='POST'&&path==='/api/admin/old-test/inspect')return inspectOldTestAccount(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/old-test/revoke')return revokeOldTestAccount(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/old-test/authorize-delete')return authorizeOldTestDeletion(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/enrollment-code')return issueAdminCode(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/enrollment-code/cancel')return cancelAdminCode(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/direct-account/start')return beginDirectAdministrator(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/direct-account/complete')return completeDirectAdministrator(env,db,administrator,await readBody(req));
      if(method==='GET'&&path==='/api/admin/invitations')return listEmailInvitations(db,url.searchParams.get('after')||'');
      if(method==='POST'&&path==='/api/admin/invitations')return inviteAdministrator(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/invitations/cancel')return cancelEmailInvitation(env,db,administrator,await readBody(req));
      if(method==='POST'&&path==='/api/admin/administrators')return grantAdministrator(env,db,administrator,await readBody(req));
      if(method==='GET'&&path==='/api/admin/all'){const d=(await catalog(db)).data;return {sellers:d.sellers,services:d.services,serviceOrders:d.serviceOrders||{},serviceRemovalsByStore:d.serviceRemovalsByStore||{},departmentsByStore:d.departmentsByStore||{},directorySync:d.directorySync||null};}
      if(method==='POST'&&path==='/api/admin/stores/sync')return refreshDirectory(db);
      if(method==='POST'&&path==='/api/admin/stores/import')return importDirectoryCopy(db,await readBody(req,131072));
      const department=path.match(/^\/api\/admin\/departments(?:\/([A-Za-z0-9_-]+))?$/);
      if(department&&((method==='POST'&&!department[1])||(method==='PATCH'&&department[1])))return mutateDepartment(db,department[1],await readBody(req),method);
      if(method==='POST'&&path==='/api/admin/pin-reset')return resetPin(db,await readBody(req));
      if(method==='GET'&&path==='/api/admin/sellers/delete')return readSellerDelete(db,url.searchParams.get('storeId'));
      if(method==='POST'&&path==='/api/admin/sellers/delete')return startSellerDelete(db,env,await readBody(req));
      if(method==='GET'&&path==='/api/admin/services/delete')return readServiceDelete(db,url.searchParams.get('storeId'));
      if(method==='POST'&&path==='/api/admin/services/delete')return startServiceDelete(db,env,await readBody(req));
      if(method==='POST'&&path==='/api/admin/services/restore')return restoreStoreService(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/pin-activation')fail(409,'Mettez Fnac Pulse à jour en la fermant puis en la rouvrant.');
      if(method==='GET'&&path==='/api/admin/goals/reset')return readGoalsReset(db,url.searchParams.get('storeId'));
      if(method==='POST'&&path==='/api/admin/goals/reset')return startGoalsReset(db,env,await readBody(req));
      if(method==='GET'&&path==='/api/admin/goals')return readGoals(db,await goalOwner(db,url.searchParams.get('storeId'),url.searchParams.get('sellerId')));
      if(method==='POST'&&path==='/api/admin/goals') {
        const body=await readBody(req), owner=await goalOwner(db,body.storeId,body.sellerId);
        return saveGoals(db,owner,body,{admin:true});
      }
      if(method==='POST'&&path==='/api/admin/workdays') {
        const body=await readBody(req), owner=await goalOwner(db,body.storeId,body.sellerId);
        return saveWorkdays(db,owner,body);
      }
      if(method==='POST'&&path==='/api/admin/services/order')return saveServiceOrder(db,await readBody(req));
      if(method==='GET'&&path==='/api/admin/sales/reset')return readSalesReset(db,url.searchParams.get('storeId'));
      if(method==='POST'&&path==='/api/admin/sales/reset')return startSalesReset(db,env,await readBody(req));
      if(method==='GET'&&path==='/api/admin/sales/history')return adminSalesHistory(db,Object.fromEntries(url.searchParams));
      if(method==='POST'&&path==='/api/admin/sales/add-correction')return addAdminSales(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/sales/correct')return correctAdminSales(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/stores')return addStore(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/adjust')return adjust(db,await readBody(req));
      const entity=path.match(/^\/api\/admin\/entities\/(sellers|services)(?:\/(\d+))?$/);
      if(entity&&((method==='POST'&&!entity[2])||(method==='PATCH'&&entity[2])))return mutateCatalog(db,entity[1],entity[2],await readBody(req),method);
      if(method==='GET'&&path==='/api/admin/counts') {
        const storeId=url.searchParams.get('storeId'),sellerId=Number(url.searchParams.get('sellerId')),c=(await catalog(db)).data;
        if(!validStore(c,storeId)||!sellerBy(c,sellerId,storeId))fail(400,'Sélection invalide.');
        const counts=new Map();for(const x of await findToday(db,storeId))if(x.data.sellerId===sellerId&&!x.data.deletedAt&&!serviceRemovedForStore(c,storeId,x.data.serviceId))counts.set(x.data.serviceId,(counts.get(x.data.serviceId)||0)+1);
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
      if(event.cron==='0 6 * * 1') {
        ctx.waitUntil(refreshDirectory(db).catch(e=>console.warn('PULSE_DIRECTORY_SYNC',e?.code||e?.name||'error')));
        return;
      }
      ctx.waitUntil((async()=>{
        // Une opération commencée survit à la fermeture du téléphone et aux
        // messages de file perdus. Le traitement reste borné par invocation.
        if(env.PULSE_QUEUE?.sendBatch)try {
          const resets=await db.query('pulseSalesResets','status','EQUAL','running',10);
          if(resets.length)await env.PULSE_QUEUE.sendBatch(resets.map(job=>({body:{kind:'sales-reset',storeId:job.id,jobId:job.data.jobId}})));
        } catch(e){console.warn('PULSE_SALES_RESET_RECOVERY',e?.code||e?.name||'error');}
        if(env.PULSE_QUEUE?.sendBatch)try {
          const resets=await db.query('pulseGoalsResets','status','EQUAL','running',10);
          if(resets.length)await env.PULSE_QUEUE.sendBatch(resets.map(job=>({body:{kind:'goals-reset',storeId:job.id,jobId:job.data.jobId}})));
        } catch(e){console.warn('PULSE_GOALS_RESET_RECOVERY',e?.code||e?.name||'error');}
        if(env.PULSE_QUEUE?.sendBatch)try {
          const jobs=await db.query('pulseSellerDeletes','status','EQUAL','running',10);
          if(jobs.length)await env.PULSE_QUEUE.sendBatch(jobs.map(job=>({body:{kind:'seller-delete',storeId:job.id,jobId:job.data.jobId}})));
        } catch(e){console.warn('PULSE_SELLER_DELETE_RECOVERY',e?.code||e?.name||'error');}
        if(env.PULSE_QUEUE?.sendBatch)try {
          const jobs=await db.query('pulseServiceDeletes','status','EQUAL','running',10);
          if(jobs.length)await env.PULSE_QUEUE.sendBatch(jobs.map(job=>({body:{kind:'service-delete',storeId:job.id,jobId:job.data.jobId}})));
        } catch(e){console.warn('PULSE_SERVICE_DELETE_RECOVERY',e?.code||e?.name||'error');}
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
