import locations from '../server/locations.json' with {type:'json'};
import { FirestoreRest, FirebaseError, googleAccessToken, verifyIdToken, makeCustomToken, digestBase64, pinMac, verifyPin } from './firebase.js';

const SELLERS=['Morgan','Anthony','Cedric','Philippe','Fabien','Florent','Eric','Tamera','Ikram','Selenia','Johan','Alice'];
const SERVICES=[['DMax','play'],['Assu Téléph','phone'],['Assu Multim','devices'],['Garantie','shield'],['FVD','package'],['FNAC +','badge'],['TRC','repeat'],['Reprise','refresh'],['Canal +','tv'],['Free','wifi'],['Autre','other']];
const PROOF=/^[A-Za-z0-9_-]{43}$/;
const SAFE_ID=/^[A-Za-z0-9_-]{8,80}$/;
const STORE_ID=/^[A-Za-z0-9_-]{1,80}$/;
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const cleanName=x=>typeof x==='string'?x.trim().replace(/\s+/g,' ').slice(0,60):'';
const isId=x=>Number.isSafeInteger(Number(x)) && Number(x)>0 && Number(x)<1000000;
const parisDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
const today=()=>parisDate.format(new Date());
const authHeader=req=>req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||'';
const docPath=(store,id)=>`pulseStores/${store}/sales/${id}`;
const guardPath=store=>`pulseStores/${store}/private/revision`;
function freshCatalog() {
  const sellers=SELLERS.map((name,i)=>({id:i+1,name,active:true}));
  const services=SERVICES.map(([name,icon],i)=>({id:i+1,name,icon,active:true}));
  const stores=locations.map(s=>({...s,active:true}));
  return withFlags({sellers,services,stores,nextSellerId:sellers.length+1,nextServiceId:services.length+1});
}
function withFlags(data) {
  return {...data,sellerFlags:Object.fromEntries(data.sellers.map(s=>[`s${s.id}`,!!s.active])),storeFlags:Object.fromEntries(data.stores.map(s=>[s.id,!!s.active]))};
}
const publicCatalog=data=>({
  sellers:data.sellers.filter(s=>s.active).map(({id,name})=>({id,name})),
  services:data.services.filter(s=>s.active).map(({id,name,icon})=>({id,name,icon})),
  stores:data.stores.filter(s=>s.active).map(({active,...s})=>s),today:today(),stats:null,
});
function validStore(data,id) {return typeof id==='string'&&STORE_ID.test(id)&&data.storeFlags[id]===true;}
function sellerBy(data,id) {return isId(id)?data.sellers.find(s=>s.id===Number(id)&&s.active):null;}
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
async function catalog(db) {
  let c=await db.get('pulse/catalog');if(c)return c;
  try {await db.commit([db.write('pulse/catalog',freshCatalog(),{exists:false})]);}
  catch(e){if(!conflict(e))throw e;}
  c=await db.get('pulse/catalog');if(!c)throw new Error('Initialisation du catalogue impossible');return c;
}
async function sellerUid(storeId,sellerId) {return `seller-${(await digestBase64(`${storeId}:${sellerId}`)).slice(0,28)}`;}
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
  const icon=new URL('icons/icon-192.png',appUrl).href;
  const r=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,{
    method:'POST',headers:{Authorization:`Bearer ${access}`,'content-type':'application/json'},
    body:JSON.stringify({message:{token,notification:{title:'Une vente pour l’équipe !',body:`${sale.sellerName} vient de vendre ${sale.serviceName}.`},
      webpush:{headers:{TTL:'3600',Urgency:'normal'},notification:{icon,badge:icon,tag:`sale-${sale.saleId}`},fcm_options:{link:appUrl.href}},
      data:{saleId:sale.saleId,storeId:sale.storeId}}}),
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) {
    const unregistered=r.status===404 || data.error?.details?.some(d=>d.errorCode==='UNREGISTERED');
    const error=new Error('Envoi FCM impossible');error.unregistered=!!unregistered;error.status=r.status;throw error;
  }
}

// Injected dependencies are used only by local tests; the exported production
// worker always uses Firestore, Firebase Auth, Google OAuth and FCM.
export function createWorker(deps={}) {
  const createDb=deps.createDb || (env=>new FirestoreRest(env));
  const verify=deps.verifyIdToken || verifyIdToken;
  const custom=deps.makeCustomToken || makeCustomToken;
  const send=deps.sendFcm || sendFcm;
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
       !validStore(c.data,p.storeId) || !sellerBy(c.data,p.sellerId))fail(403,'Profil désactivé ou code PIN modifié. Reconnectez-vous.');
    return {claims:p,access:a.data,catalog:c.data};
  }
  async function login(req,env,db,body) {
    const {storeId,sellerId,proof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(proof||''))fail(400,'Sélection ou code PIN invalide.');
    const uid=await sellerUid(storeId,Number(sellerId));
    if(!env.LOGIN_LIMITER||!env.PIN_PEPPER)fail(503,'Protection de connexion non configurée.');
    const limit=await env.LOGIN_LIMITER.limit({key:uid});
    if(!limit.success)fail(429,'Trop de tentatives. Réessayez plus tard.');
    const [attempt,a,c]=await Promise.all([db.get(`pulseAttempts/${uid}`),db.get(`pulseAccess/${uid}`),catalog(db)]);
    if(attempt?.data?.lockUntil>Date.now())fail(429,'Trop de tentatives. Réessayez dans 15 minutes.');
    if(!a?.data?.active||!validStore(c.data,storeId)||!sellerBy(c.data,sellerId)||!(await verifyPin(env,uid,proof,a.data.pinMac||''))) {
      await recordFailure(db,uid);fail(401,'Profil ou code PIN incorrect.');
    }
    await clearFailures(db,uid);
    const claims={role:'seller',storeId,sellerId:Number(sellerId),sellerKey:`s${Number(sellerId)}`,accessVersion:a.data.version};
    return {customToken:await custom(env,uid,claims)};
  }
  async function savePin(env,db,body) {
    const {storeId,sellerId,proof}=body;
    if(!STORE_ID.test(storeId||'')||!isId(sellerId)||!PROOF.test(proof||''))fail(400,'Choisissez un magasin, un vendeur et un PIN valide.');
    const c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId))fail(400,'Magasin ou vendeur invalide.');
    const uid=await sellerUid(storeId,Number(sellerId));
    const data={active:true,storeId,sellerId:Number(sellerId),sellerKey:`s${Number(sellerId)}`,version:crypto.randomUUID(),pinMac:await pinMac(env,uid,proof)};
    const {pinMac:_,...status}=data;
    await db.commit([db.write(`pulseAccess/${uid}`,data),db.write(`pulseStatus/${uid}`,status)]);await clearFailures(db,uid);
    return {ok:true};
  }
  async function mutateCatalog(db,kind,id,body,method) {
    const c=await catalog(db), d=structuredClone(c.data), list=d[kind];
    if(!list || !['sellers','services'].includes(kind))fail(404,'Rubrique inconnue.');
    if(method==='POST') {
      const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');
      if(list.length>=200)fail(400,'Nombre maximal atteint.');
      if(list.some(x=>x.active&&x.name.toLocaleLowerCase('fr')===name.toLocaleLowerCase('fr')))fail(409,'Ce nom existe déjà.');
      const next=kind==='sellers'?'nextSellerId':'nextServiceId', newId=d[next]++;
      list.push({id:newId,name,active:true,...(kind==='services'?{icon:'other'}:{})});id=newId;
    } else {
      const row=list.find(x=>x.id===Number(id));if(!row)fail(404,'Élément introuvable.');
      if(typeof body.name==='string') {const name=cleanName(body.name);if(!name)fail(400,'Saisissez un nom valide.');row.name=name;}
      if(typeof body.active==='boolean')row.active=body.active;
      if(row.active&&list.some(x=>x.id!==row.id&&x.active&&x.name.toLocaleLowerCase('fr')===row.name.toLocaleLowerCase('fr')))fail(409,'Ce nom existe déjà.');
    }
    try{await db.commit([db.write('pulse/catalog',withFlags(d),{updateTime:c.updateTime})]);}
    catch(e){if(conflict(e))fail(409,'Une modification simultanée a eu lieu. Réessayez.');throw e;}
    return {id:Number(id),ok:true};
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
  async function addSale(req,env,db,ctx,body) {
    const s=await seller(req,env,db),service=serviceBy(s.catalog,body.serviceId),requestId=body.requestId;
    if(!service||!SAFE_ID.test(requestId||''))fail(400,'Service ou identifiant de vente invalide.');
    const storeId=s.claims.storeId,sellerId=Number(s.claims.sellerId),name=sellerBy(s.catalog,sellerId).name;
    const data={id:requestId,storeId,sellerId,serviceId:service.id,createdAt:new Date().toISOString(),businessDate:today(),deletedAt:null,source:'sale',clientId:typeof body.clientId==='string'?body.clientId.slice(0,80):'',ownerUid:s.claims.sub};
    const outbox={saleId:requestId,storeId,sellerName:name,serviceName:service.name,status:'pending',createdAt:Date.now(),leaseUntil:0};
    try {await db.commit([db.write(docPath(storeId,requestId),data,{exists:false}),db.write(`pulseOutbox/${requestId}`,outbox,{exists:false}),db.write(guardPath(storeId),{revision:crypto.randomUUID()})]);}
    catch(e) {
      if(!conflict(e))throw e;
      const existing=await db.get(docPath(storeId,requestId));
      if(!existing || existing.data.ownerUid!==s.claims.sub || existing.data.serviceId!==service.id)fail(409,'Identifiant de vente déjà utilisé.');
      ctx.waitUntil(dispatch(env,db,requestId).catch(()=>{}));return {id:requestId,duplicate:true};
    }
    ctx.waitUntil(dispatch(env,db,requestId).catch(()=>{}));return {id:requestId};
  }
  async function deleteSale(req,env,db,id) {
    if(!SAFE_ID.test(id||''))fail(400,'Vente invalide.');
    const s=await seller(req,env,db),path=docPath(s.claims.storeId,id),d=await db.get(path);
    if(!d||d.data.ownerUid!==s.claims.sub||d.data.businessDate!==today()||d.data.deletedAt)fail(409,'Cette vente ne peut plus être annulée.');
    try {await db.commit([db.write(path,{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}),db.write(guardPath(s.claims.storeId),{revision:crypto.randomUUID()})]);}
    catch(e){if(conflict(e))fail(409,'Cette vente a déjà été modifiée.');throw e;}
    return {ok:true,id};
  }
  async function removeLatest(req,env,db,body) {
    const s=await seller(req,env,db);if(!serviceBy(s.catalog,body.serviceId))fail(400,'Service invalide.');
    const rows=(await findToday(db,s.claims.storeId)).filter(x=>x.data.ownerUid===s.claims.sub&&x.data.serviceId===Number(body.serviceId)&&!x.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    if(!rows.length)fail(409,'Aucune vente à retirer pour ce service aujourd’hui.');
    return deleteSale(req,env,db,rows[0].id);
  }
  async function adjust(db,body) {
    const {storeId,sellerId,serviceId,count}=body,c=await catalog(db);
    if(!validStore(c.data,storeId)||!sellerBy(c.data,sellerId)||!serviceBy(c.data,serviceId)||!Number.isInteger(count)||count<0||count>100)fail(400,'Choisissez une quantité entre 0 et 100.');
    const guard=await db.get(guardPath(storeId));
    const rows=(await findToday(db,storeId)).filter(d=>d.data.sellerId===Number(sellerId)&&d.data.serviceId===Number(serviceId)&&!d.data.deletedAt)
      .sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||b.id.localeCompare(a.id));
    const delta=count-rows.length;if(Math.abs(delta)>100)fail(400,'Modifiez le total par étapes de 100 maximum.');
    const writes=[db.write(guardPath(storeId),{revision:crypto.randomUUID()},precondition(guard))];
    if(delta<0)for(const d of rows.slice(0,-delta))writes.push(db.write(docPath(storeId,d.id),{...d.data,deletedAt:new Date().toISOString()},{updateTime:d.updateTime}));
    if(delta>0)for(let i=0;i<delta;i++) {
      const id=crypto.randomUUID();writes.push(db.write(docPath(storeId,id),{id,storeId,sellerId:Number(sellerId),serviceId:Number(serviceId),createdAt:new Date().toISOString(),businessDate:today(),deletedAt:null,source:'adjustment',clientId:'',ownerUid:await sellerUid(storeId,Number(sellerId))},{exists:false}));
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
      for(let i=0;i<tokens.length;i+=100)await env.PULSE_QUEUE.sendBatch(tokens.slice(i,i+100).map(t=>({body:{saleId:id,tokenId:t.id,storeId:item.data.storeId}})));
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
    if(prior?.data.status==='sent'){msg.ack();return;}
    if(prior?.data.status==='sending'&&prior.data.leaseUntil>now){msg.retry({delaySeconds:30});return;}
    const claim={status:'sending',leaseUntil:now+60000};
    try{await db.commit([db.write(path,claim,precondition(prior))]);}catch(e){if(conflict(e)){msg.retry({delaySeconds:30});return;}throw e;}
    try {
      const [tokenDoc,outbox]=await Promise.all([db.get(`pulseTokens/${tokenId}`),db.get(`pulseOutbox/${saleId}`)]);
      if(!tokenDoc || !outbox || tokenDoc.data.storeId!==storeId || outbox.data.storeId!==storeId || Date.now()-outbox.data.createdAt>60*60*1000) {msg.ack();return;}
      const [a,c]=await Promise.all([db.get(`pulseAccess/${tokenDoc.data.uid}`),catalog(db)]);
      if(!a?.data.active||a.data.version!==tokenDoc.data.accessVersion||a.data.storeId!==storeId||!sellerBy(c.data,a.data.sellerId)||!validStore(c.data,storeId)){msg.ack();return;}
      await send(env,tokenDoc.data.token,outbox.data);
      const current=await db.get(path);if(current)await db.commit([db.write(path,{status:'sent',leaseUntil:0,sentAt:Date.now()},precondition(current))]);
      msg.ack();
    } catch(e) {
      if(e.unregistered){const t=await db.get(`pulseTokens/${tokenId}`).catch(()=>null);if(t)await db.commit([db.delete(`pulseTokens/${tokenId}`,precondition(t))]).catch(()=>{});msg.ack();return;}
      const current=await db.get(path).catch(()=>null);if(current)await db.commit([db.write(path,{status:'pending',leaseUntil:0},precondition(current))]).catch(()=>{});
      msg.retry();
    }
  }
  async function routes(req,env,ctx) {
    const db=createDb(env),url=new URL(req.url),path=url.pathname,method=req.method;
    if(method==='GET'&&path==='/api/health')return {ok:true};
    if(method==='GET'&&path==='/api/bootstrap')return publicCatalog((await catalog(db)).data);
    if(method==='POST'&&path==='/api/auth/login')return login(req,env,db,await readBody(req));
    if(method==='POST'&&path==='/api/sales')return addSale(req,env,db,ctx,await readBody(req));
    if(method==='POST'&&path==='/api/sales/remove')return removeLatest(req,env,db,await readBody(req));
    const sale=path.match(/^\/api\/sales\/([A-Za-z0-9_-]+)$/);
    if(method==='DELETE'&&sale)return deleteSale(req,env,db,sale[1]);
    if((method==='POST'||method==='DELETE')&&path==='/api/push/subscribe')return tokenSubscribe(req,env,db,await readBody(req),method);
    if(path.startsWith('/api/admin/')) {
      await admin(req,env);
      if(method==='GET'&&path==='/api/admin/all'){const d=(await catalog(db)).data;return {sellers:d.sellers,services:d.services};}
      if(method==='POST'&&path==='/api/admin/pin')return savePin(env,db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/stores')return addStore(db,await readBody(req));
      if(method==='POST'&&path==='/api/admin/adjust')return adjust(db,await readBody(req));
      const entity=path.match(/^\/api\/admin\/entities\/(sellers|services)(?:\/(\d+))?$/);
      if(entity&&((method==='POST'&&!entity[2])||(method==='PATCH'&&entity[2])))return mutateCatalog(db,entity[1],entity[2],await readBody(req),method);
      if(method==='GET'&&path==='/api/admin/counts') {
        const storeId=url.searchParams.get('storeId'),sellerId=Number(url.searchParams.get('sellerId')),c=(await catalog(db)).data;
        if(!validStore(c,storeId)||!isId(sellerId))fail(400,'Sélection invalide.');
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
    async scheduled(_event,env,ctx) {
      const db=createDb(env);
      ctx.waitUntil((async()=>{
        for(const status of ['pending','dispatching']) {
          const jobs=await db.query('pulseOutbox','status','EQUAL',status,1);
          for(const j of jobs)await dispatch(env,db,j.id).catch(()=>{});
        }
      })());
    },
    async queue(batch,env) {const db=createDb(env);for(const msg of batch.messages)await consume(env,db,msg);},
  };
}
export default createWorker();
