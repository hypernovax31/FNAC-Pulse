// L'identifiant interne d'un magasin est une clé de profils et d'historique.
// Il ne doit jamais être remplacé par l'identifiant de l'annuaire Fnac.
export const DIRECTORY_VERSION = 'fnac-directory-2026-10-29-v1';

function normalizedName(value) {
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function newStore(id,name,fnacId,status) {
  return {id,name,city:'',address:'',lat:null,lon:null,active:true,...(fnacId?{fnacId}:{}),directoryStatus:status};
}

// Fusion conservative : ne supprime ni ne désactive jamais un magasin. Les
// coordonnées, les états et tous les autres champs des magasins existants sont
// conservés. Un homonyme non relié attend une vérification humaine.
export function mergeStoreDirectory(current,entries,{legacyIds=[],retireMissing=false,maxStores=500}={}) {
  if(!Array.isArray(current)||!Array.isArray(entries))throw Error('Annuaire invalide');
  const stores=current.map(s=>({...s})), byId=new Map(),byFnacId=new Map(),names=new Map();
  const addName=name=>{const key=normalizedName(name);names.set(key,(names.get(key)||0)+1);};
  const removeName=name=>{const key=normalizedName(name),count=names.get(key)||0;if(count<=1)names.delete(key);else names.set(key,count-1);};
  for(const s of stores) {
    if(!s?.id||byId.has(s.id))throw Error('Identifiant de magasin dupliqué');
    byId.set(s.id,s);addName(s.name);
    if(s.fnacId) {
      if(byFnacId.has(s.fnacId))throw Error('Identifiant Fnac déjà associé à plusieurs magasins');
      byFnacId.set(s.fnacId,s);
    }
  }
  const seen=new Set(),review=[];
  for(const entry of entries) {
    if(!/^cl\d{1,9}$/.test(entry.fnacId||'')||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>120||seen.has(entry.fnacId))throw Error('Entrée Fnac invalide ou dupliquée');
    seen.add(entry.fnacId);
    let target=byFnacId.get(entry.fnacId);
    if(!target&&entry.legacyId&&byId.has(entry.legacyId)) {
      target=byId.get(entry.legacyId);
      if(target.fnacId&&target.fnacId!==entry.fnacId)throw Error('Correspondance Fnac historique contradictoire');
    }
    if(!target) {
      const id=`fnac-${entry.fnacId}`;
      if(byId.has(id))throw Error('Identifiant Fnac déjà utilisé sans correspondance vérifiée');
      // Ne jamais fusionner automatiquement avec un magasin personnalisé ou
      // historique homonyme : il peut déjà posséder sa propre équipe.
      if(names.has(normalizedName(entry.name))) {
        review.push({fnacId:entry.fnacId,name:entry.name,reason:'homonyme'});continue;
      }
      if(stores.length>=maxStores){review.push({fnacId:entry.fnacId,name:entry.name,reason:'limite'});continue;}
      target=newStore(id,entry.name,entry.fnacId,'official');
      stores.push(target);byId.set(id,target);addName(target.name);
    }
    if(target.name!==entry.name){removeName(target.name);target.name=entry.name;addName(target.name);}
    target.fnacId=entry.fnacId;target.directoryStatus='official';
    byFnacId.set(entry.fnacId,target);
  }
  const legacySet=new Set(legacyIds);
  for(const s of stores) {
    if(s.fnacId&&retireMissing&&!seen.has(s.fnacId))s.directoryStatus='historical';
    else if(!s.fnacId&&legacySet.has(s.id))s.directoryStatus='historical';
  }
  // Les mentions régionales sans fiche restent des métadonnées, jamais des
  // magasins : elles ne doivent pas mélanger les équipes de plusieurs lieux.
  return {stores,review};
}

export function initialDirectorySync(snapshot) {
  return {verifiedAt:snapshot.reviewedAt, lastAttempt:'2026-10-29', lastResult:'blocked',
    source:snapshot.source, reviewCount:0};
}

// Les magasins historiques restent gérables et disponibles si une équipe
// active y est encore attachée ; ils ne monopolisent pas la géolocalisation.
export function storeSelectionGroups(stores,sellers,{selectedId=''}={}) {
  const linked=new Set((sellers||[]).filter(s=>s.active!==false&&s.active!==0).map(s=>s.storeId));
  const official=[],other=[];
  for(const store of stores||[]) {
    if(store.directoryStatus==='region')continue;
    if(store.directoryStatus==='historical'&&!linked.has(store.id)&&store.id!==selectedId)continue;
    (store.directoryStatus==='official'?official:other).push(store);
  }
  const compare=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr',{sensitivity:'base',numeric:true});
  official.sort(compare);other.sort(compare);
  return {official,other,all:[...official,...other]};
}
