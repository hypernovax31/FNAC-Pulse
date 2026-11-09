import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const output=await build({entryPoints:['src/GoalsReset.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'api-fictive',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'fake-api',namespace:'fake-api'}));
  b.onLoad({filter:/.*/,namespace:'fake-api'},()=>({contents:`export function api(...args){return globalThis.__goalsResetTestApi(...args)};export function uid(){return 'test-goals-reset-0001'}`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const {GoalsResetPanel}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const button=(tree,label)=>tree.root.findAllByType('button').find(item=>text(item).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function globals(api) {
  const priorApi=Object.getOwnPropertyDescriptor(globalThis,'__goalsResetTestApi'),priorStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),values=new Map();
  Object.defineProperty(globalThis,'__goalsResetTestApi',{configurable:true,writable:true,value:api});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,writable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  return {values,restore(){for(const [name,prior] of [['__goalsResetTestApi',priorApi],['sessionStorage',priorStorage]])if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];}};
}
const props={storeId:'magasin-test',storeName:'Fnac Test',token:'admin-test',disabled:false,departments:[{id:'tech',name:'Produits Techniques',active:true},{id:'editorial',name:'Produits Éditoriaux',active:true},{id:'ancien',name:'Ancien département',active:false}]};
const idle={status:'idle',jobId:null,departmentId:null,totalSellers:0,processedSellers:0};
async function choose(tree,id='tech'){await act(async()=>{tree.root.findByProps({'aria-label':'Département à réinitialiser'}).props.onChange({target:{value:id}});});}
async function open(tree){await act(async()=>{button(tree,'Reset global').props.onClick();});}
async function confirm(tree){await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset des objectifs'}).props.onChange({target:{value:'SUPPRIMER'}});});}

test('Interface reset objectifs : magasin et département explicites, annulation et confirmation écrite',async()=>{
  const calls=[];let updates=0,state=idle;
  const g=globals(async(path,options={})=>{calls.push({path,...options});if(options.method==='POST')state={status:'done',jobId:options.body.jobId,departmentId:options.body.departmentId,departmentName:'Produits Techniques',totalSellers:3,processedSellers:3,resetSellers:2};return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsResetPanel,{...props,onUpdate:()=>updates++}));await tick();});
    assert.equal(calls.filter(x=>x.method==='POST').length,0);assert.equal(button(tree,'Reset global').props.disabled,true);
    const options=tree.root.findAllByType('option');assert(options.some(x=>text(x).includes('Ancien département · archivé')));
    await choose(tree);assert.equal(button(tree,'Reset global').props.disabled,false);await open(tree);
    const content=text(tree.toJSON());assert.match(content,/Fnac Test/);assert.match(content,/Produits Techniques/);assert.match(content,/vendeurs archivés/);assert.match(content,/jour, la semaine et le mois/);assert.match(content,/irréversible/);assert.match(content,/ventes, services, vendeurs, plannings/);
    assert.equal(tree.root.findByProps({'aria-label':'Département à réinitialiser'}).props.disabled,true);
    assert.equal(button(tree,'Supprimer les objectifs').props.disabled,true);
    await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset des objectifs'}).props.onChange({target:{value:'oui'}});});assert.equal(button(tree,'Supprimer les objectifs').props.disabled,true);
    await act(async()=>button(tree,'Annuler').props.onClick());assert.equal(calls.filter(x=>x.method==='POST').length,0);
    await open(tree);await confirm(tree);assert.equal(button(tree,'Supprimer les objectifs').props.disabled,false);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    const posts=calls.filter(x=>x.method==='POST');assert.equal(posts.length,1);
    assert.deepEqual(posts[0].body,{storeId:'magasin-test',departmentId:'tech',jobId:'test-goals-reset-0001',confirmation:'SUPPRIMER'});
    assert.match(text(tree.toJSON()),/Dernier reset terminé pour Produits Techniques : 3 vendeurs traités/);assert(updates>=1);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset objectifs : réponse perdue, même département et même identifiant à la reprise',async()=>{
  const sent=[];let failure=true;
  const g=globals(async(path,options={})=>{if(options.method!=='POST')return idle;sent.push(options.body);if(failure){failure=false;throw Error('réseau');}return {status:'done',jobId:options.body.jobId,departmentId:options.body.departmentId,departmentName:'Produits Éditoriaux',totalSellers:2,processedSellers:2};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsResetPanel,{...props,onUpdate:()=>{}}));await tick();});await choose(tree,'editorial');await open(tree);await confirm(tree);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert(button(tree,'Vérifier ou reprendre'));assert.equal(g.values.size,2);assert(g.values.has('fnac-pulse-goals-reset:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:goals-reset:magasin-test'),'test-goals-reset-0001');assert.equal(button(tree,'Reset global').props.disabled,true);
    assert.match(text(tree.toJSON()),/Produits Éditoriaux/);
    await act(async()=>{button(tree,'Vérifier ou reprendre').props.onClick();await tick();});
    assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(sent[1].departmentId,'editorial');assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset objectifs : état inconnu et reset en cours empêchent le lancement',async()=>{
  let state='error',updates=0,posts=0;
  const g=globals(async(path,options={})=>{if(options.method==='POST')posts++;if(state==='error')throw Error('hors ligne');return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsResetPanel,{...props,onUpdate:()=>updates++}));await tick();});await choose(tree);
    assert.equal(button(tree,'Reset global').props.disabled,true);assert.match(text(tree.toJSON()),/Impossible de vérifier/);assert.equal(posts,0);
    state={status:'running',jobId:'autre-admin-job',departmentId:'editorial',departmentName:'Produits Éditoriaux',processedSellers:3,totalSellers:12};
    await act(async()=>{button(tree,'Vérifier').props.onClick();await tick();});
    assert.equal(button(tree,'Reset global').props.disabled,true);assert.match(text(tree.toJSON()),/Produits Éditoriaux : 3 \/ 12 vendeurs traités/);
    state={...state,status:'done',processedSellers:12};await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3200));});
    assert.match(text(tree.toJSON()),/Dernier reset terminé/);assert.equal(button(tree,'Reset global').props.disabled,false);assert(updates>=1);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset objectifs : refus 409 ne redémarre aucune suppression',async()=>{
  let posts=0;
  const g=globals(async(path,options={})=>{if(options.method==='POST'){posts++;const error=new Error('Un autre reset est déjà en cours.');error.status=409;throw error;}return idle;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(GoalsResetPanel,{...props,onUpdate:()=>{}}));await tick();});await choose(tree);await open(tree);await confirm(tree);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(posts,1);assert.equal(g.values.size,0);assert.equal(button(tree,'Vérifier ou reprendre'),undefined);assert.match(text(tree.toJSON()),/Un autre reset/);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});
