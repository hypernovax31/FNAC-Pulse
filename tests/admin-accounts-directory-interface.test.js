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
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:'export const api=(...x)=>globalThis.__adminTest.api(...x); export const uid=()=>"invitation-test-request-01";',loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`
    export const ADMIN_SESSION='admin-session';
    export const deleteTestFirebaseAccount=(...x)=>globalThis.__adminTest.deleteTest?.(...x);
    export const adminAccountEmail=(...x)=>globalThis.__adminTest.email(...x);
    export const changeAdminPassword=(...x)=>globalThis.__adminTest.password(...x);
    export const inviteAdministrator=(...x)=>globalThis.__adminTest.invite(...x);
    export const createDirectAdministrator=(...x)=>globalThis.__adminTest.direct(...x);
    export const createAdminEnrollmentCode=(...x)=>globalThis.__adminTest.code(...x);
    export const cancelAdminEnrollmentCode=(...x)=>globalThis.__adminTest.cancelCode(...x);
    export const changeFirstCodeAdminPassword=(...x)=>globalThis.__adminTest.firstCodePassword(...x);
    export const registerAdminWithCode=(...x)=>globalThis.__adminTest.registerCode(...x);
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
const {AdminAccounts}=await load('src/AdminAccounts.jsx'),{AdminTestCleanup}=await load('src/AdminTestCleanup.jsx'),{LegacyAdminRequests}=await load('src/LegacyAdminRequests.jsx'),{AdminFirstPassword}=await load('src/AdminFirstPassword.jsx'),{AdminCodeRegistration}=await load('src/AdminCodeRegistration.jsx'),{AdminInvitationHelp}=await load('src/AdminInvitationHelp.jsx'),{DirectoryImport}=await load('src/DirectoryImport.jsx'),{AdminTabs}=await load('src/AdminTabs.jsx');
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const form=(tree,id)=>tree.root.findByProps({'aria-labelledby':id}).findAllByType('form')[0];
const change=async(input,value)=>act(async()=>{input.props.onChange({target:{value}});await tick();});
const submit=async(form)=>act(async()=>{form.props.onSubmit({preventDefault(){}});await tick();await tick();});
function setup(){
  const names=['document','window','navigator','__adminTest'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)])),e={calls:[],confirms:[],allow:true};
  const put=(n,value)=>Object.defineProperty(globalThis,n,{configurable:true,writable:true,value});
  put('document',{visibilityState:'visible',addEventListener(){},removeEventListener(){}});
  put('window',{location:{origin:'https://example.test'},confirm:q=>{e.confirms.push(q);return e.allow;},addEventListener(){},removeEventListener(){}});
  put('navigator',{clipboard:{async writeText(value){e.clipboard=value;}}});
  put('__adminTest',{
    async api(...args){e.calls.push(['api',...args]);return {imported:50,reviewCount:1};},
    async email(...args){e.calls.push(['email',...args]);return 'responsable@example.test';},
    async password(...args){e.calls.push(['password',...args]);},
    async address(...args){e.calls.push(['address',...args]);},
    async inspect(...args){e.calls.push(['inspect',...args]);return {code:'code-fictif',newEmail:'nouvelle@example.test'};},
    async confirm(...args){e.calls.push(['confirm',...args]);return {email:'nouvelle@example.test',refreshed:true};},
    async invite(...args){e.calls.push(['invite',args[1]]);return {alreadyAccepted:false,accountCreated:true};},
    async direct(...args){e.calls.push(['direct',args[1]]);return {already:false,accountCreated:true};},
    async code(...args){e.calls.push(['code',...args]);return {code:'ABCD-EFGH-JKLM-NPQR',expiresAt:Date.now()+86400000};},
    async cancelCode(...args){e.calls.push(['cancelCode',...args]);return {ok:true};},
    async firstCodePassword(...args){e.calls.push(['firstCodePassword',...args]);},
    async registerCode(...args){e.calls.push(['registerCode',args[1]]);return {ok:true};},
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

test('Administrateur : panneau épuré, invitation par adresse, droits globaux et annulation',async()=>{
  const e=setup(),busy=[],invitations=[];let tree,loggedOut=0;
  globalThis.__adminTest.api=async(path,options={})=>{
    e.calls.push(['api',path,options]);
    if(path==='/api/admin/invitations'&&!options.method)return {invitations:structuredClone(invitations)};
    if(path==='/api/admin/invitations/cancel'){invitations.splice(0);return {ok:true};}
    return {ok:true};
  };
  globalThis.__adminTest.invite=async(_api,body)=>{e.calls.push(['invite',body]);invitations.push({...body,expiresAt:Date.now()+86400000});return {alreadyAccepted:false};};
  const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onBusy:x=>busy.push(x),onLogout:()=>loggedOut++}));await tick();});
    assert.match(text(tree.toJSON()),/responsable@example\.test/);assert.match(text(tree.toJSON()),/recevra un lien de connexion/);
    assert.doesNotMatch(text(tree.toJSON()),/Modifier mon e-mail|mot de passe provisoire|Demandes précédentes sans e-mail|Supprimer le compte de test précédent/);
    assert(!e.calls.some(x=>typeof x[1]==='string'&&(/\/access-requests|\/old-test\//).test(x[1])),'aucun chargement ni nettoyage des anciennes données');
    const invite=()=>form(tree,'admin-invite-title');assert.equal(invite().findAllByType('input').length,1);
    await change(invite().findByType('input'),' NOUVEAU@example.test ');await submit(invite());
    assert.equal(e.calls.filter(x=>x[0]==='invite').length,0,'une confirmation précède l’envoi');
    assert.match(text(tree.toJSON()),/Inviter nouveau@example\.test/);assert.match(text(tree.toJSON()),/tous les magasins/);
    await submit(invite());
    assert.deepEqual(e.calls.find(x=>x[0]==='invite')[1],{email:'nouveau@example.test',requestId:'invitation-test-request-01'});
    assert.match(text(tree.toJSON()),/Demande d’e-mail envoyée/);assert.match(text(tree.toJSON()),/En attente/);
    assert(!e.calls.some(x=>x[1]==='/api/admin/access-requests'&&x[2]?.method==='POST'),'aucune nouvelle demande manuelle');
    const pending=tree.root.findByProps({'aria-labelledby':'admin-pending-title'});
    e.allow=false;await act(async()=>pending.findAllByType('button').find(x=>text(x)==='Annuler').props.onClick());
    assert(!e.calls.some(x=>x[1]==='/api/admin/invitations/cancel'));
    e.allow=true;await act(async()=>{pending.findAllByType('button').find(x=>text(x)==='Annuler').props.onClick();await tick();await tick();});
    const cancel=e.calls.find(x=>x[1]==='/api/admin/invitations/cancel');
    assert.deepEqual(cancel[2].body,{email:'nouveau@example.test',requestId:'invitation-test-request-01',confirmed:true});assert.match(e.confirms.at(-1),/aucun compte ne sera supprimé/);
    await act(async()=>button('Modifier mon mot de passe').props.onClick());
    const pw=()=>tree.root.findByProps({className:'admin-account-password-form'}),fields=()=>pw().findAllByType('input');
    await change(fields()[0],'Ancien-password-2026!');await change(fields()[1],'Nouveau-password-2026!');await change(fields()[2],'incorrect');await submit(pw());
    assert.match(text(tree.toJSON()),/ne correspondent pas/);assert(!e.calls.some(x=>x[0]==='password'));
    await change(fields()[2],'Nouveau-password-2026!');await submit(pw());
    assert.deepEqual(e.calls.find(x=>x[0]==='password').slice(1),['Ancien-password-2026!','Nouveau-password-2026!']);
    await act(async()=>button('Se déconnecter').props.onClick());assert.equal(loggedOut,1);
    assert.equal(busy.filter(Boolean).length,4);assert.equal(busy.filter(x=>!x).length,4);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Compatibilité hors panneau : une ancienne demande ne change de droit qu’après validation explicite',async()=>{
  const e=setup(),requests=[{email:'ancien@example.test',requestId:'legacy-request-001',status:'pending',claimantUid:'old-uid'}];let tree;
  globalThis.__adminTest.api=async(path,options={})=>{
    e.calls.push(['api',path,options]);
    if(path==='/api/admin/access-requests')return {requests:structuredClone(requests)};
    if(path.endsWith('/approve')){requests.splice(0);return {ok:true};}
    throw Error('unexpected '+path);
  };
  const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(LegacyAdminRequests,{}));await tick();});
    await act(async()=>button('Vérifier').props.onClick());
    assert.match(text(tree.toJSON()),/identité par un autre moyen/);assert.match(text(tree.toJSON()),/adresse n’est pas vérifiée automatiquement/);
    assert.equal(button('Valider l’accès').props.disabled,true);assert(!e.calls.some(x=>x[1]?.endsWith?.('/approve')));
    const checkbox=tree.root.findAllByType('input').find(x=>x.props.type==='checkbox');await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    await act(async()=>{button('Valider l’accès').props.onClick();await tick();await tick();});
    assert.deepEqual(e.calls.find(x=>x[1]?.endsWith?.('/approve'))[2].body,{email:'ancien@example.test',requestId:'legacy-request-001',claimantUid:'old-uid',confirmed:true,identityVerified:true});
    assert.match(text(tree.toJSON()),/Accès validé/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Administrateur : réauthentification seulement si nécessaire et reprise avec le même identifiant',async()=>{
  const e=setup(),attempts=[];let tree;
  globalThis.__adminTest.api=async(path)=>path==='/api/admin/access-requests'?{requests:[]}:{invitations:[]};
  globalThis.__adminTest.invite=async(_api,body)=>{
    attempts.push({...body});
    if(attempts.length===1)throw Object.assign(Error('Confirmez à nouveau votre mot de passe administrateur.'),{status:401});
    if(attempts.length===2)throw Error('Envoi non confirmé. Réessayez.');
    return {alreadyAccepted:false};
  };
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminAccounts,{onLogout(){}}));await tick();});
    const invite=()=>form(tree,'admin-invite-title');await change(invite().findByType('input'),'invité@example.test');await submit(invite());await submit(invite());
    assert.equal(attempts.length,1);assert.equal(attempts[0].currentPassword,undefined);
    assert.match(text(tree.toJSON()),/confirmez votre mot de passe administrateur/);
    await change(invite().findByType('input'),'secret-admin-test');await submit(invite());assert.match(text(tree.toJSON()),/Envoi non confirmé/);
    await submit(invite());assert.equal(attempts.length,3);assert.equal(new Set(attempts.map(x=>x.requestId)).size,1);
    assert.equal(attempts[1].currentPassword,'secret-admin-test');assert.equal(attempts[2].currentPassword,'secret-admin-test');
    assert.match(text(tree.toJSON()),/Demande d’e-mail envoyée/);assert.doesNotMatch(text(tree.toJSON()),/secret-admin-test/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Compatibilité hors panneau : nettoyage du test strictement ciblé et confirmé',async()=>{
  const e=setup(),busy=[];let tree,deleteCalls=0;
  globalThis.__adminTest.api=async(path,options={})=>{e.calls.push(['api',path,options]);
    if(path==='/api/admin/access-requests')return {requests:[]};
    if(path==='/api/admin/invitations')return {invitations:[]};
    if(path==='/api/admin/old-test/inspect')return {found:true,email:options.body.email,uid:'test-uid-001',grantActive:true};
    if(path==='/api/admin/old-test/revoke')return {ok:true,uid:'test-uid-001'};
    throw Error('unexpected '+path);
  };
  globalThis.__adminTest.deleteTest=async(_api,details)=>{deleteCalls++;e.calls.push(['deleteTest',details]);};
  const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminTestCleanup,{onBusy:x=>busy.push(x)}));await tick();});
    const details=tree.root.findByProps({className:'admin-test-cleanup'}),lookup=details.findAllByType('form')[0];
    await change(lookup.findByType('input'),'TEST@example.test');await submit(lookup);
    assert.match(text(details),/test@example\.test/);assert.match(text(details),/test-uid-001/);
    assert.equal(button('Retirer les droits de ce test').props.disabled,true);assert.equal(deleteCalls,0);
    await act(async()=>details.findAllByType('input').find(x=>x.props.type==='checkbox').props.onChange({target:{checked:true}}));
    await act(async()=>{button('Retirer les droits de ce test').props.onClick();await tick();await tick();});
    assert.deepEqual(e.calls.find(x=>x[1]==='/api/admin/old-test/revoke')[2].body,{email:'test@example.test',uid:'test-uid-001',confirmed:true});
    assert.match(text(details),/Le compte Firebase existe peut-être encore/);assert.equal(deleteCalls,0);
    const password=details.findAllByType('input').find(x=>x.props.type==='password');await change(password,'mot-de-passe-test');
    const deletion=details.findAllByType('form').at(-1);e.allow=false;await submit(deletion);assert.equal(deleteCalls,0);
    e.allow=true;await submit(deletion);assert.equal(deleteCalls,1);assert.equal(e.calls.find(x=>x[0]==='deleteTest')[1].uid,'test-uid-001');
    assert.match(text(details),/compte Firebase a été supprimé/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Destinataire du code : adresse, provisoire de 1 à 6 caractères et consentement',async()=>{
  const e=setup(),registered=[],busy=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminCodeRegistration,{onRegistered:async email=>registered.push(email),onCancel(){},onBusy:x=>busy.push(x)}));await tick();});
    const f=()=>tree.root.findByType('form'),inputs=()=>f().findAllByType('input');
    assert.match(text(tree.toJSON()),/avant tout accès/);assert.match(text(tree.toJSON()),/Firebase ne vérifiera pas/);
    await change(inputs()[0],'ABCD-EFGH-JKLM-NPQR');await change(inputs()[1],'NOUVEAU@example.test');
    await change(inputs()[2],'1234567');assert.equal(inputs()[2].props.value,'123456','saisie limitée à six caractères');
    await change(inputs()[2],'a');await change(inputs()[3],'b');await submit(f());
    assert.match(text(tree.toJSON()),/Confirmez que vous contrôlez/);assert.equal(e.calls.filter(x=>x[0]==='registerCode').length,0);
    await act(async()=>inputs()[4].props.onChange({target:{checked:true}}));await submit(f());assert.match(text(tree.toJSON()),/ne correspondent pas/);
    await change(inputs()[3],'a');await submit(f());
    assert.deepEqual(e.calls.find(x=>x[0]==='registerCode')[1],{code:'ABCD-EFGH-JKLM-NPQR',email:'NOUVEAU@example.test',password:'a'});
    assert.deepEqual(registered,['nouveau@example.test']);assert.deepEqual(busy,[true,false]);
    assert.equal(inputs()[2].props.value,'');assert.doesNotMatch(text(tree.toJSON()),/ABCD-EFGH-JKLM-NPQR/);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Première connexion par code : mot de passe personnel imposé sans ressaisie du provisoire',async()=>{
  const e=setup(),finished=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminFirstPassword,{email:'nouveau@example.test',method:'code',onFinish:async p=>finished.push(p),onCancel(){}}));await tick();});
    const f=()=>tree.root.findByType('form'),inputs=()=>f().findAllByType('input');assert.equal(inputs().length,2);
    await change(inputs()[0],'Personnel-test-2026!');await change(inputs()[1],'incorrect-2026!');await submit(f());
    assert.match(text(tree.toJSON()),/ne correspondent pas/);assert.equal(e.calls.filter(x=>x[0]==='firstCodePassword').length,0);
    await change(inputs()[1],'Personnel-test-2026!');await submit(f());
    assert.deepEqual(e.calls.find(x=>x[0]==='firstCodePassword').slice(1),['Personnel-test-2026!']);assert.deepEqual(finished,['Personnel-test-2026!']);
    assert.equal(e.calls.filter(x=>x[0]==='password').length,0);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Première connexion : choix personnel obligatoire, égalité et confirmation contrôlées',async()=>{
  const e=setup(),calls=[],busy=[];let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminFirstPassword,{email:'nouveau@example.test',onFinish:async()=>calls.push('finish'),onCancel:()=>calls.push('cancel'),onBusy:x=>busy.push(x)}));await tick();});
    const f=()=>tree.root.findByType('form'),inputs=()=>f().findAllByType('input');
    assert.match(text(tree.toJSON()),/avant d’accéder à l’administration/);
    await change(inputs()[0],'Provisoire-test-2026!');await change(inputs()[1],'Provisoire-test-2026!');await change(inputs()[2],'Provisoire-test-2026!');await submit(f());
    assert.match(text(tree.toJSON()),/différent du mot de passe provisoire/);assert.equal(e.calls.filter(x=>x[0]==='password').length,0);
    await change(inputs()[1],'Personnel-test-2026!');await change(inputs()[2],'incorrect-2026!');await submit(f());
    assert.match(text(tree.toJSON()),/ne correspondent pas/);assert.equal(e.calls.filter(x=>x[0]==='password').length,0);
    await change(inputs()[2],'Personnel-test-2026!');await submit(f());
    assert.deepEqual(e.calls.find(x=>x[0]==='password').slice(1),['Provisoire-test-2026!','Personnel-test-2026!']);assert.deepEqual(calls,['finish']);
    assert.doesNotMatch(text(tree.toJSON()),/Provisoire-test-2026!|Personnel-test-2026!/);assert.equal(busy.length,6);
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});

test('Première connexion : changement confirmé mais réponse perdue, reprise sans deuxième modification',async()=>{
  const e=setup();let tree,attempts=0;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(AdminFirstPassword,{email:'nouveau@example.test',onFinish:async()=>{if(++attempts===1)throw Error('hors ligne');},onCancel(){}}));await tick();});
    const f=tree.root.findByType('form'),inputs=f.findAllByType('input');
    await change(inputs[0],'Provisoire-test-2026!');await change(inputs[1],'Personnel-test-2026!');await change(inputs[2],'Personnel-test-2026!');await submit(f);
    assert.match(text(tree.toJSON()),/Mot de passe modifié, mais l’accès n’est pas encore confirmé/);
    await act(async()=>{tree.root.findAllByType('button').find(x=>text(x).includes('Terminer')).props.onClick();await tick();await tick();});
    assert.equal(attempts,2);assert.equal(e.calls.filter(x=>x[0]==='password').length,1);
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

test('Compatibilité hors panneau : pagination et actualisation des anciennes demandes',async()=>{
  const e=setup();let tree;
  globalThis.__adminTest.api=async(path)=>{
    e.calls.push(['api',path]);
    if(path==='/api/admin/invitations')return {invitations:[]};
    if(path==='/api/admin/access-requests')return {requests:[{email:'premier@example.test',requestId:'request-first-001',status:'invited'}],next:'cursor-first'};
    if(path==='/api/admin/access-requests?after=cursor-first')return {requests:[{email:'suivant@example.test',requestId:'request-second-01',status:'pending',claimantUid:'uid-second'}],next:null};
    throw Error('unexpected '+path);
  };
  const button=caption=>tree.root.findAllByType('button').find(x=>text(x).includes(caption));
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(LegacyAdminRequests,{}));await tick();});
    assert.match(text(tree.toJSON()),/premier@example\.test/);assert(button('Charger la suite'));
    await act(async()=>{button('Charger la suite').props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/premier@example\.test/);assert.match(text(tree.toJSON()),/suivant@example\.test/);assert(!button('Charger la suite'));
    await act(async()=>{tree.root.findByProps({'aria-label':'Actualiser les anciennes demandes'}).props.onClick();await tick();});
    assert.match(text(tree.toJSON()),/premier@example\.test/);assert.doesNotMatch(text(tree.toJSON()),/suivant@example\.test/);assert(button('Charger la suite'));
  } finally {if(tree)await act(async()=>tree.unmount());e.restore();}
});
