// L'identifiant interne d'un magasin est une clé de profils et d'historique.
// Il ne doit jamais être remplacé par l'identifiant de l'annuaire Fnac.
export const DIRECTORY_VERSION = 'fnac-directory-2026-10-29-v1';
// Migration séparée : elle n'applique pas à nouveau un ancien instantané aux
// magasins qui auraient été modifiés depuis la première installation.
export const REGIONAL_CHOICES_VERSION = 'fnac-regional-choices-2026-11-03-v1';

function normalizedName(value) {
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
// Typographie de la liste communiquée par l'utilisateur. La dénomination
// officielle reste en base ; si Fnac renomme vraiment une fiche, ne jamais
// masquer ce nouveau nom derrière une ancienne variante d'affichage.
const DISPLAY_NAMES={
  cl629:'Fnac Carré Sénart',cl695:'Fnac Isle d’Abeau',cl500:'Fnac Montceau-les-Mines',
  cl378:'Fnac Montpon-Ménestérol',cl231:'Fnac Paris - Gare de l’Est',cl62:'Fnac Saint-Étienne',
  cl56:'Fnac Toulouse - Jeanne-d’Arc (Micro)',cl52:'Fnac Val d’Europe',
};
export function displayStoreName(store) {
  const name=store?.name||'',preferred=DISPLAY_NAMES[store?.fnacId];
  return preferred&&normalizedName(preferred)===normalizedName(name)?preferred:name;
}

// Recherche tolérante aux accents, à la casse et aux espaces : les identifiants
// internes restent inchangés, y compris pour deux magasins de même nom.
export function searchStores(stores,query) {
  const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const terms=fold(query).split(/\s+/).filter(Boolean);
  return (stores||[]).filter(store=>{
    // Les adresses ne sont pas affichées dans le sélecteur : « Pau » ne doit
    // pas faire apparaître Melun parce que sa rue s'appelle Paul Doumer.
    const haystack=fold([store.name,...(Array.isArray(store.previousNames)?store.previousNames:[]),store.city].filter(Boolean).join(' '));
    return terms.every(term=>haystack.includes(term));
  });
}
function newStore(id,name,fnacId,status) {
  return {id,name,city:'',address:'',lat:null,lon:null,active:true,...(fnacId?{fnacId}:{}),directoryStatus:status};
}

// Fusion conservative : ne supprime ni ne désactive jamais un magasin. Les
// coordonnées, les états et tous les autres champs des magasins existants sont
// conservés. Un homonyme non relié attend une vérification humaine.
export function mergeStoreDirectory(current,entries,{legacyIds=[],retireMissing=false,maxStores=500,manual=false}={}) {
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
    const verifiedSame=!!target&&target.fnacId===entry.fnacId&&target.directoryStatus==='official'&&target.name===entry.name;
    const previouslyVerified=target?.directoryStatus==='official'||target?.directoryPreviouslyVerified===true;
    if(!target) {
      const id=`fnac-${entry.fnacId}`;
      if(byId.has(id))throw Error('Identifiant Fnac déjà utilisé sans correspondance vérifiée');
      // Ne jamais fusionner automatiquement avec un magasin personnalisé ou
      // historique homonyme : il peut déjà posséder sa propre équipe.
      if(names.has(normalizedName(entry.name))) {
        review.push({fnacId:entry.fnacId,name:entry.name,reason:'homonyme'});continue;
      }
      if(stores.length>=maxStores){review.push({fnacId:entry.fnacId,name:entry.name,reason:'limite'});continue;}
      target=newStore(id,entry.name,entry.fnacId,manual?'manual':'official');
      stores.push(target);byId.set(id,target);addName(target.name);
    }
    if(target.name!==entry.name){
      const previous=Array.isArray(target.previousNames)?target.previousNames.filter(x=>typeof x==='string'&&x):[];
      // Ne pas effacer un nom historique, y compris lors d'une copie manuelle.
      // Une limite explicite évite de grossir le document Firestore sans borne.
      if(target.name&&!previous.includes(target.name)) {
        if(previous.length>=12)throw Error('Trop de noms historiques pour ce magasin');
        target.previousNames=[...previous,target.name];
      }
      removeName(target.name);target.name=entry.name;addName(target.name);
    }
    target.fnacId=entry.fnacId;
    if(manual&&!verifiedSame) {
      target.directoryStatus='manual';
      if(previouslyVerified)target.directoryPreviouslyVerified=true;
    } else if(!manual) {
      target.directoryStatus='official';delete target.directoryPreviouslyVerified;
    }
    byFnacId.set(entry.fnacId,target);
  }
  const legacySet=new Set(legacyIds);
  for(const s of stores) {
    if(s.fnacId&&retireMissing&&!seen.has(s.fnacId))s.directoryStatus='historical';
    else if(!s.fnacId&&legacySet.has(s.id))s.directoryStatus='historical';
  }
  // Les mentions régionales ne font pas partie des fiches officielles ; leurs
  // espaces génériques sont traités séparément par mergeRegionalChoices.
  return {stores,review};
}

// Les deux entrées régionales figurent dans la liste Fnac sans fiche de magasin
// individuel. On leur donne des espaces distincts et clairement signalés,
// sans jamais les fusionner avec un éventuel magasin personnalisé homonyme.
export function mergeRegionalChoices(current,regions,{maxStores=500}={}) {
  if(!Array.isArray(current)||!Array.isArray(regions))throw Error('Mentions régionales invalides');
  const stores=current.map(s=>({...s})),review=[];
  const comparable=name=>normalizedName(name).replace(/^fnac\s+/, '');
  for(const region of regions) {
    if(!/^fnac-region-[a-z0-9-]+$/.test(region?.id||'')||typeof region.name!=='string'||!region.name.trim())throw Error('Mention régionale invalide');
    const sameId=stores.find(s=>s.id===region.id);
    if(sameId) {
      if(sameId.directoryStatus!=='regional-choice'||comparable(sameId.name)!==comparable(region.name))review.push({id:region.id,name:region.name,reason:'identifiant'});
      continue;
    }
    if(stores.some(s=>[s.name,...(Array.isArray(s.previousNames)?s.previousNames:[])].some(name=>comparable(name)===comparable(region.name)))) {
      review.push({id:region.id,name:region.name,reason:'homonyme'});continue;
    }
    if(stores.length>=maxStores){review.push({id:region.id,name:region.name,reason:'limite'});continue;}
    stores.push({id:region.id,name:region.name,city:'',address:'',lat:null,lon:null,active:true,directoryStatus:'regional-choice'});
  }
  return {stores,review};
}

export function initialDirectorySync(snapshot) {
  return {verifiedAt:snapshot.reviewedAt, lastAttempt:'2026-10-29', lastResult:'blocked',
    source:snapshot.source, reviewCount:0};
}

// Les fiches non confirmées dans l'annuaire ne sont plus proposées dans les
// sélecteurs, mais restent en base : les profils et sessions ne sont pas effacés.
// Les ajouts de l'administrateur et les copies manuelles restent accessibles.
export function isSelectableStore(store) {
  return !!store&&store.active!==false&&store.active!==0&&!['region','historical'].includes(store.directoryStatus);
}
export function storeSelectionGroups(stores) {
  const official=[],other=[];
  for(const store of stores||[]) {
    if(!isSelectableStore(store))continue;
    (store.directoryStatus==='official'||store.directoryStatus==='regional-choice'?official:other).push(store);
  }
  const compare=(a,b)=>displayStoreName(a).localeCompare(displayStoreName(b),'fr',{sensitivity:'base',numeric:true});
  official.sort(compare);other.sort(compare);
  return {official,other,all:[...official,...other]};
}
