import { importPKCS8, SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const enc = new TextEncoder();
let accessCache = null;
let signingKeyCache = null;

function accountFrom(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error('GOOGLE_SERVICE_ACCOUNT manquant');
  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  if (account.project_id !== env.FIREBASE_PROJECT_ID || !account.client_email || !account.private_key) throw new Error('Compte de service invalide ou mauvais projet');
  return account;
}
async function signingKey(account) {
  if (!signingKeyCache || signingKeyCache.pem !== account.private_key) {
    signingKeyCache = {pem:account.private_key, key:await importPKCS8(account.private_key,'RS256')};
  }
  return signingKeyCache.key;
}
export async function googleAccessToken(env) {
  const account = accountFrom(env);
  if (accessCache?.email === account.client_email && accessCache.until > Date.now()+120000) return accessCache.token;
  const assertion = await new SignJWT({scope:'https://www.googleapis.com/auth/cloud-platform'})
    .setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(account.client_email).setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(await signingKey(account));
  const result = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  });
  const json=await result.json();
  if (!result.ok || !json.access_token) throw new Error('Authentification du compte de service impossible');
  accessCache={email:account.client_email,token:json.access_token,until:Date.now()+Number(json.expires_in||3600)*1000};
  return accessCache.token;
}
export async function makeCustomToken(env,uid,claims) {
  const account=accountFrom(env);
  return new SignJWT({uid,claims}).setProtectedHeader({alg:'RS256',typ:'JWT'})
    .setIssuer(account.client_email).setSubject(account.client_email)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt().setExpirationTime('1h').sign(await signingKey(account));
}
export async function verifyIdToken(env,token) {
  const project=env.FIREBASE_PROJECT_ID;
  const {payload} = await jwtVerify(token,GOOGLE_KEYS,{
    issuer:`https://securetoken.google.com/${project}`,audience:project,algorithms:['RS256'],clockTolerance:10,
  });
  if (!payload.sub || payload.sub.length>128 || !Number.isFinite(payload.auth_time) || payload.auth_time>Math.floor(Date.now()/1000)+10) throw new Error('Jeton Firebase invalide');
  return payload;
}
export async function digestBase64(text) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)));
  return toBase64Url(bytes);
}
export function toBase64Url(bytes) {
  let s=''; for (const b of bytes) s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64Url(str) {
  const text=atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}
async function pinKey(env) {
  if (!/^[A-Za-z0-9_-]{43,}$/.test(env.PIN_PEPPER||'')) throw new Error('PIN_PEPPER manquant ou trop court');
  const pepper=fromBase64Url(env.PIN_PEPPER);
  if (pepper.length < 32) throw new Error('PIN_PEPPER trop court');
  return crypto.subtle.importKey('raw',pepper,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function pinMac(env,uid,proof) {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC',await pinKey(env),enc.encode(`${uid}:${proof}`))));
}
export async function verifyPin(env,uid,proof,mac) {
  try {return await crypto.subtle.verify('HMAC',await pinKey(env),fromBase64Url(mac),enc.encode(`${uid}:${proof}`));} catch {return false;}
}

function encodeValue(value) {
  if (value === null || value === undefined) return {nullValue:null};
  if (typeof value === 'string') return {stringValue:value};
  if (typeof value === 'boolean') return {booleanValue:value};
  if (typeof value === 'number') return Number.isSafeInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(encodeValue)}};
  return {mapValue:{fields:encodeFields(value)}};
}
function encodeFields(data) {return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encodeValue(value)]));}
function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values||[]).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields||{});
  return null;
}
function decodeFields(fields) {return Object.fromEntries(Object.entries(fields||{}).map(([key,value])=>[key,decodeValue(value)]));}
function readDocument(doc) {return {data:decodeFields(doc.fields||{}),name:doc.name,id:doc.name.split('/').pop(),updateTime:doc.updateTime};}
export class FirebaseError extends Error {
  constructor(status,detail) {super(detail?.error?.message || `Firebase HTTP ${status}`);this.status=status;this.code=detail?.error?.status||'';}
}
export class FirestoreRest {
  constructor(env, options={}) {
    this.env=env;this.project=env.FIREBASE_PROJECT_ID;
    this.root=`projects/${this.project}/databases/(default)/documents`;
    this.base=options.base || 'https://firestore.googleapis.com/v1';
    this.token=options.token || (()=>googleAccessToken(env));
  }
  name(path) {return `${this.root}/${path}`;}
  async request(path,{method='GET',body}={}) {
    const resp=await fetch(`${this.base}/${this.root}${path}`,{
      method,headers:{Authorization:`Bearer ${await this.token()}`,...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    let json={};try{json=await resp.json();}catch{}
    if (!resp.ok) throw new FirebaseError(resp.status,json);
    return json;
  }
  async get(path) {
    try {return readDocument(await this.request('/'+path.split('/').map(encodeURIComponent).join('/')));}
    catch(e) {if(e.status===404)return null;throw e;}
  }
  // BatchGet réduit les sous-requêtes Worker tout en gardant les documents privés
  // côté serveur. Firestore peut renvoyer les documents dans un ordre différent.
  async getMany(paths) {
    const found=new Map();
    for(let i=0;i<paths.length;i+=100) {
      const names=paths.slice(i,i+100).map(path=>this.name(path));
      const rows=await this.request(':batchGet',{method:'POST',body:{documents:names}});
      if(!Array.isArray(rows))throw new Error('Réponse BatchGet Firestore invalide');
      for(const row of rows)if(row.found)found.set(row.found.name,readDocument(row.found));
    }
    return paths.map(path=>found.get(this.name(path))||null);
  }
  async query(collectionPath, field, op, value, limit=1000) {
    const parts=collectionPath.split('/'),collection=parts.pop();
    const parent=parts.length?'/'+parts.map(encodeURIComponent).join('/'):'';
    const structuredQuery={from:[{collectionId:collection}],limit};
    if (field) structuredQuery.where={fieldFilter:{field:{fieldPath:field},op,value:encodeValue(value)}};
    const rows=await this.request(`${parent}:runQuery`,{method:'POST',body:{structuredQuery}});
    return rows.filter(row=>row.document).map(row=>readDocument(row.document));
  }
  write(path,data,precondition) {
    return {update:{name:this.name(path),fields:encodeFields(data)},...(precondition?{currentDocument:precondition}:{})};
  }
  delete(path,precondition) {return {delete:this.name(path),...(precondition?{currentDocument:precondition}:{})};}
  async commit(writes) {return this.request(':commit',{method:'POST',body:{writes}});}
  async put(path,data,previous) {return this.commit([this.write(path,data,previous?{updateTime:previous.updateTime}:undefined)]);}
}
