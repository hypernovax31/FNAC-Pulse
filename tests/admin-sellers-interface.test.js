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
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`export const CLOUD=true;export const adminLogin=()=>{};export const adminLogout=()=>{};export const changeAdminPassword=()=>{}; export const adminAccountEmail=async()=>"admin@example.test"; export const createAdministrator=()=>{}; export const requestAdminEmailChange=()=>{}; export const resendAdminVerification=()=>{};`,loader:'js'}));
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
    const tabs=tree.root.findAllByProps({role:'tab'});assert.deepEqual(tabs.map(text),['Magasins','Ventes','Objectifs','Vendeurs','Services','Départements','Administrateur']);assert(!tabs.some(x=>text(x)==='Codes PIN'));
    await act(async()=>{tabs.find(x=>text(x)==='Vendeurs').props.onClick();await tick();});
    const copy=text(tree.toJSON());assert.match(copy,/Vendeurs et accès/);assert.match(copy,/Accès et codes PIN/);assert.match(copy,/Supprimer définitivement un vendeur/);assert.match(copy,/Benoît/);
    const alice=tree.root.findAllByType('article').find(card=>text(card).includes('Alice'));assert(alice);
    assert(alice.findByProps({'aria-label':'Département de Alice'}));
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
    assert(calls.some(x=>x.path==='/api/admin/entities/sellers'&&x.method==='POST'&&x.body.name==='Clara'&&x.body.storeId===store));
    const reset=tree.root.findAllByType('button').find(b=>text(b).includes('Réinitialiser l’accès'));
    assert(reset&&!reset.props.disabled);await act(async()=>{reset.props.onClick();await tick();});
    assert(calls.some(x=>x.path==='/api/admin/pin-reset'&&x.body.sellerId===1));
    assert.equal(calls.filter(x=>x.path==='/api/admin/sellers/delete'&&x.method==='POST').length,0);
  } finally {
    if(tree)await act(async()=>tree.unmount());
    for(const [name,value] of Object.entries(original))if(value===undefined)delete globalThis[name];else globalThis[name]=value;
  }
});
