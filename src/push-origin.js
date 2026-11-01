// Ne jamais stocker le jeton FCM en clair dans le stockage de l'application.
// Son empreinte identifie l'abonnement qui a enregistré une vente, même si le
// téléphone est ensuite confié à un autre profil avant la livraison du push.
export const PUSH_ORIGIN_KEY='fnac-pulse-push-origin-v1';
const TOKEN_ID=/^[A-Za-z0-9_-]{43}$/;
export async function rememberPushOrigin(token,storage,cryptoApi=globalThis.crypto,signal) {
  try {
    const bytes=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(token)));
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    const id=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    if(signal?.aborted)return '';
    (storage??globalThis.localStorage)?.setItem(PUSH_ORIGIN_KEY,id);
    return id;
  } catch {return '';}
}
export function readPushOrigin(storage) {
  try {const value=(storage??globalThis.localStorage)?.getItem(PUSH_ORIGIN_KEY)||'';return TOKEN_ID.test(value)?value:'';} catch {return '';}
}
export function clearPushOrigin(storage) {
  try {(storage??globalThis.localStorage)?.removeItem(PUSH_ORIGIN_KEY);} catch {}
}
