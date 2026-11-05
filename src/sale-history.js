// Périodes de correction fondées sur la date commerciale de Paris, et non
// sur l'heure locale du navigateur. La date choisie détermine le jour,
// la semaine ISO (lundi–dimanche) ou le mois à consulter.
export const MAX_SALE_CORRECTION=20;
export const SALE_CORRECTION_CONFIRMATION='SUPPRIMER';
export const SALE_ADDITION_CONFIRMATION='AJOUTER';
function isoDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
const asIso=date=>date.toISOString().slice(0,10);
export function saleHistoryRange(period,anchor,today) {
  const date=isoDate(anchor);
  if(!date||!isoDate(today)||anchor>today||!['day','week','month'].includes(period))return null;
  if(period==='day')return {start:anchor,end:anchor};
  if(period==='week') {
    const start=new Date(date);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
    return {start:asIso(start),end:asIso(end)};
  }
  const start=new Date(date);start.setUTCDate(1);
  const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  return {start:asIso(start),end:asIso(end)};
}
// La validation historique semaine/mois reste utilisée avant la recherche des
// anciens marqueurs idempotents. Toute nouvelle correction exige ensuite day.
export function validAdditionDate(period,anchor,saleDate,today) {
  const range=saleHistoryRange(period,anchor,today);
  return !!range&&!!saleHistoryRange('day',saleDate,today)&&saleDate>=range.start&&saleDate<=range.end;
}
// Un identifiant de requête reste réutilisable seulement pour le même ajout.
export function saleAdditionFingerprintInput({storeId,sellerId,period,anchor,saleDate,serviceId,departmentId,quantity}) {
  return JSON.stringify(['add-v1',storeId,Number(sellerId),period,anchor,saleDate,Number(serviceId),departmentId,Number(quantity)]);
}
// Le même ordre canonique rend un identifiant de requête réutilisable sans
// jamais supprimer un autre ensemble après une réponse perdue.
export function saleCorrectionFingerprintInput({storeId,sellerId,period,anchor,saleIds}) {
  return JSON.stringify([storeId,Number(sellerId),period,anchor,[...saleIds].sort()]);
}
