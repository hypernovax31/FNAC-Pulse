import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/Admin.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...args)=>globalThis.__autosaveAdminApi(...args);export const uid=()=>"fixture-job-00001";export const dateLabel=x=>x;export const timeLabel=x=>x;`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`export const CLOUD=false,ADMIN_SESSION='admin';export const adminLogin=()=>{},adminLogout=()=>{},claimAdminAccess=()=>{},requestAdminPasswordReset=()=>{},registerAdminForApproval=()=>{},deleteTestFirebaseAccount=()=>{},changeAdminPassword=()=>{},adminAccountEmail=async()=>"admin@example.test",createAdministrator=()=>{},createDirectAdministrator=()=>{},createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=()=>{},changeFirstCodeAdminPassword=()=>{},inviteAdministrator=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{},requestAdminEmailChange=()=>{},inspectAdminEmailChange=()=>{},confirmAdminEmailChange=()=>{},resendAdminVerification=()=>{};`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);const Admin=module.exports.default;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children),tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('Administration : attente des écritures avant onglet, vendeur et fermeture ; noms et planning protégés',async()=>{
  const keys=['window','document','sessionStorage','__autosaveAdminApi'],prior=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const store='magasin-test',goalRequest=defer(),daysRequest=defer(),nameRequest=defer(),calls=[];let closes=0,tree;
  const all={sellers:[{id:1,name:'Alice',storeId:store,departmentId:'tech',active:true},{id:2,name:'Benoît',storeId:store,departmentId:'tech',active:true}],services:[{id:1,name:'DMax',active:true}],serviceOrders:{},departmentsByStore:{}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true,addEventListener(){},removeEventListener(){}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){},getElementById(){return null;}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>k==='pulse-admin-token'?'test-admin':null,setItem(){},removeItem(){}}});
  Object.defineProperty(globalThis,'__autosaveAdminApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});
    if(path==='/api/admin/all')return structuredClone(all);
    if(path.startsWith('/api/admin/counts'))return {counts:[]};
    if(path.startsWith('/api/admin/goals?'))return {goals:{s1:{day:null,week:null,month:30,revision:'goal-rev-001'}},workdays:[1,2,3,4,5],workdaysRevision:'days-rev-001'};
    if(path==='/api/admin/goals'&&options.method==='POST')return goalRequest.promise;
    if(path==='/api/admin/workdays')return daysRequest.promise;
    if(path==='/api/admin/entities/services/1'&&options.method==='PATCH')return nameRequest.promise;
    if(path==='/api/admin/departments/tech'&&options.method==='PATCH')return {ok:true};
    if(path.includes('/reset?')||path.includes('/delete?'))return {status:'idle',jobId:null,deletedSales:0};
    return {ok:true};
  }});
  const props={onClose:()=>closes++,onChanged(){},session:{storeId:store,sellerId:1},data:{stores:[{id:store,name:'Fnac Test'}],services:all.services,today:'2026-10-26'}};
  const tab=name=>tree.root.findAllByProps({role:'tab'}).find(x=>text(x)===name);
  const openTab=async name=>act(async()=>{tab(name).props.onClick();await tick();});
  const action=label=>tree.root.findAllByType('button').find(x=>x.props['aria-label']===label);
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,props));await tick();});
    await openTab('Objectifs');
    const goal=()=>tree.root.findByProps({'aria-label':'Cible de référence'});
    assert.equal(goal().props.value,'30');assert(!tree.root.findAllByType('button').some(x=>text(x)==='Enregistrer'));
    await act(async()=>goal().props.onChange({target:{value:'44'}}));
    await act(async()=>{tab('Vendeurs').props.onClick();await tick();});
    assert(tab('Objectifs').props['aria-selected']);assert.equal(calls.filter(x=>x.path==='/api/admin/goals'&&x.method==='POST').length,1);
    const savedGoal=calls.find(x=>x.path==='/api/admin/goals'&&x.method==='POST');assert.equal(savedGoal.body.sellerId,1);assert.equal(savedGoal.body.storeId,store);assert.equal(savedGoal.body.revision,'goal-rev-001');assert.equal(savedGoal.body.values.month,44);
    await act(async()=>{goalRequest.resolve({goals:{s1:{day:null,week:null,month:44,minimum:{period:'month',amount:44},revision:'goal-rev-002'}},workdays:[1,2,3,4,5]});await tick();});
    assert(tab('Vendeurs').props['aria-selected']);
    const alice=()=>tree.root.findAllByType('article').find(x=>text(x).includes('Alice'));
    await act(async()=>{alice().findAllByType('button').find(x=>text(x).includes('Jours travaillés')).props.onClick();await tick();});
    const day=label=>alice().findAllByType('label').find(x=>text(x).includes(label)).findByType('input');
    await act(async()=>day('Dimanche').props.onChange());
    await act(async()=>{tab('Services').props.onClick();await tick();});
    assert(tab('Vendeurs').props['aria-selected']);const savedDays=calls.find(x=>x.path==='/api/admin/workdays');assert.deepEqual(savedDays.body.workdays,[1,2,3,4,5,0]);assert.equal(savedDays.body.sellerId,1);assert.equal(savedDays.body.revision,'days-rev-001');
    await act(async()=>{daysRequest.resolve({workdays:[1,2,3,4,5,0],workdaysRevision:'days-rev-002'});await tick();});assert(tab('Services').props['aria-selected']);
    await act(async()=>{action('Modifier DMax').props.onClick();await tick();});
    await act(async()=>tree.root.findByProps({'aria-label':'Nouveau nom de DMax'}).props.onChange({target:{value:'DMax plus'}}));
    await act(async()=>{tab('Départements').props.onClick();await tick();});
    assert(tab('Services').props['aria-selected']);const renamed=calls.find(x=>x.path==='/api/admin/entities/services/1');assert.deepEqual(renamed.body,{name:'DMax plus',expectedName:'DMax'});
    await act(async()=>{nameRequest.resolve({ok:true});await tick();});assert(tab('Départements').props['aria-selected']);
    // Même sans tableau explicite dans le catalogue, les départements par défaut restent présents.
    await act(async()=>{action('Modifier Produits Techniques').props.onClick();await tick();});
    await act(async()=>tree.root.findByProps({'aria-label':'Nouveau nom de Produits Techniques'}).props.onChange({target:{value:'Technique renommée'}}));
    await act(async()=>{tree.root.findByProps({className:'edit-entity autosave-name'}).props.onSubmit({preventDefault(){}});await tick();});
    assert.deepEqual(calls.find(x=>x.path==='/api/admin/departments/tech').body,{name:'Technique renommée',expectedName:'Produits Techniques',storeId:store});
    assert.match(text(tree.toJSON()),/Technique renommée/);assert.match(text(tree.toJSON()),/Produits Éditoriaux/);assert.match(text(tree.toJSON()),/Caisse\/Adhésion/);
    await act(async()=>{action('Modifier Technique renommée').props.onClick();await tick();});
    await act(async()=>tree.root.findByProps({'aria-label':'Nouveau nom de Technique renommée'}).props.onChange({target:{value:''}}));
    await act(async()=>{action('Fermer').props.onClick();await tick();});assert.equal(closes,0);assert.match(text(tree.toJSON()),/Saisissez un nom/);
    await act(async()=>tree.root.findAllByType('button').find(x=>text(x).includes('Annuler la saisie non enregistrée')).props.onClick());
    await act(async()=>{action('Fermer').props.onClick();await tick();});assert.equal(closes,1);
  } finally {if(tree)await act(async()=>tree.unmount());for(const key of keys){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];}}
});

test('Objectifs admin : retour au panneau actualise la hausse vendeur, sans modifier son minimum',async()=>{
  const keys=['window','document','sessionStorage','__autosaveAdminApi'],prior=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const events=new Map();let amount=20,tree,reads=0,writes=0;
  const store='magasin-test';
  const all={sellers:[{id:1,name:'Alice',storeId:store,departmentId:'tech',active:true}],services:[{id:1,name:'DMax',active:true}],serviceOrders:{},departmentsByStore:{}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:()=>true,addEventListener(k,fn){if(k==='focus')events.set(k,fn);},removeEventListener(k){events.delete(k);}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',body:{style:{}},activeElement:null,addEventListener(){},removeEventListener(){},getElementById(){return null;}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>k==='pulse-admin-token'?'test-admin':null,setItem(){},removeItem(){}}});
  Object.defineProperty(globalThis,'__autosaveAdminApi',{configurable:true,value:async(path,options={})=>{
    if(options.method&&options.method!=='GET')writes++;
    if(path==='/api/admin/all')return all;
    if(path.startsWith('/api/admin/goals?')){reads++;return {goals:{s1:{month:amount,day:null,week:null,minimum:{period:'month',amount:20},personal:{period:'month',amount},revision:`revision-${amount}`}},workdays:[1,2,3,4,5]};}
    return {status:'idle',jobId:null};
  }});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},session:{storeId:store,sellerId:1},data:{stores:[{id:store,name:'Fnac Test'}],services:all.services,today:'2026-10-26'}}));await tick();});
    await act(async()=>{tree.root.findAllByProps({role:'tab'}).find(x=>text(x)==='Objectifs').props.onClick();await tick();});
    assert.equal(reads,1);
    amount=35;
    await act(async()=>{events.get('focus')();await tick();});
    assert.equal(reads,2);assert.equal(writes,0);
    assert.match(text(tree.root.findByProps({'aria-label':'Objectif actuel du vendeur'})),/35 par mois/);
    assert.equal(tree.root.findByProps({'aria-label':'Cible de référence'}).props.value,'20');
  } finally {if(tree)await act(async()=>tree.unmount());for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
});
