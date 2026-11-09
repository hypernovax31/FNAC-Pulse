import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const output=await build({entryPoints:['src/SalesReset.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'api-fictive',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'fake-api',namespace:'fake-api'}));
  b.onLoad({filter:/.*/,namespace:'fake-api'},()=>({contents:`export function api(...args){return globalThis.__salesResetTestApi(...args)};export function uid(){return 'test-reset-request-0001'}`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const {SalesResetPanel}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const findButton=(tree,label)=>tree.root.findAllByType('button').find(button=>text(button).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function globals(api) {
  const priorApi=Object.getOwnPropertyDescriptor(globalThis,'__salesResetTestApi'),priorStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),values=new Map();
  Object.defineProperty(globalThis,'__salesResetTestApi',{configurable:true,writable:true,value:api});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,writable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  return {values,restore(){for(const [name,prior] of [['__salesResetTestApi',priorApi],['sessionStorage',priorStorage]])if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];}};
}
const props={storeId:'magasin-test',storeName:'Fnac Test',token:'admin-test',disabled:false};

test('Interface reset : annulation et confirmation écrite avant toute suppression',async()=>{
  const calls=[];let updated=0,state={status:'idle',jobId:null,deletedSales:0};
  const g=globals(async(path,options={})=>{calls.push({path,...options});if(options.method==='POST')state={status:'done',jobId:options.body.jobId,deletedSales:5};return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesResetPanel,{...props,onUpdate:()=>updated++}));await tick();});
    assert.equal(calls.filter(c=>c.method==='POST').length,0);assert.equal(findButton(tree,'Reset global').props.disabled,false);
    await act(async()=>{findButton(tree,'Reset global').props.onClick();});
    assert.match(text(tree.toJSON()),/Fnac Test/);assert.match(text(tree.toJSON()),/irréversible/);assert.match(text(tree.toJSON()),/toutes les dates/);
    assert.equal(findButton(tree,'Supprimer toutes les ventes').props.disabled,true);
    await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset'}).props.onChange({target:{value:'oui'}});});
    assert.equal(findButton(tree,'Supprimer toutes les ventes').props.disabled,true);
    await act(async()=>{findButton(tree,'Annuler').props.onClick();});assert.equal(calls.filter(c=>c.method==='POST').length,0);
    await act(async()=>{findButton(tree,'Reset global').props.onClick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset'}).props.onChange({target:{value:'SUPPRIMER'}});});
    assert.equal(findButton(tree,'Supprimer toutes les ventes').props.disabled,false);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    const sent=calls.filter(c=>c.method==='POST');assert.equal(sent.length,1);
    assert.deepEqual(sent[0].body,{storeId:'magasin-test',jobId:'test-reset-request-0001',confirmation:'SUPPRIMER'});
    assert.match(text(tree.toJSON()),/Dernier reset terminé : 5 ventes supprimées/);
    assert(updated>=1);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset : réponse perdue, reprise avec le même identifiant',async()=>{
  const sent=[];let fail=true;
  const g=globals(async(path,options={})=>{
    if(options.method!=='POST')return {status:'idle',jobId:null,deletedSales:0};
    sent.push(options.body);if(fail){fail=false;throw Error('réseau');}return {status:'done',jobId:options.body.jobId,deletedSales:2};
  });let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesResetPanel,{...props,onUpdate:()=>{}}));await tick();});
    await act(async()=>{findButton(tree,'Reset global').props.onClick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset'}).props.onChange({target:{value:'SUPPRIMER'}});});
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert(findButton(tree,'Vérifier ou reprendre'));assert.equal(g.values.size,2);assert(g.values.has('fnac-pulse-sales-reset:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:sales-reset:magasin-test'),'test-reset-request-0001');assert.equal(findButton(tree,'Reset global').props.disabled,true);
    await act(async()=>{findButton(tree,'Vérifier ou reprendre').props.onClick();await tick();});
    assert.equal(sent.length,2);assert.equal(sent[0].jobId,sent[1].jobId);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset : refus explicite 409 ne lance pas un second reset en arrière-plan',async()=>{
  let posts=0;
  const g=globals(async(path,options={})=>{
    if(options.method==='POST'){posts++;const error=new Error('Un autre reset est déjà en cours.');error.status=409;throw error;}
    return {status:'idle',jobId:null,deletedSales:0};
  });let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesResetPanel,{...props,onUpdate:()=>{}}));await tick();});
    await act(async()=>{findButton(tree,'Reset global').props.onClick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Confirmation du reset'}).props.onChange({target:{value:'SUPPRIMER'}});});
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(posts,1);assert.equal(g.values.size,0);assert.equal(findButton(tree,'Vérifier ou reprendre'),undefined);
    assert.match(text(tree.toJSON()),/Un autre reset est déjà en cours/);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Interface reset : suivi d’une suppression asynchrone et réactivation après la fin',async()=>{
  let state={status:'running',jobId:'job-en-cours',deletedSales:7},updates=0;
  const g=globals(async()=>state);let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesResetPanel,{...props,onUpdate:()=>updates++}));await tick();});
    assert.equal(findButton(tree,'Reset global').props.disabled,true);assert.match(text(tree.toJSON()),/Suppression en cours : 7 ventes supprimées/);
    state={status:'done',jobId:'job-en-cours',deletedSales:20};
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3200));});
    assert.match(text(tree.toJSON()),/Dernier reset terminé : 20 ventes supprimées/);
    assert.equal(findButton(tree,'Reset global').props.disabled,false);assert(updates>=1);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});
