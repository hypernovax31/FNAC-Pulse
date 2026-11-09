import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/ServiceDelete.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'fake-api',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'mock',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=(...args)=>globalThis.__serviceDeleteApi(...args); export const uid=()=>"service-interface-job-0001";`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {ServiceDeletePanel}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const button=(tree,label)=>tree.root.findAllByType('button').find(item=>text(item).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function globals(api) {
  const priorApi=Object.getOwnPropertyDescriptor(globalThis,'__serviceDeleteApi'),priorStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),values=new Map();
  Object.defineProperty(globalThis,'__serviceDeleteApi',{configurable:true,writable:true,value:api});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,writable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  return {values,restore(){for(const [name,prior] of [['__serviceDeleteApi',priorApi],['sessionStorage',priorStorage]])if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name];}};
}
const idle={status:'idle',jobId:null,deletedSales:0,deletedGoals:0};
const base={storeId:'magasin-test',storeName:'Fnac Test',token:'admin',disabled:false,onRequestHandled:()=>{}};
const target={id:2,name:'Garantie',storeName:'Fnac Test'};
async function request(tree,props=base){await act(async()=>tree.update(React.createElement(ServiceDeletePanel,{...props,requested:null})));await act(async()=>tree.update(React.createElement(ServiceDeletePanel,{...props,requested:target})));}
async function confirm(tree,value='SUPPRIMER'){await act(async()=>tree.root.findByProps({'aria-label':'Confirmation de suppression du service'}).props.onChange({target:{value}}));}

test('Suppression service : corbeille, portée, historique, annulation et confirmation écrite',async()=>{
  const calls=[],availability=[];let state=idle,updates=0;
  const g=globals(async(path,options={})=>{calls.push({path,...options});if(options.method==='POST')state={status:'done',jobId:options.body.jobId,serviceName:'Garantie',deletedSales:8,deletedGoals:3};return state;});let tree;
  const props={...base,onAvailabilityChange:x=>availability.push(x),onUpdate:()=>updates++};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(ServiceDeletePanel,props));await tick();});
    assert.equal(availability.at(-1),true);assert.equal(calls.filter(x=>x.method==='POST').length,0);await request(tree,props);
    const copy=text(tree.toJSON());for(const fragment of ['Garantie','Fnac Test','toutes les ventes','toutes les dates','tous les vendeurs et départements','objectifs','bilans historiques','autres magasins','ne seront pas récupérés'].slice(0,-1))assert(copy.toLowerCase().includes(fragment.toLowerCase()),fragment);
    assert.match(copy,/données effacées ne reviendront pas/);assert.equal(button(tree,'Supprimer définitivement').props.disabled,true);
    await confirm(tree,'supprimer');assert.equal(button(tree,'Supprimer définitivement').props.disabled,true);
    await act(async()=>button(tree,'Annuler').props.onClick());assert.equal(calls.filter(x=>x.method==='POST').length,0);
    await request(tree,props);await confirm(tree);assert.equal(button(tree,'Supprimer définitivement').props.disabled,false);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    const post=calls.find(x=>x.method==='POST');assert.deepEqual(post.body,{storeId:'magasin-test',jobId:'service-interface-job-0001',serviceId:2,expectedName:'Garantie',expectedStoreName:'Fnac Test',confirmation:'SUPPRIMER'});
    assert.match(text(tree.toJSON()),/Dernière suppression terminée : Garantie/);assert(updates>=1);assert.equal(g.values.size,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Suppression service : réponse perdue, reprise de la même demande sans nouvel identifiant',async()=>{
  const sent=[];let failure=true;
  const g=globals(async(_path,options={})=>{if(options.method!=='POST')return idle;sent.push(options.body);if(failure){failure=false;throw Error('réseau');}return {status:'running',jobId:options.body.jobId,serviceName:'Garantie',deletedSales:0,deletedGoals:0};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(ServiceDeletePanel,{...base,onUpdate:()=>{}}));await tick();});await request(tree);await confirm(tree);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert(button(tree,'Vérifier ou reprendre'));assert.equal(g.values.size,2);assert(g.values.has('fnac-pulse-service-delete:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:service-delete:magasin-test'),'service-interface-job-0001');assert.match(text(tree.toJSON()),/Garantie/);
    await act(async()=>{button(tree,'Vérifier ou reprendre').props.onClick();await tick();});assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(g.values.size,1);assert(!g.values.has('fnac-pulse-service-delete:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:service-delete:magasin-test'),sent[0].jobId);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Suppression service : état incertain, en cours ou à vérifier bloque la corbeille',async()=>{
  const availability=[];let state='error',posts=0;
  const g=globals(async(_path,options={})=>{if(options.method==='POST')posts++;if(state==='error')throw Error('réseau');return state;});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(ServiceDeletePanel,{...base,onAvailabilityChange:x=>availability.push(x)}));await tick();});
    assert.equal(availability.at(-1),false);assert.match(text(tree.toJSON()),/Impossible de vérifier/);
    state={status:'running',jobId:'service-existing-job',serviceName:'Garantie',deletedSales:3,deletedGoals:1};
    await act(async()=>{button(tree,'Vérifier').props.onClick();await tick();});assert.equal(availability.at(-1),false);assert.match(text(tree.toJSON()),/Suppression de Garantie en cours/);
    state={status:'needs-review',jobId:'service-existing-job',serviceName:'Garantie',deletedSales:3,deletedGoals:1,skippedGoals:1};
    // Une actualisation recrée l'effet de surveillance et ne permet pas de masquer l'anomalie.
    await act(async()=>{tree.unmount();tree=TestRenderer.create(React.createElement(ServiceDeletePanel,{...base,onAvailabilityChange:x=>availability.push(x)}));await tick();});
    assert.equal(availability.at(-1),false);assert.match(text(tree.toJSON()),/nécessite une vérification technique/);assert.equal(posts,0);
  } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
});

test('Suppression service : délai ou limitation intermédiaire conservent la demande incertaine',async()=>{
  for(const status of [408,429]) {
    const sent=[];const g=globals(async(_path,options={})=>{if(options.method!=='POST')return idle;sent.push(options.body);const error=Error('intermédiaire');error.status=status;throw error;});let tree;
    try {
      await act(async()=>{tree=TestRenderer.create(React.createElement(ServiceDeletePanel,base));await tick();});await request(tree);await confirm(tree);
      await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
      assert(button(tree,'Vérifier ou reprendre'));assert.equal(g.values.size,2);assert(g.values.has('fnac-pulse-service-delete:magasin-test'));assert.equal(g.values.get('fnac-pulse-feedback-job:service-delete:magasin-test'),'service-interface-job-0001');
      await act(async()=>{button(tree,'Vérifier ou reprendre').props.onClick();await tick();});assert.deepEqual(sent[0],sent[1]);
    } finally {if(tree)await act(async()=>tree.unmount());g.restore();}
  }
});
