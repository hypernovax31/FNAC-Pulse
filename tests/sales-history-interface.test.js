import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/SalesHistory.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'history-mock',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'fake'}));
  b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`export const api=(...args)=>globalThis.__historyApi(...args);export const uid=()=>"history-correction-0001";export const dateLabel=x=>x;export const timeLabel=()=>"14:00";`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {SalesHistoryPanel}=module.exports;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const btn=(tree,label)=>tree.root.findAllByType('button').find(node=>text(node).includes(label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const props={storeId:'store-test',storeName:'Fnac Test',today:'2026-11-02',token:'admin',
  sellers:[{id:1,name:'Morgan',active:true},{id:2,name:'Alice',active:false}],services:[{id:1,name:'DMax'},{id:2,name:'Garantie'}],departments:[{id:'tech',name:'Technique'}]};

test('Historique : date passée, ventes cochées, confirmation et reprise idempotente après réponse perdue',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[],busy=[];let updated=0,first=true;
  let rows=[{id:'fixture-sale-0001',serviceId:1,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech',source:'sale'},
    {id:'fixture-sale-0002',serviceId:2,businessDate:'2026-10-29',createdAt:'2026-10-29T14:00:00Z',departmentId:'tech',source:'adjustment'}];
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});
    if(options.method==='POST'){if(first){first=false;throw Error('réponse perdue');}rows=rows.filter(row=>!options.body.saleIds.includes(row.id));return {ok:true,deleted:1,duplicate:true};}
    return {sales:rows,next:null};
  }});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy:x=>busy.push(x),onUpdate:()=>updated++}));await tick();});
    assert.match(text(tree.toJSON()),/Sélectionnez un vendeur/);assert.equal(calls.length,0);
    assert(tree.root.findAllByType('option').some(option=>text(option).includes('Alice · archivé')));
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'1'}});await tick();});
    await act(async()=>{btn(tree,'Semaine').props.onClick();tree.root.findByProps({'aria-label':'Date de référence des ventes'}).props.onChange({target:{value:'2026-10-29'}});await tick();});
    const last=calls.filter(call=>call.method!=='POST').at(-1).path;assert.match(last,/period=week/);assert.match(last,/anchor=2026-10-29/);
    assert.match(text(tree.toJSON()),/DMax/);assert.match(text(tree.toJSON()),/Correction administrative/);
    let boxes=tree.root.findAllByType('input').filter(node=>node.props.type==='checkbox');assert.equal(boxes.length,2);
    await act(async()=>boxes[0].props.onChange());
    await act(async()=>btn(tree,'Supprimer la sélection').props.onClick());
    assert.match(text(tree.toJSON()),/Retirer 1 vente/);assert.match(text(tree.toJSON()),/Morgan · Fnac Test/);assert.equal(calls.filter(call=>call.method==='POST').length,0);
    await act(async()=>btn(tree,'Annuler').props.onClick());assert.equal(calls.filter(call=>call.method==='POST').length,0);
    await act(async()=>btn(tree,'Supprimer la sélection').props.onClick());
    await act(async()=>{btn(tree,'Confirmer la suppression').props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/réponse est incertaine/);assert.equal(calls.filter(call=>call.method==='POST').length,1);
    await act(async()=>{btn(tree,'Confirmer la suppression').props.onClick();await tick();});
    const sent=calls.filter(call=>call.method==='POST').map(call=>call.body);assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
    assert.equal(sent[0].storeId,'store-test');assert.equal(sent[0].sellerId,1);assert.equal(sent[0].period,'week');assert.equal(sent[0].anchor,'2026-10-29');assert.equal(sent[0].saleIds.length,1);assert.equal(sent[0].confirmation,'SUPPRIMER');assert.equal(updated,1);assert.deepEqual(busy,[true,false,true,false]);
    assert.match(text(tree.toJSON()),/vente retirée/);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Historique : pages sans résultat, chargement continu et sélection limitée à vingt ventes',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[];let tree;
  const rows=Array.from({length:22},(_,i)=>({id:`fixture-sale-${String(i).padStart(4,'0')}`,serviceId:1,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech',source:'sale'}));
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});return path.includes('afterId=')?{sales:rows,next:null}:{sales:[],next:{date:'2026-10-29',id:'cursor-1'}};
  }});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy(){},onUpdate(){}}));await tick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'1'}});await tick();});
    assert.match(text(tree.toJSON()),/Aucune vente correspondante dans cette partie/);assert(btn(tree,'Charger la suite'));
    await act(async()=>{btn(tree,'Charger la suite').props.onClick();await tick();});assert.equal(calls.length,2);assert.match(calls[1].path,/afterId=cursor-1/);
    let boxes=tree.root.findAllByType('input').filter(x=>x.props.type==='checkbox');assert.equal(boxes.length,22);
    for(let i=0;i<20;i++)await act(async()=>boxes[i].props.onChange());boxes=tree.root.findAllByType('input').filter(x=>x.props.type==='checkbox');
    assert.equal(boxes.filter(x=>x.props.checked).length,20);assert.equal(boxes.filter(x=>x.props.disabled).length,2);assert.match(text(tree.toJSON()),/20 sélectionnées/);
    await act(async()=>boxes[0].props.onChange());boxes=tree.root.findAllByType('input').filter(x=>x.props.type==='checkbox');assert.equal(boxes.filter(x=>x.props.disabled).length,0);
    await act(async()=>btn(tree,'Supprimer la sélection').props.onClick());assert.match(text(tree.toJSON()),/Retirer 19 ventes/);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Historique : changement rapide de vendeur ignore les réponses obsolètes',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[];let resolveOld,tree;
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:(path,options={})=>{
    calls.push({path,options});if(path.includes('sellerId=1'))return new Promise(resolve=>{resolveOld=resolve;});
    return Promise.resolve({sales:[{id:'alice-sale-0001',serviceId:2,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech'}],next:null});
  }});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy(){},onUpdate(){}}));await tick();});
    const select=tree.root.findByProps({'aria-label':'Vendeur pour l’historique'});
    await act(async()=>{select.props.onChange({target:{value:'1'}});await tick();});assert.match(text(tree.toJSON()),/Chargement des ventes/);
    await act(async()=>{select.props.onChange({target:{value:'2'}});await tick();});assert.match(text(tree.toJSON()),/Garantie/);assert.equal(calls[0].options.signal.aborted,true);
    await act(async()=>{resolveOld({sales:[{id:'morgan-sale-0001',serviceId:1,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech'}],next:null});await tick();});
    const list=tree.root.findByProps({className:'history-list'});assert.match(text(list),/Garantie/);assert.doesNotMatch(text(list),/DMax/);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Historique : conflit de vente ou de nom recharge aussi le catalogue avant une nouvelle confirmation',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[];let tree,reloads=0;
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});if(options.method==='POST')throw Object.assign(Error('Le vendeur ou le magasin a changé.'),{status:409});
    return {sales:[{id:'fixture-sale-0001',serviceId:1,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech'}],next:null};
  }});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy(){},onUpdate(){},onReload(){reloads++;}}));await tick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'1'}});await tick();});
    await act(async()=>tree.root.findAllByType('input').find(x=>x.props.type==='checkbox').props.onChange());
    await act(async()=>btn(tree,'Supprimer la sélection').props.onClick());
    await act(async()=>{btn(tree,'Confirmer la suppression').props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/Le vendeur ou le magasin a changé/);assert(!btn(tree,'Confirmer la suppression'));
    await act(async()=>{btn(tree,'Recharger').props.onClick();await tick();});assert.equal(reloads,1);assert.equal(calls.filter(x=>x.method!=='POST').length,2);assert.equal(tree.root.findAllByType('input').find(x=>x.props.type==='checkbox').props.checked,false);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Ajout historique : jour exact, ancien département, confirmation et reprise sans doublon',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[],busy=[];let tree,first=true,updated=0;
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});if(options.method==='POST'){if(first){first=false;throw Error('réponse perdue');}return {ok:true,added:2,duplicate:true};}
    return {sales:[],next:null};
  }});
  try {
    const fixture={...props,departments:[{id:'tech',name:'Technique',active:true},{id:'editorial',name:'Éditorial',active:false}]};
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...fixture,onBusy:value=>busy.push(value),onUpdate:()=>updated++}));await tick();});
    assert.match(text(tree.toJSON()),/Correction des ventes/);assert.doesNotMatch(text(tree.toJSON()),/Corriger des ventes/);
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'2'}});await tick();});
    await act(async()=>{btn(tree,'Semaine').props.onClick();tree.root.findByProps({'aria-label':'Date de référence des ventes'}).props.onChange({target:{value:'2026-10-29'}});await tick();});
    const date=tree.root.findByProps({'aria-label':'Jour exact de la vente à ajouter'});assert.equal(date.props.value,'');assert.equal(date.props.min,'2026-10-26');assert.equal(date.props.max,'2026-11-01');
    assert(tree.root.findAllByType('option').some(option=>text(option).includes('Éditorial · archivé')));
    await act(async()=>{
      tree.root.findByProps({'aria-label':'Service à ajouter'}).props.onChange({target:{value:'1'}});
      tree.root.findByProps({'aria-label':'Département de la vente'}).props.onChange({target:{value:'editorial'}});
      date.props.onChange({target:{value:'2026-10-27'}});
      tree.root.findByProps({'aria-label':'Nombre de ventes à ajouter'}).props.onChange({target:{value:'2'}});
    });
    await act(async()=>tree.root.findByProps({className:'history-add-form'}).props.onSubmit({preventDefault(){}}));
    assert.equal(calls.filter(x=>x.method==='POST').length,0);
    let confirmation=tree.root.findByProps({'aria-label':'Confirmer l’ajout des ventes'});assert.match(text(confirmation),/Ajouter 2 ventes/);assert.match(text(confirmation),/Alice · Fnac Test/);assert.match(text(confirmation),/DMax · Éditorial/);assert.match(text(confirmation),/2026-10-27/);
    assert.match(text(confirmation),/sans modifier les objectifs/);assert.match(text(confirmation),/Aucune notification/);
    await act(async()=>btn(tree,'Annuler').props.onClick());assert.equal(calls.filter(x=>x.method==='POST').length,0);
    await act(async()=>tree.root.findByProps({className:'history-add-form'}).props.onSubmit({preventDefault(){}}));
    await act(async()=>{btn(tree,'Confirmer l’ajout').props.onClick();await tick();});assert.match(text(tree.toJSON()),/réponse est incertaine/);
    await act(async()=>{btn(tree,'Confirmer l’ajout').props.onClick();await tick();});
    const sent=calls.filter(x=>x.method==='POST');assert.equal(sent.length,2);assert.equal(sent[0].path,'/api/admin/sales/add-correction');assert.deepEqual(sent[0].body,sent[1].body);
    assert.deepEqual(sent[0].body,{storeId:'store-test',sellerId:2,period:'week',anchor:'2026-10-29',saleDate:'2026-10-27',serviceId:1,departmentId:'editorial',quantity:2,requestId:'history-correction-0001',confirmation:'AJOUTER',expectedSellerName:'Alice',expectedStoreName:'Fnac Test',expectedServiceName:'DMax',expectedDepartmentName:'Éditorial'});
    assert.deepEqual(busy,[true,false,true,false]);assert.equal(updated,1);assert.match(text(tree.toJSON()),/déjà été prise en compte pour le 2026-10-27/);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Ajout historique : date obligatoire en semaine et mois, période et quantité contrôlées',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi'),calls=[];let tree;
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async(path,options={})=>{calls.push({path,...options});return options.method==='POST'?{added:1}:{sales:[],next:null};}});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy(){},onUpdate(){}}));await tick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'1'}});await tick();});
    await act(async()=>{btn(tree,'Mois').props.onClick();tree.root.findByProps({'aria-label':'Date de référence des ventes'}).props.onChange({target:{value:'2026-10-29'}});await tick();});
    await act(async()=>{
      tree.root.findByProps({'aria-label':'Service à ajouter'}).props.onChange({target:{value:'1'}});
      tree.root.findByProps({'aria-label':'Département de la vente'}).props.onChange({target:{value:'tech'}});
    });
    const submit=()=>tree.root.findByProps({className:'history-add-form'}).props.onSubmit({preventDefault(){}});
    await act(async()=>submit());assert.match(text(tree.toJSON()),/Choisissez le jour exact/);assert(!btn(tree,'Confirmer l’ajout'));
    await act(async()=>tree.root.findByProps({'aria-label':'Jour exact de la vente à ajouter'}).props.onChange({target:{value:'2026-09-30'}}));
    await act(async()=>submit());assert.match(text(tree.toJSON()),/Choisissez le jour exact/);
    await act(async()=>{
      tree.root.findByProps({'aria-label':'Jour exact de la vente à ajouter'}).props.onChange({target:{value:'2026-10-01'}});
      tree.root.findByProps({'aria-label':'Nombre de ventes à ajouter'}).props.onChange({target:{value:'21'}});
    });
    await act(async()=>submit());assert.match(text(tree.toJSON()),/de 1 à 20 ventes/);assert.equal(calls.filter(x=>x.method==='POST').length,0);
    await act(async()=>{
      btn(tree,'Jour').props.onClick();
      tree.root.findByProps({'aria-label':'Service à ajouter'}).props.onChange({target:{value:'1'}});
      tree.root.findByProps({'aria-label':'Département de la vente'}).props.onChange({target:{value:'tech'}});
    });
    assert.equal(tree.root.findAllByProps({'aria-label':'Jour exact de la vente à ajouter'}).length,0);
    await act(async()=>submit());assert.match(text(tree.root.findByProps({'aria-label':'Confirmer l’ajout des ventes'})),/Jour de la vente : 2026-10-29/);
    await act(async()=>{btn(tree,'Confirmer l’ajout').props.onClick();await tick();});
    assert.equal(calls.filter(x=>x.method==='POST').at(-1).body.saleDate,'2026-10-29');
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});

test('Historique : filtre par service et sélection remise à zéro au changement de filtre',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'__historyApi');let tree;
  Object.defineProperty(globalThis,'__historyApi',{configurable:true,value:async()=>({sales:[
    {id:'fixture-sale-0001',serviceId:1,businessDate:'2026-10-29',createdAt:'2026-10-29T13:00:00Z',departmentId:'tech'},
    {id:'fixture-sale-0002',serviceId:2,businessDate:'2026-10-29',createdAt:'2026-10-29T14:00:00Z',departmentId:'tech'}],next:null})});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SalesHistoryPanel,{...props,onBusy(){},onUpdate(){}}));await tick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Vendeur pour l’historique'}).props.onChange({target:{value:'1'}});await tick();});
    await act(async()=>tree.root.findAllByType('input').find(x=>x.props.type==='checkbox').props.onChange());
    assert.match(text(tree.toJSON()),/1 sélectionnée/);
    await act(async()=>tree.root.findByProps({'aria-label':'Filtrer les ventes par service'}).props.onChange({target:{value:'1'}}));
    assert.match(text(tree.toJSON()),/0 sélectionnée/);const list=tree.root.findByProps({className:'history-list'});assert.match(text(list),/DMax/);assert.doesNotMatch(text(list),/Garantie/);
  } finally {if(tree)await act(async()=>tree.unmount());if(old)Object.defineProperty(globalThis,'__historyApi',old);else delete globalThis.__historyApi;}
});
