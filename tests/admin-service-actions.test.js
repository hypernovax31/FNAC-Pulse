import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/Admin.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'admin-fixture',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'test'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'test'}));
  b.onLoad({filter:/^api$/,namespace:'test'},()=>({contents:'export const api=(...args)=>globalThis.__adminFixtureApi(...args); export const uid=()=>"fixture-job-00001"; export const dateLabel=x=>x; export const timeLabel=x=>x;',loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'test'},()=>({contents:'export const CLOUD=false; export const adminLogin=()=>{}; export const adminLogout=()=>{}; export const changeAdminPassword=()=>{}; export const adminAccountEmail=async()=>"admin@example.test"; export const createAdministrator=()=>{}; export const requestAdminEmailChange=()=>{}; export const resendAdminVerification=()=>{};',loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const Admin=module.exports.default;
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Administration : plus d’archivage pour les services, historique inactif conservé et archivage vendeur préservé',async()=>{
  const keys=['window','document','sessionStorage','__adminFixtureApi'],prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const store='store-test',calls=[],confirmations=[];let accept=false;
  const all={sellers:[{id:1,name:'Morgan',active:true,storeId:store,departmentId:'tech'}],
    services:[{id:1,name:'DMax',active:true},{id:2,name:'Garantie',active:false}],
    serviceOrders:{},serviceRemovalsByStore:{},departmentsByStore:{[store]:[{id:'tech',name:'Technique',active:true}]}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:message=>{confirmations.push(message);return accept;}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>key==='pulse-admin-token'?'admin-token':null,setItem(){},removeItem(){}}});
  Object.defineProperty(globalThis,'__adminFixtureApi',{configurable:true,value:async(path,options={})=>{
    calls.push({path,...options});
    if(path==='/api/admin/all')return structuredClone(all);
    if(path.startsWith('/api/admin/counts'))return {counts:[]};
    if(path.startsWith('/api/admin/services/delete')||path.startsWith('/api/admin/sales/reset')||path.startsWith('/api/admin/sellers/delete'))return {status:'idle',jobId:null,deletedSales:0,deletedGoals:0};
    if(path==='/api/admin/entities/services/2'&&options.method==='PATCH'){all.services[1].active=true;return {ok:true};}
    throw Error(`Appel inattendu : ${path}`);
  }});
  const props={data:{stores:[{id:store,name:'Fnac Test'}],today:'2026-11-02'},session:{storeId:store,sellerId:1},onClose(){},onChanged(){}};let tree;
  const tab=name=>tree.root.findAllByProps({role:'tab'}).find(node=>text(node)===name);
  const action=label=>tree.root.findAllByType('button').find(node=>node.props['aria-label']===label);
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,props));await tick();});
    await act(async()=>{tab('Services').props.onClick();await tick();});
    assert(action('Modifier DMax'));assert(action('Supprimer DMax de Fnac Test'));
    assert.equal(action('Archiver DMax'),undefined);assert.equal(action('Archiver Garantie'),undefined);
    assert(action('Réactiver Garantie pour tous les magasins'));assert.match(text(tree.toJSON()),/GarantieInactif/);
    assert.doesNotMatch(text(tree.toJSON()),/archiver|archivage|archivé/i);
    await act(async()=>{action('Réactiver Garantie pour tous les magasins').props.onClick();await tick();});
    assert.match(confirmations[0],/pour tous les magasins/);assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
    accept=true;await act(async()=>{action('Réactiver Garantie pour tous les magasins').props.onClick();await tick();});
    const patch=calls.find(c=>c.path==='/api/admin/entities/services/2');assert.deepEqual(patch.body,{active:true});
    assert.equal(action('Archiver Garantie'),undefined);assert(action('Supprimer Garantie de Fnac Test'));
    await act(async()=>{tab('Vendeurs').props.onClick();await tick();});assert(action('Archiver Morgan'));
  } finally {
    if(tree)await act(async()=>tree.unmount());
    for(const key of keys){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
