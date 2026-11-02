import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer,tick=()=>new Promise(r=>setImmediate(r));
const plugin={name:'admin-fixtures',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:'export const api=(...x)=>globalThis.__adminTest.api(...x);',loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`
    export const adminAccountEmail=(...x)=>globalThis.__adminTest.email(...x);
    export const changeAdminPassword=(...x)=>globalThis.__adminTest.password(...x);
    export const createAdministrator=(...x)=>globalThis.__adminTest.create(...x);
    export const requestAdminEmailChange=(...x)=>globalThis.__adminTest.address(...x);
  `,loader:'js'}));
}};
async function load(entry){
  const out=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],plugins:[plugin],logLevel:'silent'});
  const mod={exports:{}};new Function('module','exports','require',out.outputFiles[0].text)(mod,mod.exports,require);return mod.exports;
}
const {AdminAccounts}=await load('src/AdminAccounts.jsx'),{DirectoryImport}=await load('src/DirectoryImport.jsx'),{AdminTabs}=await load('src/AdminTabs.jsx');
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const form=(tree,id)=>tree.root.findByProps({'aria-labelledby':id}).findByType('form');
const change=async(input,value)=>act(async()=>{input.props.onChange({target:{value}});await tick();});
const submit=async(form)=>act(async()=>{form.props.onSubmit({preventDefault(){}});await tick();await tick();});
function setup(){
  const names=['document','window','__adminTest'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)])),e={calls:[],confirms:[],allow:true};
  const put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});
  put('document',{visibilityState:'visible',addEventListener(){},removeEventListener(){}});
  put('window',{confirm:q=>{e.confirms.push(q);return e.allow;},addEventListener(){},removeEventListener(){}});
  put('__adminTest',{
    async api(...args){e.calls.push(['api',...args]);return {imported:50,reviewCount:1};},
    async email(...args){e.calls.push(['email',...args]);return 'responsable@example.test';},
    async password(...args){e.calls.push(['password',...args]);},
    async address(...args){e.calls.push(['address',...args]);},
    async create(...args){e.calls.push(['create',args[1]]);return {already:false,verificationRequired:true};},
  });
  e.restore=()=>{for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];};return e;
}

test('Administration : ordre exact des onglets et accès clavier',async()=>{
  const e=setup();let tree;const selected=[];
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminTabs,{tab:'stores',onSelect:x=>selected.push(x)}));await tick();});
    const tabs=tree.root.findAllByProps({role:'tab'});
    assert.deepEqual(tabs.map(text),['Magasins','Ventes','Objectifs','Vendeurs','Services','Départements','Administrateur']);
    await act(async()=>tabs[6].props.onClick());assert.deepEqual(selected,['security']);
    await act(async()=>tabs[6].props.onKeyDown({key:'ArrowRight',preventDefault(){}}));assert.deepEqual(selected,['security','stores']);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Administrateur : création explicite, confirmation et modifications personnelles',async()=>{
  const e=setup(),busy=[];let tree,loggedOut=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onBusy:x=>busy.push(x),onLogout:()=>loggedOut++}));await tick();});
    assert.match(text(tree.toJSON()),/responsable@example\.test/);assert.match(text(tree.toJSON()),/mêmes droits sur tous les magasins/);
    const create=()=>form(tree,'admin-create-title'),fields=()=>create().findAllByType('input');
    await change(fields()[0],'nouveau@example.test');await change(fields()[1],'Initial-password-2026!');await change(fields()[2],'different');await change(fields()[4],'Current-password-2026!');
    await submit(create());assert.match(text(tree.toJSON()),/ne correspondent pas/);assert.equal(e.calls.filter(x=>x[0]==='create').length,0);
    await change(fields()[2],'Initial-password-2026!');await submit(create());
    assert.deepEqual(e.calls.find(x=>x[0]==='create')[1],{email:'nouveau@example.test',password:'Initial-password-2026!',currentPassword:'Current-password-2026!',existing:false});
    assert.match(text(tree.toJSON()),/droits seront actifs après validation/);assert.equal(fields()[0].props.value,'');assert.equal(fields()[1].props.value,'');
    const pw=()=>form(tree,'admin-password-title'),pwFields=()=>pw().findAllByType('input');
    await change(pwFields()[0],'Ancien-password-2026!');await change(pwFields()[1],'Nouveau-password-2026!');await change(pwFields()[2],'Nouveau-password-2026!');await submit(pw());
    assert.deepEqual(e.calls.find(x=>x[0]==='password').slice(1),['Ancien-password-2026!','Nouveau-password-2026!']);assert.match(text(tree.toJSON()),/mot de passe a été mis à jour/);
    const address=()=>form(tree,'admin-email-title'),emailFields=()=>address().findAllByType('input');
    await change(emailFields()[0],'autre@example.test');await change(emailFields()[1],'Nouveau-password-2026!');await submit(address());
    assert.deepEqual(e.calls.find(x=>x[0]==='address').slice(1),['Nouveau-password-2026!','autre@example.test']);assert.match(text(tree.toJSON()),/ancienne adresse reste valable/);
    await act(async()=>tree.root.findAllByType('button').find(x=>text(x).includes('Déconnexion administrateur')).props.onClick());assert.equal(loggedOut,1);
    assert.deepEqual(busy,[true,false,true,false,true,false,true,false]);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Administrateur : reprise d’un compte existant seulement par choix explicite',async()=>{
  const e=setup();let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onLogout(){}}));await tick();});
    const create=()=>form(tree,'admin-create-title'),fields=()=>create().findAllByType('input');
    await change(fields()[0],'existant@example.test');await change(fields()[1],'Initial-password-2026!');await change(fields()[2],'Initial-password-2026!');await change(fields()[4],'Current-password-2026!');
    await act(async()=>fields()[3].props.onChange({target:{checked:true}}));await submit(create());
    assert.equal(e.calls.find(x=>x[0]==='create')[1].existing,true);
    assert.equal(fields()[3].props.checked,false,'la case est réinitialisée après attribution');
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

const syntheticDirectory=(count=50)=>`<!doctype html><html><body><h1>Trouver un magasin Fnac</h1><p>${count} magasins</p>${Array.from({length:count},(_,i)=>`<a href="https://www.fnac.com/localiser-magasin-fnac/cl${i+1}/w-4">Ville ${i+1}</a>`).join('')}</body></html>`;
function paste(tree,html){return act(async()=>{tree.root.findByProps({'aria-label':'Coller la page complète de l’annuaire Fnac'}).props.onPaste({preventDefault(){},clipboardData:{getData:kind=>kind==='text/html'?html:''}});await tick();});}
const importButton=tree=>tree.root.findByType('button');

test('Annuaire : copie locale vérifiée, confirmation explicite et aucun HTML transmis',async()=>{
  const e=setup(),busy=[];let tree,refreshes=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(DirectoryImport,{token:'admin-session',onBusy:x=>busy.push(x),onImported:()=>refreshes++}));});
    assert.equal(importButton(tree).props.disabled,true);await paste(tree,'');assert.match(text(tree.toJSON()),/ne contient pas les liens/);
    await paste(tree,syntheticDirectory());assert.match(text(tree.toJSON()),/50 fiches détectées · 50 magasins annoncés/);assert.equal(importButton(tree).props.disabled,false);
    e.allow=false;await act(async()=>importButton(tree).props.onClick());assert.equal(e.calls.filter(x=>x[0]==='api').length,0);
    e.allow=true;await act(async()=>{await importButton(tree).props.onClick();await tick();});
    const request=e.calls.find(x=>x[0]==='api');assert.equal(request[1],'/api/admin/stores/import');assert.equal(request[2].token,'admin-session');assert.equal(request[2].body.entries.length,50);
    assert(!JSON.stringify(request[2].body).includes('<a '));assert.match(e.confirms.at(-1),/date et l’origine de la copie ne peuvent pas être vérifiées/);
    assert.match(text(tree.toJSON()),/Copie importée : 50 fiches/);assert.equal(refreshes,1);assert.deepEqual(busy,[true,false]);assert.equal(importButton(tree).props.disabled,true);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Annuaire : échec réseau incertain et double appui bloqué ; fichier trop grand refusé',async()=>{
  const e=setup();let tree,resolve;globalThis.__adminTest.api=()=>new Promise(r=>{resolve=r;});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(DirectoryImport,{token:'admin'}));});
    const file=tree.root.findByType('input');await act(async()=>file.props.onChange({target:{files:[{size:8_000_001}],value:'x'}}));assert.match(text(tree.toJSON()),/Fichier trop volumineux/);
    await paste(tree,syntheticDirectory());
    await act(async()=>{importButton(tree).props.onClick();importButton(tree).props.onClick();await tick();});assert.equal(e.confirms.length,1);assert.equal(importButton(tree).props.disabled,true);
    await act(async()=>{resolve({imported:50,reviewCount:0});await tick();});assert.match(text(tree.toJSON()),/Copie importée/);
    await paste(tree,syntheticDirectory());globalThis.__adminTest.api=async()=>{throw new TypeError('connexion interrompue');};
    await act(async()=>{await importButton(tree).props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/Résultat non confirmé/);assert.equal(importButton(tree).props.disabled,false,'la copie reste disponible pour une reprise volontaire');
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});
