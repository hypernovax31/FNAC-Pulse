import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const out=await build({entryPoints:['src/Admin.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],logLevel:'silent',plugins:[{name:'login-fixtures',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__directLogin.api(...x);export const uid=()=>"test-uid";export const dateLabel=x=>x;export const timeLabel=x=>x;`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`
    export const CLOUD=true,ADMIN_SESSION='admin-session';
    export const adminLogin=(...x)=>globalThis.__directLogin.login(...x),adminLogout=()=>globalThis.__directLogin.logout(),changeAdminPassword=(...x)=>globalThis.__directLogin.change(...x);
    export const adminAccountEmail=async()=>"nouveau@example.test",createDirectAdministrator=()=>{},resendAdminVerification=()=>{};
    export const createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=(...x)=>globalThis.__directLogin.register?.(...x),changeFirstCodeAdminPassword=(...x)=>globalThis.__directLogin.codeChange?.(...x);
    export const requestAdminPasswordReset=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{};
  `,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',out.outputFiles[0].text)(module,module.exports,require);
const Admin=module.exports.default,tick=()=>new Promise(r=>setImmediate(r));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const set=async(input,value)=>act(async()=>{input.props.onChange({target:{value}});await tick();});

test('Première connexion directe : pas de session admin avant changement et reconnexion',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let changed=false,logins=0,tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(email,password){calls.push(['login',email,password]);logins++;return 'admin-session';},
    async logout(){calls.push(['logout']);},
    async change(current,next){calls.push(['change',current,next]);changed=true;},
    async api(path,options={}){
      calls.push(['api',path]);
      if(path==='/api/auth/admin-account-status')return changed?(logins===1?{passwordChangeRequired:false,reauthenticate:true}:{passwordChangeRequired:false}):{passwordChangeRequired:true};
      if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
      return {ok:true};
    },
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'nouveau@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Provisoire-test-2026!');
    await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/Remplacez le mot de passe provisoire/);assert.equal(values.has('pulse-admin-token'),false);
    assert.equal(calls.filter(x=>x[0]==='api'&&x[1]==='/api/admin/all').length,0,'aucune donnée admin avant le changement');
    const form=tree.root.findByType('form'),inputs=form.findAllByType('input');
    await set(inputs[0],'Provisoire-test-2026!');await set(inputs[1],'Personnel-test-2026!');await set(inputs[2],'Personnel-test-2026!');
    await act(async()=>{form.props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,1250));await tick();await tick();});
    assert.deepEqual(calls.filter(x=>x[0]==='login').map(x=>x[2]),['Provisoire-test-2026!','Personnel-test-2026!']);
    assert.deepEqual(calls.find(x=>x[0]==='change').slice(1),['Provisoire-test-2026!','Personnel-test-2026!']);
    assert.equal(values.get('pulse-admin-token'),'admin-session');assert.match(text(tree.toJSON()),/Votre mot de passe personnel est enregistré/);
    assert(calls.some(x=>x[0]==='api'&&x[1]==='/api/admin/all'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Parcours code à distance : aucun accès avant le mot de passe personnel',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let changed=false,logins=0,tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async register(_api,data){calls.push(['register',data]);return {ok:true};},
    async codeChange(next){calls.push(['codeChange',next]);changed=true;},
    async login(email,password){calls.push(['login',email,password]);logins++;return 'admin-session';},
    async logout(){calls.push(['logout']);},async change(){throw Error('ancien flux incorrect');},
    async api(path){
      calls.push(['api',path]);
      if(path==='/api/auth/admin-account-status')return changed?(logins===0?{passwordChangeRequired:false,reauthenticate:true}:{passwordChangeRequired:false}):{passwordChangeRequired:true,method:'code'};
      if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
      return {ok:true};
    },
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await act(async()=>{tree.root.findAllByType('button').find(x=>text(x).includes('Créer mon accès avec un code')).props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/6 caractères maximum/);
    const form=()=>tree.root.findByType('form'),fields=()=>form().findAllByType('input');
    await set(fields()[0],'ABCD-EFGH-JKLM-NPQR');await set(fields()[1],'nouveau@example.test');await set(fields()[2],'123456');await set(fields()[3],'123456');
    await act(async()=>fields()[4].props.onChange({target:{checked:true}}));
    await act(async()=>{form().props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/Remplacez le mot de passe provisoire/);assert.equal(values.has('pulse-admin-token'),false);
    assert.equal(calls.filter(x=>x[0]==='api'&&x[1]==='/api/admin/all').length,0);
    assert.equal(fields().length,2,'pas de ressaisie du code ni du provisoire');
    await set(fields()[0],'Personnel-test-2026!');await set(fields()[1],'Personnel-test-2026!');
    await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,1250));await tick();await tick();});
    assert.deepEqual(calls.find(x=>x[0]==='codeChange').slice(1),['Personnel-test-2026!']);
    assert.deepEqual(calls.filter(x=>x[0]==='login').map(x=>x[2]),['Personnel-test-2026!']);
    assert.equal(values.get('pulse-admin-token'),'admin-session');assert(calls.some(x=>x[0]==='api'&&x[1]==='/api/admin/all'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});
