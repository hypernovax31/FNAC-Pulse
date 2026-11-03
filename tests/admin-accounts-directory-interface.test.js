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
    export const inviteAdministrator=(...x)=>globalThis.__adminTest.invite(...x);
    export const requestAdminEmailChange=(...x)=>globalThis.__adminTest.address(...x);
    export const inspectAdminEmailChange=(...x)=>globalThis.__adminTest.inspect(...x);
    export const confirmAdminEmailChange=(...x)=>globalThis.__adminTest.confirm(...x);
    export const requestAdminPasswordReset=(...x)=>globalThis.__adminTest.sendReset(...x);
    export const inspectAdminPasswordReset=(...x)=>globalThis.__adminTest.inspectReset(...x);
    export const confirmAdminPasswordReset=(...x)=>globalThis.__adminTest.confirmReset(...x);
    export const inspectAdminVerification=(...x)=>globalThis.__adminTest.inspectVerification(...x);
    export const confirmAdminVerification=(...x)=>globalThis.__adminTest.confirmVerification(...x);
  `,loader:'js'}));
}};
async function load(entry){
  const out=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],plugins:[plugin],logLevel:'silent'});
  const mod={exports:{}};new Function('module','exports','require',out.outputFiles[0].text)(mod,mod.exports,require);return mod.exports;
}
const {AdminAccounts}=await load('src/AdminAccounts.jsx'),{AdminInvitationHelp}=await load('src/AdminInvitationHelp.jsx'),{DirectoryImport}=await load('src/DirectoryImport.jsx'),{AdminTabs}=await load('src/AdminTabs.jsx');
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const form=(tree,id)=>tree.root.findByProps({'aria-labelledby':id}).findAllByType('form')[0];
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
    async inspect(...args){e.calls.push(['inspect',...args]);return {code:'code-fictif',newEmail:'nouvelle@example.test'};},
    async confirm(...args){e.calls.push(['confirm',...args]);return {email:'nouvelle@example.test',refreshed:true};},
    async invite(...args){e.calls.push(['invite',args[1]]);return {alreadyAccepted:false,accountCreated:true};},
    async sendReset(...args){e.calls.push(['sendReset',...args]);},
    async inspectReset(...args){e.calls.push(['inspectReset',...args]);return {code:'reset-fictif',email:'invite@example.test'};},
    async confirmReset(...args){e.calls.push(['confirmReset',...args]);return {email:'invite@example.test'};},
    async inspectVerification(...args){e.calls.push(['inspectVerification',...args]);return {code:'verify-fictif',email:'invite@example.test'};},
    async confirmVerification(...args){e.calls.push(['confirmVerification',...args]);return {email:'invite@example.test'};},
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

test('Administrateur : seulement une adresse à inviter et son propre mot de passe',async()=>{
  const e=setup(),busy=[];let tree,loggedOut=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onBusy:x=>busy.push(x),onLogout:()=>loggedOut++}));await tick();});
    assert.match(text(tree.toJSON()),/responsable@example\.test/);assert.match(text(tree.toJSON()),/Saisissez son e-mail et confirmez avec votre mot de passe/);assert.match(text(tree.toJSON()),/recevra un lien pour choisir le sien/);assert.match(text(tree.toJSON()),/acceptera l’invitation/);assert.match(text(tree.toJSON()),/gérer tous les magasins/);
    assert.deepEqual(tree.root.findAllByType('section').map(x=>x.props['aria-labelledby']),['admin-create-title','admin-password-title']);
    assert.doesNotMatch(text(tree.toJSON()),/Modifier mon e-mail|Le lien reçu ne s’ouvre pas|mot de passe initial/);
    const create=()=>form(tree,'admin-create-title'),fields=()=>create().findAllByType('input');
    assert.equal(fields().length,1,'un seul champ adresse dans le formulaire initial');
    await change(fields()[0],'nouveau@example.test');await submit(create());
    assert.equal(e.calls.filter(x=>x[0]==='invite').length,0,'aucune invitation avant la confirmation');
    assert.equal(fields().length,2);assert.equal(fields()[0].props.readOnly,true);assert.match(text(tree.toJSON()),/confirmez votre mot de passe administrateur/i);
    await change(fields()[1],'Current-password-2026!');await submit(create());
    assert.deepEqual(e.calls.find(x=>x[0]==='invite')[1],{email:'nouveau@example.test',currentPassword:'Current-password-2026!'});
    assert.match(text(tree.toJSON()),/Accepter mon invitation/);assert.equal(fields().length,1);assert.equal(fields()[0].props.value,'');
    const pw=()=>form(tree,'admin-password-title'),pwFields=()=>pw().findAllByType('input');
    await change(pwFields()[0],'Ancien-password-2026!');await change(pwFields()[1],'Nouveau-password-2026!');await change(pwFields()[2],'Incorrect-password-2026!');await submit(pw());
    assert.match(text(tree.toJSON()),/ne correspondent pas/);assert.equal(e.calls.filter(x=>x[0]==='password').length,0);
    await change(pwFields()[2],'Nouveau-password-2026!');await submit(pw());
    assert.deepEqual(e.calls.find(x=>x[0]==='password').slice(1),['Ancien-password-2026!','Nouveau-password-2026!']);assert.match(text(tree.toJSON()),/mot de passe a été mis à jour/);
    assert(pwFields().every(x=>x.props.value===''));await act(async()=>tree.root.findAllByType('button').find(x=>text(x).includes('Déconnexion administrateur')).props.onClick());assert.equal(loggedOut,1);
    assert.deepEqual(busy,[true,false,true,false,true,false]);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Administrateur : confirmation protégée, correction d’adresse, échec et double appui',async()=>{
  const e=setup();let tree,resolve;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onLogout(){}}));await tick();});
    const create=()=>form(tree,'admin-create-title'),fields=()=>create().findAllByType('input');
    await change(fields()[0],'un@example.test');await submit(create());
    await change(fields()[1],'ancien-secret-fictif');
    await act(async()=>tree.root.findAllByType('button').find(x=>text(x).includes('Modifier l’adresse')).props.onClick());
    assert.equal(fields().length,1);assert.equal(fields()[0].props.value,'un@example.test');
    await change(fields()[0],'autre@example.test');await submit(create());assert.equal(fields()[1].props.value,'');
    globalThis.__adminTest.invite=async(...args)=>{e.calls.push(['invite',args[1]]);throw new Error('Mot de passe administrateur actuel incorrect.');};
    await change(fields()[1],'incorrect-fictif');await submit(create());
    assert.match(text(tree.toJSON()),/Mot de passe administrateur actuel incorrect/);assert.equal(fields()[1].props.value,'');assert.equal(fields()[0].props.value,'autre@example.test');
    globalThis.__adminTest.invite=(...args)=>{e.calls.push(['invite',args[1]]);return new Promise(r=>{resolve=r;});};
    await change(fields()[1],'mot-de-passe-fictif');
    await act(async()=>{create().props.onSubmit({preventDefault(){}});create().props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(e.calls.filter(x=>x[0]==='invite').length,2,'un seul appel pour le double appui');assert.equal(fields()[0].props.disabled,true);
    await act(async()=>{resolve({alreadyAccepted:false});await tick();await tick();});
    assert.equal(fields().length,1);assert.equal(fields()[0].props.value,'');assert.doesNotMatch(text(tree.toJSON()),/mot-de-passe-fictif|incorrect-fictif/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Administrateur : le titulaire d’un compte existant conserve son choix',async()=>{
  const e=setup();let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onLogout(){}}));await tick();});
    const create=()=>form(tree,'admin-create-title'),fields=()=>create().findAllByType('input');
    await change(fields()[0],'existant@example.test');await submit(create());await change(fields()[1],'mot-de-passe-fictif');await submit(create());
    const content=text(tree.toJSON());
    assert.match(content,/peut garder son mot de passe si elle a déjà un compte/);
    assert.match(content,/Accepter mon invitation/);assert.match(content,/gérer tous les magasins/);
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

test('Invitation : lien bloqué vérifié, adresse affichée et mot de passe choisi uniquement par le titulaire',async()=>{
  const e=setup(),busy=[],completed=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminInvitationHelp,{email:'invite@example.test',busy:false,onBusy:x=>busy.push(x),onCompleted:x=>completed.push(x)}));await tick();});
    const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
    await act(async()=>{button('Demander un nouveau lien').props.onClick();await tick();await tick();});
    assert.deepEqual(e.calls.find(x=>x[0]==='sendReset').slice(1),['invite@example.test']);assert.match(text(tree.toJSON()),/Si cette adresse possède un compte compatible/);
    const link=tree.root.findByProps({'aria-label':'Lien de réinitialisation ou de confirmation'});
    await change(link,'https://demo-fnac.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=secret-fictif');
    await submit(tree.root.findAllByType('form')[0]);assert.equal(link.props.value,'');assert.match(text(tree.toJSON()),/invite@example\.test/);
    assert.equal(e.calls.filter(x=>x[0]==='confirmReset').length,0);
    const resetForm=()=>tree.root.findAllByType('form')[1],inputs=()=>resetForm().findAllByType('input');
    await change(inputs()[0],'Mon-propre-mot-de-passe');await change(inputs()[1],'incorrect');await submit(resetForm());
    assert.match(text(tree.toJSON()),/ne correspondent pas/);assert.equal(e.calls.filter(x=>x[0]==='confirmReset').length,0);
    await change(inputs()[1],'Mon-propre-mot-de-passe');await submit(resetForm());
    assert.deepEqual(e.calls.find(x=>x[0]==='confirmReset').slice(1),[{code:'reset-fictif',email:'invite@example.test'},'Mon-propre-mot-de-passe']);
    assert.deepEqual(completed,['invite@example.test']);assert.doesNotMatch(text(tree.toJSON()),/secret-fictif|reset-fictif|Mon-propre-mot-de-passe/);
    assert.deepEqual(busy,[true,false,true,false,true,false,true,false]);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Invitation : confirmation d’adresse bloquée vérifiée puis confirmée explicitement',async()=>{
  const e=setup(),completed=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminInvitationHelp,{email:'invite@example.test',busy:false,onBusy(){},onCompleted(){},onVerified:value=>completed.push(value)}));await tick();});
    const field=tree.root.findByProps({'aria-label':'Lien de réinitialisation ou de confirmation'});
    await change(field,'https://demo-fnac.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=fictif');
    await submit(tree.root.findAllByType('form')[0]);assert.match(text(tree.toJSON()),/Adresse à confirmer/);
    assert.equal(e.calls.filter(x=>x[0]==='confirmVerification').length,0);
    await act(async()=>{tree.root.findAllByType('button').find(x=>text(x).includes('Confirmer mon adresse')).props.onClick();await tick();await tick();});
    assert.deepEqual(completed,['invite@example.test']);assert.deepEqual(e.calls.find(x=>x[0]==='confirmVerification')[1],{code:'verify-fictif',email:'invite@example.test'});
    assert.doesNotMatch(text(tree.toJSON()),/verify-fictif|oobCode/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});
