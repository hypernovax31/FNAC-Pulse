// Préférence d'affichage locale, pas un jeton d'authentification : le serveur
// exige toujours le PIN après déconnexion, même si ce profil est mémorisé.
export const DEVICE_PROFILE_KEY='fnac-pulse-device-profile-v1';
export function deviceProfile(value) {
  const storeId=value?.storeId,sellerId=Number(value?.sellerId);
  return typeof storeId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(storeId)&&Number.isSafeInteger(sellerId)&&sellerId>0&&sellerId<1000000?{storeId,sellerId}:null;
}
export function readDeviceProfile(storage,fallback=null) {
  try {const saved=(storage??globalThis.localStorage)?.getItem(DEVICE_PROFILE_KEY);return deviceProfile(saved?JSON.parse(saved):null)||deviceProfile(fallback);} catch {return deviceProfile(fallback);}
}
export function saveDeviceProfile(value,storage) {
  const profile=deviceProfile(value);if(!profile)return null;
  try {(storage??globalThis.localStorage)?.setItem(DEVICE_PROFILE_KEY,JSON.stringify(profile));} catch {}
  return profile;
}
export function clearDeviceProfile(storage) {try {(storage??globalThis.localStorage)?.removeItem(DEVICE_PROFILE_KEY);} catch {}}
