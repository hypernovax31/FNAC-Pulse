import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/SellerDelete.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'fake-api',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'mock',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=(...args)=>globalThis.__deleteTestApi(...args); export const uid=()=>"seller-interface-job-0001";`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {SellerDeletePanel}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const button=(tree,label)=>tree.root.findAllByType('button').find(item=>text(item).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function globals(api) {
  const priorApi=Object.getOwnPropertyDescriptor(globalThis,'__deleteTestApi'),priorStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),values=new Map();
  Object.defineProperty(globalThis,'__deleteTestApi',{configurable:true,writable:true,value:api});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,writable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  return {values,restore(){for(const [name,prior] of [['__deleteTestApi',priorApi],['sessionStorage',priorStorage]])if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];}};
}
const props={storeId:'magasin-test',storeName:'Fnac Test',token:'admin',disabled:false,departments:[{id:'tech',name:'Technique'}],sellers:[{id:1,name:'Alice',departmentId:'tech',active:true},{id:2,name:'Morgan',departmentId:'tech',active:false},{id:3,name:'En cours',departmentId:'tech',active:false,deletingJob:'existing-job'}]};
const idle={status:'idle',jobId:null,deletedSales:0};
async function choose(tree,id='2'){await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur à supprimer'}).props.onChange({target:{value:id}});});}
async function open(tree){await act(async()=>button(tree,'Supprimer ce vendeur').props.onClick());}
async function confirm(tree,value='SUPPRIMER'){await act(async()=>tree.root.findByProps({'aria-label':'Confirmation de suppression du vendeur'}).props.onChange({target:{value}}));}

test('Suppression vendeur : personne et magasin explicites, données détaillées, annulation et confirmation écrite',async()=>{
  const calls=[];let state=idle,updates=0;
  const g=globals(async(path,options={})=>{calls.push({path,...options});if(options.method==='POST')state={status:'done',jobId:options.body.jobId,deletedSales:8};return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerDeletePanel,{...props,onUpdate:()=>updates++}));await tick();});
    assert.equal(button(tree,'Supprimer ce vendeur').props.disabled,true);assert.equal(calls.filter(x=>x.method==='POST').length,0);
    const options=tree.root.findAllByType('option');assert(options.some(o=>text(o).includes('Morgan · Technique · archivé')));assert(!options.some(o=>text(o).includes('En cours')));
    await choose(tree);assert.equal(button(tree,'Supprimer ce vendeur').props.disabled,false);await open(tree);
    const copy=text(tree.toJSON());for(const fragment of ['Morgan','Fnac Test','Département : Technique','profil archivé','toutes ses ventes à toutes les dates','objectifs','jours travaillés','irréversible','bilans historiques','autres vendeurs'])assert(copy.toLowerCase().includes(fragment.toLowerCase()),fragment);
    assert.equal(button(tree,'Supprimer définitivement').props.disabled,true);await confirm(tree,'supprimer');assert.equal(button(tree,'Supprimer définitivement').props.disabled,true);
    await act(async()=>button(tree,'Annuler').props.onClick());assert.equal(calls.filter(x=>x.method==='POST').length,0);
    await open(tree);await confirm(tree);assert.equal(button(tree,'Supprimer définitivement').props.disabled,false);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    const post=calls.find(x=>x.method==='POST');assert.deepEqual(post.body,{storeId:'magasin-test',jobId:'seller-interface-job-0001',sellerId:2,expectedName:'Morgan',expectedDepartmentId:'tech',expectedStoreName:'Fnac Test',confirmation:'SUPPRIMER'});
    assert.match(text(tree.toJSON()),/Dernière suppression terminée : 8 opérations de vente effacées/);assert(updates>=1);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Suppression vendeur : réponse perdue, reprise du même vendeur avec le même identifiant',async()=>{
  const sent=[];let failure=true;
  const g=globals(async(_path,options={})=>{if(options.method!=='POST')return idle;sent.push(options.body);if(failure){failure=false;throw Error('réseau');}return {status:'running',jobId:options.body.jobId,sellerName:'Alice',deletedSales:0};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerDeletePanel,{...props,onUpdate:()=>{}}));await tick();});await choose(tree,'1');await open(tree);await confirm(tree);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert(button(tree,'Vérifier ou reprendre'));assert.equal(g.values.size,2);assert(g.values.has('fnac-pulse-seller-delete:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:seller-delete:magasin-test'),'seller-interface-job-0001');assert.equal(button(tree,'Supprimer ce vendeur').props.disabled,true);assert.match(text(tree.toJSON()),/Alice/);
    await act(async()=>{button(tree,'Vérifier ou reprendre').props.onClick();await tick();});assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(g.values.size,1);assert(!g.values.has('fnac-pulse-seller-delete:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:seller-delete:magasin-test'),sent[0].jobId);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Suppression vendeur : état inconnu ou traitement en cours interdit une nouvelle demande',async()=>{
  let state='error',posts=0;
  const g=globals(async(_path,options={})=>{if(options.method==='POST')posts++;if(state==='error')throw Error('réseau');return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerDeletePanel,{...props,onUpdate:()=>{}}));await tick();});await choose(tree,'1');
    assert.equal(button(tree,'Supprimer ce vendeur').props.disabled,true);assert.match(text(tree.toJSON()),/Impossible de vérifier/);
    state={status:'running',jobId:'autre-admin-job',sellerName:'Alice',deletedSales:3};
    await act(async()=>{button(tree,'Vérifier').props.onClick();await tick();});
    assert.equal(button(tree,'Supprimer ce vendeur').props.disabled,true);assert.match(text(tree.toJSON()),/Suppression de Alice en cours/);assert.equal(posts,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});


test('Suppression vendeur : la confirmation garde le profil affiché et rafraîchit après un conflit',async()=>{
  let sent,updates=0;
  const g=globals(async(_path,options={})=>{if(options.method!=='POST')return idle;sent=options.body;const e=new Error('Le nom ou le département du vendeur a changé.');e.status=409;throw e;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerDeletePanel,{...props,onUpdate:()=>updates++}));await tick();});
    await choose(tree,'1');await open(tree);
    const changed={...props,storeName:'Magasin renommé',sellers:props.sellers.map(s=>s.id===1?{...s,name:'Nom changé',departmentId:'editorial'}:s)};
    await act(async()=>tree.update(React.createElement(SellerDeletePanel,{...changed,onUpdate:()=>updates++})));
    assert.match(text(tree.toJSON()),/Supprimer Alice de Fnac Test/);await confirm(tree);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(sent.expectedName,'Alice');assert.equal(sent.expectedDepartmentId,'tech');assert.equal(sent.expectedStoreName,'Fnac Test');assert.match(text(tree.toJSON()),/a changé/);assert(updates>=1);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});
