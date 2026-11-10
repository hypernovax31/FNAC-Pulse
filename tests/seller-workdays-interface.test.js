import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/SellerWorkdays.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'workdays-mock',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__workdaysApi(...x);`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {SellerWorkdays}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const button=(tree,label)=>tree.root.findAllByType('button').find(b=>text(b).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const seller={id:1,name:'Alice',active:true};
const props={seller,storeId:'store-1',token:'admin',open:true,onToggle(){},disabled:false,onBusy(){},onChanged(){}};
function dayInput(tree,name) {return tree.root.findAllByType('label').find(l=>text(l).includes(name)).findByType('input');}

test('Planning vendeur : chargement, erreur, réessai et vendeur archivé',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__workdaysApi'),request=defer(),calls=[];let tree;
  Object.defineProperty(globalThis,'__workdaysApi',{configurable:true,value:(path,options)=>{calls.push({path,options});return calls.length===1?request.promise:Promise.resolve({workdays:[1,2,3,4,5],workdaysRevision:'r1'});}});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerWorkdays,props));await tick();});
    assert.match(text(tree.toJSON()),/Chargement des jours/);assert.equal(calls.length,1);assert(calls[0].options.signal);
    await act(async()=>{request.reject(Error('Hors ligne'));await tick();});assert.match(text(tree.toJSON()),/Hors ligne/);
    await act(async()=>{button(tree,'Réessayer').props.onClick();await tick();});assert.equal(calls.length,2);assert.equal(tree.root.findAllByType('input').length,7);
    await act(async()=>{tree.update(React.createElement(SellerWorkdays,{...props,seller:{...seller,active:false}}));await tick();});
    assert.equal(tree.root.findAllByType('input').length,0);assert(button(tree,'Jours travaillés').props.disabled);assert.match(text(tree.toJSON()),/Réactiver le vendeur/);
  } finally {if(tree)await act(async()=>tree.unmount());if(previous)Object.defineProperty(globalThis,'__workdaysApi',previous);else delete globalThis.__workdaysApi;}
});

test('Planning vendeur : conflit 409, rechargement explicite et révision fraîche',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__workdaysApi'),calls=[],busy=[];let gets=0,posts=0,changes=0,tree;
  Object.defineProperty(globalThis,'__workdaysApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});
    if(options.method==='POST') {posts++;if(posts===1)throw Object.assign(Error('Modifié par un autre appareil'),{status:409});return {workdays:options.body.workdays,workdaysRevision:'r3'};}
    gets++;return gets===1?{workdays:[1,2,3,4,5],workdaysRevision:'r1'}:{workdays:[1,2,3,4,5,6],workdaysRevision:'r2'};
  }});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerWorkdays,{...props,onBusy:x=>busy.push(x),onChanged:()=>changes++}));await tick();});
    await act(async()=>dayInput(tree,'Dimanche').props.onChange());
    await act(async()=>{tree.root.findByProps({className:'workdays-form'}).props.onSubmit({preventDefault(){}});await tick();});
    assert.match(text(tree.toJSON()),/Ces jours ont été modifiés ailleurs/);assert(!button(tree,'Enregistrer les jours')); assert.equal(calls.find(x=>x.method==='POST').body.revision,'r1');
    await act(async()=>button(tree,'Recharger les valeurs').props.onClick());assert.equal(dayInput(tree,'Samedi').props.checked,true);assert.equal(dayInput(tree,'Dimanche').props.checked,false);
    await act(async()=>dayInput(tree,'Dimanche').props.onChange());
    await act(async()=>{tree.root.findByProps({className:'workdays-form'}).props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(calls.filter(x=>x.method==='POST')[1].body.revision,'r2');assert.match(text(tree.toJSON()),/Jours travaillés enregistrés/);assert.equal(changes,1);assert.deepEqual(busy,[true,false,true,false]);
  } finally {if(tree)await act(async()=>tree.unmount());if(previous)Object.defineProperty(globalThis,'__workdaysApi',previous);else delete globalThis.__workdaysApi;}
});

test('Planning vendeur : changements rapides de vendeur et magasin sans données périmées',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__workdaysApi'),first=defer(),calls=[];let tree;
  Object.defineProperty(globalThis,'__workdaysApi',{configurable:true,value:(path,options={})=>{calls.push({path,options});return path.includes('store-1')?first.promise:Promise.resolve({workdays:[0],workdaysRevision:'store-2'});}});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SellerWorkdays,props));await tick();});
    await act(async()=>{tree.update(React.createElement(SellerWorkdays,{...props,storeId:'store-2',seller:{id:2,name:'Benoît',active:true}}));await tick();});
    assert.equal(calls[0].options.signal.aborted,true);assert.equal(dayInput(tree,'Dimanche').props.checked,true);assert.equal(dayInput(tree,'Lundi').props.checked,false);
    await act(async()=>{first.resolve({workdays:[1,2,3,4,5],workdaysRevision:'stale'});await tick();});assert.equal(dayInput(tree,'Dimanche').props.checked,true);assert.equal(dayInput(tree,'Lundi').props.checked,false);
    await act(async()=>{tree.update(React.createElement(SellerWorkdays,{...props,storeId:'store-2',seller:{id:2,name:'Benoît',active:true},open:false}));await tick();});assert.equal(tree.root.findAllByType('input').length,0);
  } finally {if(tree)await act(async()=>tree.unmount());if(previous)Object.defineProperty(globalThis,'__workdaysApi',previous);else delete globalThis.__workdaysApi;}
});

test('Planning vendeur : titres accessibles uniques si plusieurs formulaires sont montés',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__workdaysApi');let tree;
  Object.defineProperty(globalThis,'__workdaysApi',{configurable:true,value:async()=>({workdays:[1],workdaysRevision:'r'})});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(React.Fragment,null,
      React.createElement(SellerWorkdays,{...props,key:'one'}),React.createElement(SellerWorkdays,{...props,seller:{id:2,name:'Benoît',active:true},key:'two'})));await tick();});
    const forms=tree.root.findAllByProps({className:'workdays-form'});assert.equal(forms.length,2);
    const ids=forms.map(form=>form.props['aria-labelledby']);assert.equal(new Set(ids).size,2);forms.forEach((form,i)=>assert.equal(form.findByType('h4').props.id,ids[i]));
  } finally {if(tree)await act(async()=>tree.unmount());if(previous)Object.defineProperty(globalThis,'__workdaysApi',previous);else delete globalThis.__workdaysApi;}
});
