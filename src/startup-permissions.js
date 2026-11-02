// L'activation demandée avant la connexion est reliée au profil dès qu'il est
// disponible. Ce marqueur ne contient ni jeton, ni identité, ni position.
export const STARTUP_PUSH_PENDING_KEY='fnac-pulse-startup-push-pending-v1';
export function startupPushPending(storage) {
  try {return (storage??globalThis.localStorage)?.getItem(STARTUP_PUSH_PENDING_KEY)==='1';} catch {return false;}
}
export function setStartupPushPending(value,storage) {
  try {
    const target=storage??globalThis.localStorage;
    if(value)target?.setItem(STARTUP_PUSH_PENDING_KEY,'1');else target?.removeItem(STARTUP_PUSH_PENDING_KEY);
  } catch {}
}

// Une vérification n'ouvre jamais de demande système. Si l'API Permissions est
// absente (notamment sur certains Safari), proposer un appui explicite plutôt
// que supposer que l'accès est accordé. Une réponse bloquée ne doit pas retenir
// l'ouverture de l'application.
export function readLocationPermission(nav=typeof navigator==='undefined'?null:navigator,{timeout=1500}={}) {
  if(typeof nav?.geolocation?.getCurrentPosition!=='function')return Promise.resolve('unsupported');
  if(typeof nav.permissions?.query!=='function')return Promise.resolve('prompt');
  return new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish('prompt'),timeout);
    try {
      Promise.resolve(nav.permissions.query({name:'geolocation'})).then(status=>{
        finish(['granted','denied','prompt'].includes(status?.state)?status.state:'prompt');
      },()=>finish('prompt'));
    } catch {finish('prompt');}
  });
}
