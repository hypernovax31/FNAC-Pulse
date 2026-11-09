import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import locations from '../server/locations.json' with {type:'json'};
import snapshot from '../server/fnac-directory.json' with {type:'json'};
import {mergeStoreDirectory,mergeRegionalChoices,storeSelectionGroups,searchStores,displayStoreName} from '../src/store-directory.js';
import {parseFnacDirectory,fetchFnacDirectory,assertDirectoryCoverage} from '../worker/fnac-source.js';

const options={legacyIds:locations.map(s=>s.id)};
const seed=()=>locations.map(s=>({...s,active:true}));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function page(entries=snapshot.stores,{declared=entries.length+2}={}) {
  const links=entries.map(({fnacId,name})=>`<li><a class="shop" href="https://www.fnac.com/ville/fiche/${fnacId}/w-4"><span>${escape(name.replace(/^Fnac /,''))}</span></a></li>`).join('');
  const repeated=entries.map(({fnacId})=>`<a href="/ville/fiche/${fnacId}/w-4">Voir la fiche du magasin</a>`).join('');
  return `<!doctype html><html><head><title>Fnac</title><script>"<a href='/x/x/cl222/w-4'>Erreur</a>"</script></head><body><h1>Trouver un magasin Fnac</h1><span>${declared}</span><span>Magasins</span><ul>${links}</ul>${repeated}</body></html>`;
}

test('Référence Fnac : 189 fiches et deux régions, noms et rattachements uniques',()=>{
  assert.equal(snapshot.declaredCount,191);assert.equal(snapshot.stores.length,189);assert.equal(snapshot.unlinkedRegions.length,2);
  assert.equal(new Set(snapshot.stores.map(s=>s.fnacId)).size,189);
  assert.equal(new Set(snapshot.stores.map(s=>s.name)).size,189);
  const mapped=snapshot.stores.filter(s=>s.legacyId);
  assert.equal(mapped.length,159);assert.equal(new Set(mapped.map(s=>s.legacyId)).size,159);
  assert(mapped.every(s=>locations.some(old=>old.id===s.legacyId)));
  assert.deepEqual(snapshot.stores.find(s=>s.fnacId==='cl57'),{fnacId:'cl57',name:'Fnac Labège',legacyId:'osm-way-386504727'});
  assert.deepEqual(snapshot.stores.find(s=>s.fnacId==='cl449'),{fnacId:'cl449',name:'Fnac Laval',legacyId:'osm-node-3782323705'});
  assert.equal(snapshot.stores.find(s=>s.fnacId==='cl231').name,"Fnac Paris - Gare de l'Est");
  assert.equal(snapshot.stores.find(s=>s.fnacId==='cl56').name,"Fnac Toulouse - Jeanne-d'Arc (Micro)");
});

test('Fusion initiale : clés et coordonnées conservées, historique non supprimé, idempotence',()=>{
  const input=seed();
  const lab=input.find(s=>s.id==='osm-way-386504727');lab.departmentHint='préservé';
  const old=input.find(s=>s.name==='Fnac Nantes');old.active=false;
  input.push({id:'custom-one',name:'Espace ajouté',active:true,lat:0,lon:0,unrelated:'à conserver'});
  const before=structuredClone(input),first=mergeStoreDirectory(input,snapshot.stores,options);
  assert.deepEqual(input,before);assert.equal(first.review.length,0);assert.equal(first.stores.length,211);
  assert(first.stores.every(s=>s.directoryStatus!=='region'));
  assert(first.stores.some(s=>s.id==='custom-one'&&s.unrelated==='à conserver'));
  for(const previous of input) {
    const current=first.stores.find(s=>s.id===previous.id);
    assert(current);assert.equal(current.active,previous.active);assert.equal(current.lat,previous.lat);assert.equal(current.lon,previous.lon);
  }
  assert.equal(first.stores.find(s=>s.id===lab.id).departmentHint,'préservé');
  assert.equal(first.stores.find(s=>s.id===lab.id).name,'Fnac Labège');
  assert.equal(first.stores.find(s=>s.id==='osm-way-401999671').name,"Fnac Paris - Gare de l'Est");
  assert.equal(first.stores.find(s=>s.fnacId==='cl389').name,'Fnac Paris - Gare du Nord');
  assert.equal(first.stores.find(s=>s.fnacId==='cl389').lat,null);
  assert(first.stores.some(s=>s.directoryStatus==='historical'));
  assert.deepEqual(mergeStoreDirectory(first.stores,snapshot.stores,options).stores,first.stores);
});

test('Liste communiquée : les 191 noms sont sélectionnables sans changer les clés des fiches',()=>{
  const requested=readFileSync(new URL('./fixtures/fnac-noms-communiques-2026-11-03.txt',import.meta.url),'utf8').trim().split('\n').map(name=>`Fnac ${name}`);
  assert.equal(requested.length,191);assert.equal(new Set(requested).size,191);
  const official=mergeStoreDirectory(seed(),snapshot.stores,options).stores;
  const regional=mergeRegionalChoices(official,snapshot.unlinkedRegions);
  assert.deepEqual(regional.review,[]);
  assert.deepEqual(regional.stores.slice(0,official.length),official,'aucune fiche existante n’est modifiée');
  const selection=storeSelectionGroups(regional.stores,[]).all;
  assert.deepEqual(new Set(selection.map(displayStoreName)),new Set(requested));
  for(const region of snapshot.unlinkedRegions) {
    const selected=selection.find(s=>s.id===region.id);
    assert.equal(selected.name,region.name);assert.equal(selected.directoryStatus,'regional-choice');
    assert.equal(selected.lat,null);assert.equal(selected.lon,null);assert.equal(selected.fnacId,undefined);
  }
  assert.equal(displayStoreName({fnacId:'cl629',name:'Fnac Carre Senart'}),'Fnac Carré Sénart');
  assert.equal(displayStoreName({fnacId:'cl629',name:'Fnac Nouveau lieu'}),'Fnac Nouveau lieu','un vrai renommage reste visible');
});

test('Mentions régionales : idempotence, état conservé et homonymes jamais fusionnés',()=>{
  const base=[{id:'ancien',name:'Équipe conservée',active:false,lat:1,lon:2,custom:'inchangé'}];
  const first=mergeRegionalChoices(base,snapshot.unlinkedRegions);
  assert.deepEqual(base,[{id:'ancien',name:'Équipe conservée',active:false,lat:1,lon:2,custom:'inchangé'}]);
  first.stores.find(s=>s.id==='fnac-region-reunion').active=false;
  assert.deepEqual(mergeRegionalChoices(first.stores,snapshot.unlinkedRegions).stores,first.stores);
  const conflict=mergeRegionalChoices([...base,{id:'perso',name:'Guadeloupe',active:true},
    {id:'fnac-region-reunion',name:'Une autre équipe',active:true}],snapshot.unlinkedRegions);
  assert.equal(conflict.stores.length,3);assert.deepEqual(conflict.review.map(r=>r.reason),['homonyme','identifiant']);
  const aliases=mergeRegionalChoices([...base,{id:'custom',name:'Autre',previousNames:['Fnac Guadeloupe']}],[snapshot.unlinkedRegions[0]]);
  assert.equal(aliases.review[0].reason,'homonyme');assert(!aliases.stores.some(s=>s.id===snapshot.unlinkedRegions[0].id));
  const limit=mergeRegionalChoices(base,snapshot.unlinkedRegions,{maxStores:1});assert.equal(limit.review.length,2);
});

test('Fusion mensuelle : pas de suppression, pas de réactivation, homonyme et clé ambiguë à vérifier',()=>{
  const input=[
    {id:'osm-known',name:'Ancien nom',fnacId:'cl1',directoryStatus:'official',active:false,lat:2,lon:3},
    {id:'fnac-cl2',name:'Fnac fermé',fnacId:'cl2',directoryStatus:'official',active:true,lat:4,lon:5},
    {id:'custom-shop',name:'Fnac Nouvelle',active:true,notes:'équipe existante'},
  ];
  const result=mergeStoreDirectory(input,[{fnacId:'cl1',name:'Fnac Nouveau nom'},{fnacId:'cl3',name:'Fnac Nouvelle'},{fnacId:'cl4',name:'Fnac Autre'}],{retireMissing:true});
  assert.equal(result.stores.find(s=>s.id==='osm-known').name,'Fnac Nouveau nom');
  assert.equal(result.stores.find(s=>s.id==='osm-known').active,false);
  assert.equal(result.stores.find(s=>s.id==='fnac-cl2').directoryStatus,'historical');
  assert.equal(result.stores.find(s=>s.id==='fnac-cl2').active,true);
  assert.equal(result.stores.find(s=>s.id==='custom-shop').notes,'équipe existante');
  assert.equal(result.stores.some(s=>s.fnacId==='cl3'),false);
  assert.deepEqual(result.review.map(r=>r.fnacId),['cl3']);
  assert.equal(result.stores.find(s=>s.fnacId==='cl4').lat,null);
  assert.throws(()=>mergeStoreDirectory([{id:'x',fnacId:'cl8'},{id:'y',fnacId:'cl8'}],[]),/plusieurs/);
  assert.throws(()=>mergeStoreDirectory([{id:'fnac-cl9',name:'magasin déjà utilisé'}],[{fnacId:'cl9',name:'Fnac Exemple'}]),/déjà utilisé/);
});

test('Sélection : masquer tous les historiques non confirmés sans supprimer leurs données',()=>{
  const stores=[{id:'off',name:'Fnac Bordeaux',directoryStatus:'official'},{id:'old',name:'Ancien',directoryStatus:'historical'},
    {id:'used',name:'Historique utilisé',directoryStatus:'historical'},{id:'custom',name:'Ajouté'},
    {id:'manual',name:'Copie non vérifiée',directoryStatus:'manual'},{id:'inactive',name:'Désactivé',active:false},
    {id:'region',name:'Région sans fiche',directoryStatus:'region'}];
  const before=structuredClone(stores),selected=storeSelectionGroups(stores,[{storeId:'used',active:true}],{selectedId:'old'});
  assert.deepEqual(selected.official.map(s=>s.id),['off']);assert.deepEqual(new Set(selected.other.map(s=>s.id)),new Set(['custom','manual']));
  assert(!selected.all.some(s=>['region','old','used','inactive'].includes(s.id)));assert.deepEqual(stores,before);
});

test('Extraction HTML : noms et identifiants Fnac, accents, liens génériques ignorés',()=>{
  const html=page().replace('Labège','Lab&egrave;ge');
  const parsed=parseFnacDirectory(html);
  assert.equal(parsed.declared,191);assert.equal(parsed.entries.length,189);
  assert.equal(parsed.entries.find(s=>s.fnacId==='cl57').name,'Fnac Labège');
  assert.equal(parsed.entries.find(s=>s.fnacId==='cl56').name,"Fnac Toulouse - Jeanne-d'Arc (Micro)");
  assertDirectoryCoverage(parsed.entries,mergeStoreDirectory(seed(),snapshot.stores,options).stores);
});

test('Extraction HTML : captcha, liste partielle, identifiants contradictoires et liens étrangers refusés',()=>{
  assert.throws(()=>parseFnacDirectory('<title>Captcha</title>'),e=>e.code==='invalid');
  assert.throws(()=>parseFnacDirectory(page(snapshot.stores.slice(0,100),{declared:191})),e=>e.code==='incomplete');
  const html=page().replace('</ul>',`<li><a href="/ville/fiche/cl57/w-4">Un autre nom</a></li></ul>`);
  assert.throws(()=>parseFnacDirectory(html),e=>e.code==='ambiguous');
  const foreign=page().replace('https://www.fnac.com/ville/fiche/cl57','https://example.com/ville/fiche/cl57');
  assert.throws(()=>parseFnacDirectory(foreign),e=>e.code==='incomplete');
  assert.throws(()=>assertDirectoryCoverage(snapshot.stores.slice(0,120),mergeStoreDirectory(seed(),snapshot.stores,options).stores),e=>e.code==='incomplete');
});

test('Accès à la source : refus HTTP et panne réseau signalés, jamais interprétés comme une liste',async()=>{
  await assert.rejects(()=>fetchFnacDirectory(async()=>new Response('bloqué',{status:403})),e=>e.code==='blocked');
  await assert.rejects(()=>fetchFnacDirectory(async()=>{throw Error('network')}),e=>e.code==='unavailable');
  const parsed=await fetchFnacDirectory(async()=>new Response(page(),{status:200,headers:{'content-type':'text/html'}}));
  assert.equal(parsed.entries.length,189);
});


test('Recherche magasin : accents, ordre des mots, ville et identifiants distincts',()=>{
  const rows=[{id:'a',name:'Fnac Labège',city:'Labège'},{id:'b',name:'Fnac Toulouse - Jeanne-d’Arc',city:'Toulouse'},{id:'c',name:'Fnac Labège',city:'autre'}];
  assert.deepEqual(searchStores(rows,'LABEGE').map(x=>x.id),['a','c']);
  assert.deepEqual(searchStores(rows,'jeanne fnac').map(x=>x.id),['b']);
  assert.deepEqual(searchStores(rows,'touLouse').map(x=>x.id),['b']);
  assert.deepEqual(searchStores(rows,'introuvable'),[]);
  assert.equal(searchStores([{id:'z',name:'Fnac 東京'}],'東京')[0].id,'z');
  assert.equal(searchStores(rows,'').length,3);
});

test('Recherche magasin : Pau ne trouve pas Melun par sa rue Paul Doumer',()=>{
  const pau=locations.find(s=>s.name==='Fnac Pau'),melun=locations.find(s=>s.name==='Fnac Melun');
  assert(pau&&melun&&/Paul Doumer/i.test(melun.address));
  assert.deepEqual(searchStores([melun,pau],'PAU').map(s=>s.name),['Fnac Pau']);
  assert.deepEqual(searchStores([melun,pau],'paul'),[],'une rue non affichée ne crée pas de faux résultat');
  assert.deepEqual(searchStores([melun,pau],'MELUN').map(s=>s.name),['Fnac Melun']);
  assert.equal(searchStores([{id:'ancien',name:'Fnac Nouvelle',city:'Test',previousNames:['Fnac Pau']}],'pau')[0].id,'ancien');
});

test('Copie non certifiée : statuts distincts et noms remplacés conservés et recherchables',()=>{
  const current=[{id:'ancien',name:'Fnac Ancienne',fnacId:'cl1',directoryStatus:'official',active:true},
    {id:'inchangé',name:'Fnac Même',fnacId:'cl2',directoryStatus:'official',active:true}];
  const incoming=[{fnacId:'cl1',name:'Fnac Nouvelle'},{fnacId:'cl2',name:'Fnac Même'},{fnacId:'cl3',name:'Fnac Ajoutée'}];
  const manual=mergeStoreDirectory(current,incoming,{manual:true}).stores;
  assert.equal(manual[0].id,'ancien');assert.equal(manual[0].directoryStatus,'manual');assert.equal(manual[0].directoryPreviouslyVerified,true);
  assert.deepEqual(manual[0].previousNames,['Fnac Ancienne']);assert.equal(manual[1].directoryStatus,'official');
  assert.equal(manual[2].directoryStatus,'manual');assert.equal(manual[2].directoryPreviouslyVerified,undefined);
  assert.equal(searchStores(manual,'ancienne')[0].id,'ancien');assert.equal(storeSelectionGroups(manual,[]).all.length,3);
  const verified=mergeStoreDirectory(manual,incoming).stores;
  assert.equal(verified[0].directoryStatus,'official');assert.equal(verified[0].directoryPreviouslyVerified,undefined);
  assert.deepEqual(verified[0].previousNames,['Fnac Ancienne']);assert.equal(verified[2].directoryStatus,'official');
  const many=[{...current[0],previousNames:Array.from({length:12},(_,i)=>`Ancien ${i}`)}];
  assert.throws(()=>mergeStoreDirectory(many,[incoming[0]],{manual:true}),/Trop de noms historiques/);
});

test('Couverture : une fiche vérifiée avant changement manuel reste dans la base de contrôle',()=>{
  const verified=Array.from({length:100},(_,i)=>({fnacId:`cl${i+1}`,directoryStatus:i<80?'manual':'official',directoryPreviouslyVerified:i<80}));
  assert.throws(()=>assertDirectoryCoverage(Array.from({length:50},(_,i)=>({fnacId:`cl${i+1}`})),verified),e=>e.code==='incomplete');
});
