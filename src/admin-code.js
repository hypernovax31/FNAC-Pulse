// Le code d'autorisation est distinct du mot de passe provisoire à 6
// caractères. Ses 16 symboles aléatoires représentent 80 bits d'entropie.
export const ADMIN_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ADMIN_CODE_LENGTH=16;
export function normalizeAdminCode(value) {
  if(typeof value!=='string'||value.length>80)return '';
  const code=value.toUpperCase().replace(/[\s-]/g,'');
  return code.length===ADMIN_CODE_LENGTH&&[...code].every(char=>ADMIN_CODE_ALPHABET.includes(char))?code:'';
}
export function formatAdminCode(value) {
  const code=normalizeAdminCode(value);
  return code?code.match(/.{4}/g).join('-'):'';
}
export function createAdminCode() {
  if(!globalThis.crypto?.getRandomValues)throw new Error('Générateur sécurisé indisponible.');
  const bytes=crypto.getRandomValues(new Uint8Array(ADMIN_CODE_LENGTH));
  return Array.from(bytes,byte=>ADMIN_CODE_ALPHABET[byte&31]).join('');
}
// Firebase ne reçoit jamais le mot de passe de 6 caractères seul. La clé
// temporaire dépend aussi du code secret à usage unique et de l'adresse.
// Cela évite qu'un simple mot de passe court suffise à attaquer le compte.
export async function derivedAdminCodePassword({code,email,password}={}) {
  const normalized=normalizeAdminCode(code),address=typeof email==='string'?email.trim().toLowerCase():'';
  const passwordLength=typeof password==='string'?Array.from(password).length:0;
  if(!normalized||!address||passwordLength<1||passwordLength>6)throw new Error('Code ou mot de passe provisoire invalide.');
  if(!globalThis.crypto?.subtle)throw new Error('Connexion sécurisée indisponible sur cet appareil.');
  const input=new TextEncoder().encode(JSON.stringify(['fnac-pulse-admin-code-v1',normalized,address,password]));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',input));
  let raw='';for(const byte of digest)raw+=String.fromCharCode(byte);
  // Préfixe compatible avec les politiques Firebase exigeant les quatre types.
  return `aA0!${btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
}
