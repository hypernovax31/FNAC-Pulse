// Le PIN ne quitte jamais le navigateur : seul son dérivé est transmis.
// Le dérivé se comporte comme un mot de passe et ne doit jamais être enregistré.
const ITERATIONS=210000;
export async function pinProof(projectId,storeId,sellerId,pin) {
  if (!/^\d{8}$/.test(pin)) throw new Error('Le code PIN doit comporter exactement 8 chiffres.');
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);
  const salt=enc.encode(`fnac-pulse-pin-v1|${projectId}|${storeId}|${Number(sellerId)}`);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},key,256));
  let str='';for(const b of bits)str+=String.fromCharCode(b);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
