// Une réponse perdue garde le même identifiant sur cet appareil et pour ce
// profil. Aucun jeton, PIN ni nom personnel n'est stocké avec la demande.
export const PENDING_SALES_KEY='fnac-pulse-pending-sales-v1';
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(value);
const storeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
function valid(record) {
  return !!record&&typeof record==='object'&&typeof record.owner==='string'&&record.owner.length>0&&record.owner.length<512&&
    /^\d{4}-\d{2}-\d{2}$/.test(record.day||'')&&storeId(record.storeId)&&Number.isSafeInteger(record.sellerId)&&record.sellerId>0&&
    Number.isSafeInteger(record.serviceId)&&record.serviceId>0&&storeId(record.departmentId)&&safeId(record.requestId)&&
    typeof record.clientId==='string'&&record.clientId.length<=80&&typeof record.generation==='string'&&record.generation.length<=80&&
    (record.originTokenId===''||typeof record.originTokenId==='string'&&/^[A-Za-z0-9_-]{43}$/.test(record.originTokenId));
}
export function readPendingSales(storage) {
  try {
    const value=JSON.parse((storage??globalThis.localStorage)?.getItem(PENDING_SALES_KEY)||'[]');
    return Array.isArray(value)?value.filter(valid).slice(-100):[];
  } catch{return [];}
}
export function savePendingSales(records,storage) {
  try{(storage??globalThis.localStorage)?.setItem(PENDING_SALES_KEY,JSON.stringify(records.filter(valid).slice(-100)));}catch{}
}
