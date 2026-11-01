// La comparaison est identique à celle de l'administration : les accents et la
// casse ne créent pas silencieusement un second profil dans le même magasin.
export function cleanSellerName(value) {
  return typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/g,' ').slice(0,60):'';
}
export function validSellerName(value) {
  return typeof value==='string'&&value.length>=1&&value.length<=60&&/\p{L}/u.test(value)&&/^[\p{L}\p{M}\p{N} .’'\-]+$/u.test(value);
}
export function sameSellerName(a,b) {
  const left=cleanSellerName(a),right=cleanSellerName(b);
  return !!left&&!!right&&left.localeCompare(right,'fr',{sensitivity:'base'})===0;
}
