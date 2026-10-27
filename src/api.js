import { CLOUD, WORKER_URL, ADMIN_SESSION, vendorToken, adminToken } from './cloud';
export async function api(path, { method = 'GET', body, token, signal } = {}) {
  let destination=path,auth=token||'';
  if(CLOUD) {
    let worker;try{worker=new URL(WORKER_URL);}catch{throw new Error('L’adresse du Worker Cloudflare reste à configurer.');}
    if(worker.protocol!=='https:')throw new Error('Le Worker doit utiliser HTTPS.');
    destination=new URL(path,WORKER_URL+'/').href;
    if(token===ADMIN_SESSION)auth=await adminToken();
    else if(!token && (/^\/api\/(sales|push|goals)/.test(path)))auth=await vendorToken();
    if((token===ADMIN_SESSION||/^\/api\/(sales|push|goals)/.test(path))&&!auth)throw new Error('Session expirée. Reconnectez-vous.');
  }
  const options={
    method,signal,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:`Bearer ${auth}`}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  };
  let response;
  try {response=await fetch(destination,options);}
  catch(error) {
    if(!CLOUD||path!=='/api/sales'||method!=='POST'||!body?.requestId||signal?.aborted)throw error;
    // En cas de réponse perdue, réessayer avec le même identifiant idempotent.
    try {response=await fetch(destination,options);} catch {throw new Error('Connexion interrompue. Vérifiez le bilan avant de réessayer : la vente a peut-être été enregistrée.');}
  }
  let result;try{result=await response.json();}catch{result={};}
  if(!response.ok){const error=new Error(result.error||'Une erreur est survenue. Réessayez.');error.status=response.status;throw error;}
  return result;
}
export function uid() {
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export function dateLabel(iso,options={weekday:'long',day:'numeric',month:'long'}) {
  if(!iso)return '';return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',...options}).format(new Date(`${iso}T12:00:00Z`));
}
export function timeLabel(iso) {return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));}
export function kmBetween(a,b,c,d) {const rad=n=>n*Math.PI/180;const x=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
