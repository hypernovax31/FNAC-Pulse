// Le PIN ne quitte jamais le navigateur : seul son dérivé est transmis.
// Le dérivé se comporte comme un mot de passe et ne doit jamais être enregistré.
const ITERATIONS=210000;
const SALT=/^[A-Za-z0-9_-]{16,80}$/;
export function createPinSalt() {
  const bytes=crypto.getRandomValues(new Uint8Array(18));let text='';
  for(const b of bytes)text+=String.fromCharCode(b);
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function pinProof(projectId,storeId,sellerId,pin,pinSalt='') {
  if (!/^(?:\d{4}|\d{8})$/.test(pin)) throw new Error('Le code PIN doit comporter 4 ou 8 chiffres.');
  if(pinSalt&&!SALT.test(pinSalt))throw new Error('Informations du profil invalides.');
  if(!pinSalt&&(!Number.isSafeInteger(Number(sellerId))||Number(sellerId)<=0))throw new Error('Profil vendeur invalide.');
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);
  // v1 est inchangé pour les profils existants ; v2 permet de créer le profil
  // et son PIN dans la même transaction, avant de connaître son identifiant.
  const salt=enc.encode(pinSalt?`fnac-pulse-pin-v2|${projectId}|${storeId}|${pinSalt}`:`fnac-pulse-pin-v1|${projectId}|${storeId}|${Number(sellerId)}`);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},key,256));
  let str='';for(const b of bits)str+=String.fromCharCode(b);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
