// Le catalogue initial commun est rattaché à Labège, sans changer les identifiants historiques.
export const LEGACY_STORE_ID = 'osm-way-386504727';
const nameCollator = new Intl.Collator('fr', {sensitivity:'base', numeric:true});

export function comparePeople(a,b) {
  return nameCollator.compare(a.name || '', b.name || '') || Number(a.id) - Number(b.id);
}

export function sellerStoreId(seller) {
  return seller.storeId || LEGACY_STORE_ID;
}

export function sellersForStore(sellers,storeId,{activeOnly=true}={}) {
  if(!storeId)return [];
  return (sellers || []).filter(s=>sellerStoreId(s)===storeId && (!activeOnly || (s.active!==false&&s.active!==0))).sort(comparePeople);
}

// Les services sans position enregistrée restent à la fin, dans leur ordre initial.
export function orderServices(services,orders,storeId) {
  const original=services || [];
  const stored=storeId && Array.isArray(orders?.[storeId]) ? orders[storeId] : [];
  const positions=new Map(stored.map((id,index)=>[Number(id),index]));
  return original.map((service,index)=>({service,index})).sort((a,b)=>{
    const ai=positions.has(Number(a.service.id))?positions.get(Number(a.service.id)):stored.length+a.index;
    const bi=positions.has(Number(b.service.id))?positions.get(Number(b.service.id)):stored.length+b.index;
    return ai-bi || a.index-b.index;
  }).map(x=>x.service);
}

// Les identifiants de ces deux services sont conservés même si leur intitulé change.
export function priorityServiceId(services,code) {
  const explicit=(services||[]).find(s=>s.priorityCode===code);
  if(explicit)return Number(explicit.id);
  const wanted=String(code).toLocaleLowerCase('fr');
  const named=(services||[]).find(s=>String(s.name||'').replace(/\s/g,'').toLocaleLowerCase('fr')===wanted);
  return named?Number(named.id):null;
}
