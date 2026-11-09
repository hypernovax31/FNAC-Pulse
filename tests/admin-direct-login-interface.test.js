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
    export const claimAdminAccess=(...x)=>globalThis.__directLogin?.claim?.(...x),registerAdminForApproval=(...x)=>globalThis.__directLogin?.manualRegister?.(...x),deleteTestFirebaseAccount=()=>{}; export const CLOUD=true,ADMIN_SESSION='admin-session';
    export const adminLogin=(...x)=>globalThis.__directLogin.login(...x),adminLogout=()=>globalThis.__directLogin.logout(),changeAdminPassword=(...x)=>globalThis.__directLogin.change(...x);
    export const adminAccountEmail=async()=>"nouveau@example.test",createDirectAdministrator=()=>{},inviteAdministrator=()=>{},resendAdminVerification=(...x)=>globalThis.__directLogin?.resend?.(...x);
    export const createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=(...x)=>globalThis.__directLogin.register?.(...x),changeFirstCodeAdminPassword=(...x)=>globalThis.__directLogin.codeChange?.(...x);
    export const requestAdminPasswordReset=(...x)=>globalThis.__directLogin?.reset?.(...x),inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{};
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
    assert.equal(inputs.length,2,'le provisoire déjà saisi à la connexion n’est pas redemandé');
    await set(inputs[0],'Provisoire-test-2026!');await set(inputs[1],'Provisoire-test-2026!');
    await act(async()=>{form.props.onSubmit({preventDefault(){}});await tick();});
    assert.match(text(tree.toJSON()),/différent du mot de passe provisoire/);assert.equal(calls.filter(x=>x[0]==='change').length,0);
    await set(inputs[0],'Personnel-test-2026!');await set(inputs[1],'Personnel-test-2026!');
    await act(async()=>{form.props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,1250));await tick();await tick();});
    assert.deepEqual(calls.filter(x=>x[0]==='login').map(x=>x[2]),['Provisoire-test-2026!','Personnel-test-2026!']);
    assert.deepEqual(calls.find(x=>x[0]==='change').slice(1),['Provisoire-test-2026!','Personnel-test-2026!']);
    assert.equal(values.get('pulse-admin-token'),'admin-session');assert.match(text(tree.toJSON()),/Votre mot de passe personnel est enregistré/);
    assert(calls.some(x=>x[0]==='api'&&x[1]==='/api/admin/all'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Ancien compte par code : aucun accès avant le mot de passe personnel',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let changed=false,logins=0,tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async codeChange(next){calls.push(['codeChange',next]);changed=true;},
    async login(email,password){calls.push(['login',email,password]);logins++;return 'admin-session';},
    async logout(){calls.push(['logout']);},async change(){throw Error('ancien flux incorrect');},
    async api(path){
      calls.push(['api',path]);
      if(path==='/api/auth/admin-account-status')return changed?(logins===1?{passwordChangeRequired:false,reauthenticate:true}:{passwordChangeRequired:false}):{passwordChangeRequired:true,method:'code'};
      if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
      return {ok:true};
    },
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'ancien@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Cle-provisoire-fictive');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/Remplacez le mot de passe provisoire/);assert.equal(values.has('pulse-admin-token'),false);
    assert.equal(calls.filter(x=>x[0]==='api'&&x[1]==='/api/admin/all').length,0);
    const form=()=>tree.root.findByType('form'),fields=()=>form().findAllByType('input');
    assert.equal(fields().length,2,'pas de ressaisie du code ni du provisoire');
    await set(fields()[0],'Personnel-test-2026!');await set(fields()[1],'Personnel-test-2026!');
    await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,1250));await tick();await tick();});
    assert.deepEqual(calls.find(x=>x[0]==='codeChange').slice(1),['Personnel-test-2026!']);
    assert.deepEqual(calls.filter(x=>x[0]==='login').map(x=>x[2]),['Cle-provisoire-fictive','Personnel-test-2026!']);
    assert.equal(values.get('pulse-admin-token'),'admin-session');assert(calls.some(x=>x[0]==='api'&&x[1]==='/api/admin/all'));
    await act(async()=>{tree.root.findAllByProps({role:'tab'}).find(x=>text(x).includes('Administrateurs')).props.onClick();await tick();await tick();});
    await act(async()=>{tree.root.findAllByType('button').find(x=>text(x).includes('Se déconnecter')).props.onClick();await tick();await tick();});
    assert.equal(values.has('pulse-admin-token'),false);assert(tree.root.findByProps({id:'admin-email'}));
    assert.match(text(tree.toJSON()),/Mot de passe oublié \?/);assert.doesNotMatch(text(tree.toJSON()),/Aide à la connexion|Créer mon accès avec un code/);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Ancienne demande en attente : proposer une invitation et préserver la validation éventuelle',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree,approved=false;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(email,password){calls.push(['login',email,password]);return 'admin-session';},
    async claim(){calls.push(['claim']);return {ok:true,status:'pending'};},
    async logout(){calls.push(['logout']);},async change(){},
    async api(path){calls.push(['api',path]);
      if(path==='/api/auth/admin-account-status'||path==='/api/auth/admin-invitations/accept')throw Object.assign(Error('Accès administrateur refusé.'),{status:403});
      if(path==='/api/auth/admin-access/status')return {ok:true,status:approved?'approved':'pending'};
      if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
      return {ok:true};
    },
  });
  const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'ancien@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Personnel-test-2026!');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert(calls.some(x=>x[0]==='claim'));assert.match(text(tree.toJSON()),/Demande en attente/);
    assert.match(text(tree.toJSON()),/demandez à un administrateur de vous envoyer une invitation par e-mail/i);assert.equal(values.has('pulse-admin-token'),false);
    assert.equal(calls.filter(x=>x[1]==='/api/admin/all').length,0);
    await act(async()=>{button('Vérifier la validation').props.onClick();await tick();});assert.match(text(tree.toJSON()),/attend toujours/);
    assert.equal(values.has('pulse-admin-token'),false);approved=true;
    await act(async()=>{button('Vérifier la validation').props.onClick();await tick();await tick();});
    assert.equal(values.get('pulse-admin-token'),'admin-session');assert(calls.some(x=>x[1]==='/api/admin/all'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Compte existant : se connecter avec son propre mot de passe transmet seulement une demande en attente',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(email,password){calls.push(['login',email,password]);return 'admin-session';},async logout(){},async change(){},
    async claim(){calls.push(['claim']);return {ok:true,status:'pending'};},
    async api(path){if(path==='/api/auth/admin-account-status'||path==='/api/auth/admin-invitations/accept')throw Object.assign(Error('Accès administrateur refusé.'),{status:403});throw Error('aucune donnée admin avant validation');},
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'ancien@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Ancien-password-test!');
    await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert(calls.some(x=>x[0]==='claim'));assert.equal(values.has('pulse-admin-token'),false);assert.match(text(tree.toJSON()),/Demande en attente/);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Invitation par e-mail : connexion automatique après vérification, même si une réponse est perdue',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree,accepted=false,attempts=0;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(email,password){calls.push(['login',email,password]);return 'admin-session';},async logout(){calls.push(['logout']);},async change(){},
    async claim(){throw Error('une validation manuelle ne doit pas être demandée');},
    async api(path,options={}){
      calls.push(['api',path,options]);
      if(path==='/api/auth/admin-account-status'){if(!accepted)throw Object.assign(Error('Accès administrateur refusé.'),{status:403});return {passwordChangeRequired:false};}
      if(path==='/api/auth/admin-invitations/accept'){
        assert.deepEqual(options.body,{confirmed:true});accepted=true;
        if(++attempts===1)throw new TypeError('réponse perdue');return {ok:true,already:true};
      }
      if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};
      return {ok:true};
    },
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    assert.match(text(tree.toJSON()),/Connectez-vous avec votre adresse e-mail et votre mot de passe/);
    assert.match(text(tree.toJSON()),/Mot de passe oublié \?/);
    assert.doesNotMatch(text(tree.toJSON()),/Anciennes demandes|Accepter mon invitation/);
    await set(tree.root.findByProps({id:'admin-email'}),'invite@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Mot-de-passe-personnel-2026');
    await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.equal(attempts,2);assert.equal(values.get('pulse-admin-token'),'admin-session');
    assert.equal(calls.filter(x=>x[1]==='/api/auth/admin-account-status').length,2);
    assert(calls.some(x=>x[1]==='/api/admin/all'));assert(!calls.some(x=>x[1]?.includes?.('/approve')));assert(!calls.some(x=>x[0]==='logout'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Invitation par e-mail : une adresse non vérifiée ne reçoit aucun accès automatique',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(){return 'admin-session';},async logout(){calls.push('logout');},async change(){},
    async claim(){calls.push('claim');return {ok:true,status:'pending'};},
    async resend(email,password){calls.push(['resend',email,password]);return {verified:false};},
    async api(path){
      calls.push(path);
      if(path==='/api/auth/admin-account-status')throw Object.assign(Error('Accès administrateur refusé.'),{status:403});
      if(path==='/api/auth/admin-invitations/accept')throw Object.assign(Error('Confirmez d’abord l’adresse e-mail du compte invité.'),{status:403});
      throw Error('aucune donnée admin avant vérification');
    },
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'invite@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Mot-de-passe-personnel-2026');
    await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/Confirmez votre adresse avec le lien reçu/);assert.match(text(tree.toJSON()),/nouvelle invitation/);assert.equal(values.has('pulse-admin-token'),false);
    assert(calls.includes('logout'));assert(!calls.includes('/api/admin/all'));assert(!calls.includes('claim'),'la nouvelle invitation prime sur une ancienne demande manuelle');
    assert(!calls.some(x=>Array.isArray(x)&&x[0]==='resend'));
    assert.doesNotMatch(text(tree.toJSON()),/Renvoyer le lien de confirmation|Aide à la connexion|Anciennes demandes/);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Connexion simplifiée : demande de lien depuis une adresse préremplie, sans changement de session',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});let tree,resolveReset;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  put('__directLogin',{
    reset(address){calls.push(['reset',address]);return new Promise(resolve=>{resolveReset=resolve;});},
    async login(...args){calls.push(['login',...args]);throw Error('aucune connexion automatique');},async logout(){calls.push(['logout']);},
    async api(...args){calls.push(['api',...args]);throw Error('aucune requête Worker');},
  });
  const button=label=>tree.root.findAllByType('button').find(node=>text(node).trim()===label);
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    assert.match(text(tree.toJSON()),/Connectez-vous avec votre adresse e-mail et votre mot de passe/);
    assert.doesNotMatch(text(tree.toJSON()),/Anciennes demandes|Gardez la main|Créer mon accès avec un code|Aide à la connexion|Première connexion/);
    assert(button('Mot de passe oublié ?'));assert(!button('Aide à la connexion'));
    assert.deepEqual(tree.root.findAllByType('input').map(node=>node.props.id),['admin-email','admin-password']);
    assert.deepEqual(tree.root.findAllByType('button').map(node=>text(node).trim()||node.props['aria-label']),['Fermer','Se connecter','Mot de passe oublié ?']);
    assert.equal(tree.root.findAllByType('a').length,0,'aucun lien de secours visible');
    await set(tree.root.findByProps({id:'admin-email'}),' admin@example.test ');
    await set(tree.root.findByProps({id:'admin-password'}),'secret-fictif');
    await act(async()=>button('Mot de passe oublié ?').props.onClick());
    const input=tree.root.findByProps({id:'admin-reset-email'});assert.equal(input.props.value,' admin@example.test ');assert.equal(input.props.type,'email');
    assert.equal(input.props.required,true);assert.equal(input.props.autoComplete,'email');assert.match(text(tree.toJSON()),/reconnexion peut être nécessaire sur vos autres appareils/);
    const form=()=>tree.root.findByType('form');
    await act(async()=>{form().props.onSubmit({preventDefault(){}});form().props.onSubmit({preventDefault(){}});await tick();});
    assert.deepEqual(calls,[['reset','admin@example.test']]);assert.equal(button('Demande en cours…').props.disabled,true);
    await act(async()=>{resolveReset();await tick();await tick();});
    assert.match(text(tree.toJSON()),/Si un compte compatible existe/);assert.match(text(tree.toJSON()),/courriers indésirables/);
    assert.equal(values.has('pulse-admin-token'),false);assert.deepEqual(calls,[['reset','admin@example.test']]);
    await act(async()=>button('Retour à la connexion').props.onClick());
    assert.equal(tree.root.findByProps({id:'admin-email'}).props.value,'admin@example.test');
    assert.equal(tree.root.findByProps({id:'admin-password'}).props.value,'');
    assert.doesNotMatch(text(tree.toJSON()),/secret-fictif|Anciennes demandes|Aide à la connexion/);
    assert.deepEqual(tree.root.findAllByType('button').map(node=>text(node).trim()||node.props['aria-label']),['Fermer','Se connecter','Mot de passe oublié ?']);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [name,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});

test('Mot de passe oublié : erreur et même erreur réaffichée au nouvel essai',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const put=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});let tree,attempts=0;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:()=>null,setItem(){},removeItem(){}});
  put('__directLogin',{async reset(){attempts++;throw Error('Trop de demandes. Réessayez plus tard.');},async logout(){},async api(){throw Error('aucune requête Worker');}});
  const button=label=>tree.root.findAllByType('button').find(node=>text(node)===label);
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await act(async()=>button('Mot de passe oublié ?').props.onClick());
    await set(tree.root.findByProps({id:'admin-reset-email'}),'admin@example.test');
    const submit=async()=>act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    await submit();assert.equal(attempts,1);assert.match(text(tree.toJSON()),/Trop de demandes/);
    let popup=tree.root.findByProps({className:'visible-feedback visible-feedback-dialog is-error'});assert.match(text(popup),/Trop de demandes/);
    await act(async()=>popup.findByProps({'aria-label':'Fermer ce message'}).props.onClick({currentTarget:{}}));
    assert.equal(tree.root.findAllByProps({className:'visible-feedback visible-feedback-dialog is-error'}).length,0);
    await submit();assert.equal(attempts,2);popup=tree.root.findByProps({className:'visible-feedback visible-feedback-dialog is-error'});assert.match(text(popup),/Trop de demandes/);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [name,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});

test('Session administrateur existante : ouverture et fermeture ne la modifient pas',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map([['pulse-admin-token','admin-session']]),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree,closed=0;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(){calls.push('login');throw Error('aucune nouvelle connexion');},
    async logout(){calls.push('logout');throw Error('aucune déconnexion');},
    async api(path,options={}){calls.push([path,options.method||'GET']);if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},departmentsByStore:{}};throw Error('requête inattendue');},
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){closed++;},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();await tick();});
    assert(tree.root.findByProps({'aria-label':'Administration'}));assert.equal(values.get('pulse-admin-token'),'admin-session');
    await act(async()=>tree.root.findByProps({'aria-label':'Fermer'}).props.onClick());
    assert.equal(closed,1);assert.equal(values.get('pulse-admin-token'),'admin-session');
    assert(!calls.includes('login')&&!calls.includes('logout'));assert.deepEqual(calls.filter(x=>Array.isArray(x)).map(x=>x[0]),['/api/admin/all']);
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});

test('Compte déjà administrateur non vérifié : expliquer le blocage sans promettre une invitation',async()=>{
  const names=['document','window','sessionStorage','__directLogin'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const values=new Map(),calls=[],put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});let tree;
  put('document',{body:{style:{overflow:''}},activeElement:null,addEventListener(){},removeEventListener(){}});put('window',{confirm:()=>true});
  put('sessionStorage',{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  put('__directLogin',{
    async login(){return 'admin-session';},async logout(){calls.push('logout');},
    async api(path){calls.push(path);if(path==='/api/auth/admin-account-status')throw Object.assign(Error('Confirmez votre adresse e-mail avec le lien reçu avant de vous connecter.'),{status:403});throw Error('aucune donnée admin avant vérification');},
  });
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(Admin,{onClose(){},onChanged(){},data:{stores:[],services:[]},session:null}));await tick();});
    await set(tree.root.findByProps({id:'admin-email'}),'admin@example.test');await set(tree.root.findByProps({id:'admin-password'}),'Personnel-test-2026!');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/Confirmez votre adresse avec le lien reçu/);assert.match(text(tree.toJSON()),/contactez le responsable de Fnac Pulse/);
    assert.doesNotMatch(text(tree.toJSON()),/nouvelle invitation|Renvoyer le lien de confirmation|Aide à la connexion/);
    assert.equal(values.has('pulse-admin-token'),false);assert(calls.includes('logout'));assert(!calls.includes('/api/admin/all'));
  } finally {if(tree)await act(async()=>tree.unmount());for(const [n,d] of old)if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}
});
