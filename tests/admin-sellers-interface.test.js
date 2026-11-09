import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/Admin.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'admin-mocks',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__adminTestApi(...x);export const uid=()=>"admin-test-job-0001";export const dateLabel=x=>x;export const timeLabel=x=>x;`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`export const claimAdminAccess=(...x)=>globalThis.__directLogin?.claim?.(...x),registerAdminForApproval=(...x)=>globalThis.__directLogin?.manualRegister?.(...x),deleteTestFirebaseAccount=()=>{}; export const CLOUD=true,ADMIN_SESSION='admin';export const adminLogin=()=>{};export const adminLogout=()=>{};export const changeAdminPassword=()=>{}; export const adminAccountEmail=async()=>"admin@example.test"; export const createAdministrator=()=>{}; export const createDirectAdministrator=()=>{}; export const createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=()=>{},changeFirstCodeAdminPassword=()=>{}; export const inviteAdministrator=()=>{},requestAdminPasswordReset=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{}; export const requestAdminEmailChange=()=>{};export const inspectAdminEmailChange=()=>{};export const confirmAdminEmailChange=()=>{}; export const resendAdminVerification=()=>{};`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const Admin=module.exports.default;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Administration : vendeurs, ajout, réinitialisation PIN et suppression dans un seul onglet',async()=>{
  const original={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage,__adminTestApi:globalThis.__adminTestApi};
  const calls=[],store='magasin-test',sellers=[{id:1,name:'Alice',storeId:store,departmentId:'tech',active:true},{id:2,name:'Benoît',storeId:store,departmentId:'tech',active:false}];
  globalThis.document={body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={confirm:()=>true};globalThis.sessionStorage={getItem:key=>key==='pulse-admin-token'?'admin-token':null,setItem(){},removeItem(){}};
  globalThis.__adminTestApi=async(path,options={})=>{
    calls.push({path,...options});
    if(path==='/api/admin/all')return {sellers,services:[],serviceOrders:{},departmentsByStore:{[store]:[{id:'tech',name:'Technique',active:true}]}};
    if(path.startsWith('/api/admin/counts'))return {counts:[]};
    if(path.startsWith('/api/admin/goals?'))return {goals:{},workdays:[1,2,3,4,5],workdaysRevision:'planning-before'};
    if(path==='/api/admin/workdays')return {goals:{},workdays:options.body.workdays,workdaysRevision:'planning-after'};
    if(path.includes('/reset?')||path.includes('/sellers/delete?'))return {status:'idle',jobId:null,deletedSales:0};
    return {ok:true};
  };let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},session:{storeId:store,sellerId:1},data:{stores:[{id:store,name:'Fnac Test'}],services:[],today:'2026-11-01'}}));await tick();});
    const tabs=tree.root.findAllByProps({role:'tab'});assert.deepEqual(tabs.map(text),['Magasins','Vendeurs','Objectifs','Ventes','Services','Départements','Administrateurs']);assert(!tabs.some(x=>text(x)==='Codes PIN'));
    await act(async()=>{tabs.find(x=>text(x)==='Vendeurs').props.onClick();await tick();});
    const copy=text(tree.toJSON()),headings=tree.root.findAllByType('h3').map(text);
    assert(headings.includes('Vendeurs'));assert(headings.includes('Réinitialisation codes PIN'));
    assert.doesNotMatch(copy,/Vendeurs et accès|Accès et codes PIN/);
    assert.match(copy,/Chaque vendeur choisit son propre PIN lors de sa première connexion. Aucun code préalable n’est nécessaire\./);
    assert.match(copy,/Supprimer définitivement un vendeur/);assert.match(copy,/Benoît/);
    const alice=tree.root.findAllByType('article').find(card=>text(card).includes('Alice'));assert(alice);
    const assigned=alice.findByProps({'aria-label':'Département de Alice'});
    assert.equal(assigned.type,'div');assert.match(text(assigned),/Technique/);assert.doesNotMatch(text(assigned),/Affectation définitive/);
    assert.equal(alice.findAllByType('select').length,0,'le département déjà attribué est en lecture seule');
    assert.match(copy,/ne pourra plus être modifié après la création/);
    await act(async()=>{alice.findAllByType('button').find(button=>text(button).includes('Jours travaillés')).props.onClick();await tick();});
    const workdays=alice.findByProps({className:'workdays-form'});assert.equal(workdays.findAllByType('input').length,7);
    assert.equal(workdays.props['aria-labelledby'],workdays.findByType('h4').props.id);
    const sunday=workdays.findAllByType('label').find(label=>text(label).includes('Dimanche')).findByType('input');
    await act(async()=>sunday.props.onChange());await act(async()=>{workdays.props.onSubmit({preventDefault(){}});await tick();});
    assert(calls.some(x=>x.path==='/api/admin/workdays'&&x.body.storeId===store&&x.body.sellerId===1&&x.body.workdays.includes(0)));
    await act(async()=>{tree.root.findAllByProps({role:'tab'}).find(x=>text(x)==='Objectifs').props.onClick();await tick();});
    assert.equal(tree.root.findAllByProps({className:'workdays-form'}).length,0);assert.match(text(tree.toJSON()),/Planning et calcul/);
    await act(async()=>{tree.root.findAllByProps({role:'tab'}).find(x=>text(x)==='Vendeurs').props.onClick();await tick();});
    const input=tree.root.findByProps({'aria-label':'Nom du vendeur'});
    await act(async()=>input.props.onChange({target:{value:'Clara'}}));
    const addForm=tree.root.findAllByType('form').find(f=>f.findAllByProps({'aria-label':'Nom du vendeur'}).length);
    await act(async()=>{addForm.props.onSubmit({preventDefault(){}});await tick();});
    assert(!calls.some(x=>x.path==='/api/admin/entities/sellers'&&x.method==='POST'),'le département doit être choisi explicitement');
    await act(async()=>tree.root.findByProps({'aria-label':'Département du nouveau vendeur'}).props.onChange({target:{value:'tech'}}));
    await act(async()=>{addForm.props.onSubmit({preventDefault(){}});await tick();});
    assert(calls.some(x=>x.path==='/api/admin/entities/sellers'&&x.method==='POST'&&x.body.name==='Clara'&&x.body.storeId===store&&x.body.departmentId==='tech'));
    assert.equal(tree.root.findByProps({'aria-label':'Département du nouveau vendeur'}).props.value,'','un nouveau choix est exigé pour chaque création');
    await act(async()=>input.props.onChange({target:{value:'David'}}));
    await act(async()=>{addForm.props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(calls.filter(x=>x.path==='/api/admin/entities/sellers'&&x.method==='POST').length,1,'aucun vendeur supplémentaire sans choix explicite');
    const reset=tree.root.findAllByType('button').find(b=>text(b).includes('Réinitialiser l’accès'));
    assert(reset&&!reset.props.disabled);await act(async()=>{reset.props.onClick();await tick();});
    assert(calls.some(x=>x.path==='/api/admin/pin-reset'&&x.body.sellerId===1));
    assert.equal(calls.filter(x=>x.path==='/api/admin/sellers/delete'&&x.method==='POST').length,0);
  } finally {
    if(tree)await act(async()=>tree.unmount());
    for(const [name,value] of Object.entries(original))if(value===undefined)delete globalThis[name];else globalThis[name]=value;
  }
});

test('Magasins : ajout replié par défaut et formulaire conservé',async()=>{
  const keys=['window','document','sessionStorage','__adminTestApi'],prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const calls=[],store='magasin-test';
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>k==='pulse-admin-token'?'admin-token':null,setItem(){},removeItem(){}}});
  Object.defineProperty(globalThis,'__adminTestApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});
    if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
    return {ok:true};
  }});
  let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},session:{storeId:store,sellerId:1},data:{stores:[{id:store,name:'Fnac Test'}],services:[],today:'2026-10-26'}}));await tick();});
    await act(async()=>{tree.root.findAllByProps({role:'tab'}).find(x=>text(x)==='Magasins').props.onClick();await tick();});
    const disclosure=tree.root.findByProps({className:'admin-add-store'});
    assert.equal(disclosure.type,'details');assert.notEqual(disclosure.props.open,true,'le formulaire démarre fermé');
    assert.match(text(disclosure.findByType('summary')),/Ajouter un magasin/);
    assert.equal(calls.filter(x=>x.path==='/api/admin/stores'&&x.method==='POST').length,0,'aucun ajout à l’ouverture');
    const name=disclosure.findByProps({placeholder:'Ex. Fnac Bordeaux'}),lat=disclosure.findByProps({placeholder:'44.8399'}),lon=disclosure.findByProps({placeholder:'−0.5740'});
    assert.equal(name.props.required,true);
    await act(async()=>{name.props.onChange({target:{value:'Magasin fictif'}});lat.props.onChange({target:{value:'44.8'}});lon.props.onChange({target:{value:'-0.5'}});});
    await act(async()=>{disclosure.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    const posted=calls.filter(x=>x.path==='/api/admin/stores'&&x.method==='POST');
    assert.equal(posted.length,1);assert.deepEqual(posted[0].body,{name:'Magasin fictif',lat:'44.8',lon:'-0.5'});
    assert.equal(disclosure.findByProps({placeholder:'Ex. Fnac Bordeaux'}).props.value,'');
    assert.match(text(tree.toJSON()),/Magasin sélectionné : Fnac Test/);
  } finally {if(tree)await act(async()=>tree.unmount());for(const key of keys){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('Magasin administré : recherche, historique masqué, mémorisation et déconnexion sans toucher au profil vendeur',async()=>{
  const keys=['window','document','sessionStorage','__adminTestApi'],prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const saved=new Map([['pulse-admin-token','admin-token']]),seller={storeId:'historique',sellerId:41};
  const stores=[{id:'historique',name:'Ancienne Fnac',directoryStatus:'historical'},{id:'officiel',name:'Fnac Labège',directoryStatus:'official'},
    {id:'manuel',name:'Fnac Copie Test',directoryStatus:'manual'},{id:'ajout',name:'Magasin Ajouté'},
    {id:'region-cachee',name:'Région non sélectionnable',directoryStatus:'region'}];
  const props={onClose(){},onChanged(){},session:seller,data:{stores,services:[],today:'2026-11-03'}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true,matchMedia:()=>({matches:true})}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){},getElementById(){return null;}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)}});
  Object.defineProperty(globalThis,'__adminTestApi',{configurable:true,value:async(path)=>{
    if(path==='/api/admin/all')return {sellers:[{id:41,name:'Profil historique',storeId:'historique',active:true}],services:[],serviceOrders:{},departmentsByStore:{}};
    if(path.startsWith('/api/admin/counts'))return {counts:[]};return {ok:true};
  }});
  let tree;
  const tab=label=>tree.root.findAllByProps({role:'tab'}).find(x=>text(x)===label);
  const input=()=>tree.root.findByProps({'aria-label':'Magasin à gérer'});
  const search=async(value)=>act(async()=>{input().props.onChange({target:{value}});await tick();});
  const open=async()=>act(async()=>{tree=TestRenderer.create(React.createElement(Admin,props));await tick();});
  try {
    await open();assert.equal(tab('Magasins').props['aria-selected'],true,'le profil historique reste connecté, mais non proposé');
    assert.doesNotMatch(text(tree.toJSON()),/Annuaire des magasins|Vérifier maintenant|Importer manuellement une copie Fnac|Dernière vérification officielle/);
    await search('Ancienne');assert.equal(tree.root.findAllByProps({role:'option'}).length,0);
    await search('Copie');const option=tree.root.findByProps({role:'option'});assert.match(text(option),/Copie non vérifiée/);
    await act(async()=>{option.props.onClick();await tick();});assert.equal(saved.get('pulse-admin-managed-store-v1'),'manuel');
    assert.equal(seller.storeId,'historique');assert.match(text(tree.toJSON()),/Magasin sélectionné : Fnac Copie Test/);
    await act(async()=>tree.unmount());await open();assert.equal(tab('Ventes').props['aria-selected'],true);assert.match(text(tree.toJSON()),/Fnac Copie Test/);
    await act(async()=>{tab('Magasins').props.onClick();await tick();});
    await search('Labège');assert.match(text(tree.toJSON()),/Magasin toujours géré/);assert.equal(saved.get('pulse-admin-managed-store-v1'),'manuel','une recherche abandonnée ne change pas le magasin');
    await act(async()=>tree.unmount());await open();assert.match(text(tree.toJSON()),/Fnac Copie Test/);
    await act(async()=>{tab('Magasins').props.onClick();await tick();});await search('Labège');
    await act(async()=>{tree.root.findByProps({role:'option'}).props.onClick();await tick();});assert.equal(saved.get('pulse-admin-managed-store-v1'),'officiel');
    await act(async()=>{tab('Administrateurs').props.onClick();await tick();});
    await act(async()=>{tree.root.findAllByType('button').find(b=>text(b).includes('Se déconnecter')).props.onClick();await tick();});
    assert.equal(saved.has('pulse-admin-managed-store-v1'),false);assert.equal(saved.has('pulse-admin-token'),false);assert.deepEqual(seller,{storeId:'historique',sellerId:41});
    await act(async()=>tree.unmount());
    saved.set('pulse-admin-token','admin-token');saved.set('pulse-admin-managed-store-v1','historique');await open();
    assert.equal(saved.has('pulse-admin-managed-store-v1'),false,'une ancienne sélection non éligible est invalidée');assert.equal(tab('Magasins').props['aria-selected'],true);
  } finally {if(tree)await act(async()=>tree.unmount());for(const key of keys){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
