import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const output=await build({stdin:{contents:"export {SessionForm} from './src/App.jsx'; export {VisibleFeedbackProvider} from './src/VisibleFeedback.jsx';",resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],define:{'import.meta.env':'{"BASE_URL":"/"}'},logLevel:'silent',plugins:[{name:'onboarding-mocks',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__onboardingApi(...x); export const uid=()=>"test-uid";export const dateLabel=()=>"";export const timeLabel=()=>"";export const kmBetween=()=>0;`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`export const claimAdminAccess=(...x)=>globalThis.__directLogin?.claim?.(...x),registerAdminForApproval=(...x)=>globalThis.__directLogin?.manualRegister?.(...x),deleteTestFirebaseAccount=()=>{}; export const CLOUD=true,ADMIN_SESSION='admin'; export const adminLogin=()=>{};export const adminLogout=()=>{};export const changeAdminPassword=()=>{}; export const adminAccountEmail=async()=>"admin@example.test"; export const createAdministrator=()=>{}; export const createDirectAdministrator=()=>{}; export const createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=()=>{},changeFirstCodeAdminPassword=()=>{}; export const inviteAdministrator=()=>{},requestAdminPasswordReset=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{}; export const requestAdminEmailChange=()=>{};export const inspectAdminEmailChange=()=>{};export const confirmAdminEmailChange=()=>{}; export const resendAdminVerification=()=>{}; export const observeVendor=()=>{}; export const sellerLogin=()=>{};export const sellerChoosePin=()=>{};export const sellerMigratePin=()=>{};export const sellerRegister=()=>{};export const sellerLogout=()=>{};export const listenStore=()=>{};export const prepareFcm=()=>{};export const subscribeFcm=()=>{};export const unsubscribeFcm=()=>{};export const notificationsWanted=()=>false;`,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const {SessionForm,VisibleFeedbackProvider}=module.exports;
const data={stores:[{id:'store-1',name:'Fnac Test',active:true}],sellers:[{id:1,name:'Morgan',storeId:'store-1',departmentId:'tech',active:true},{id:2,name:'Élodie',storeId:'store-1',departmentId:'editorial',active:true}],services:[],departmentsByStore:{'store-1':[{id:'tech',name:'Technique',active:true},{id:'editorial',name:'Éditorial',active:true}]}};
const text=node=>typeof node==='string'?node:!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const field=(tree,label)=>tree.root.findByProps({'aria-label':label});
const click=(tree,label)=>tree.root.findAllByType('button').find(x=>text(x).includes(label));
function apiMock(fn){const old=Object.getOwnPropertyDescriptor(globalThis,'__onboardingApi');Object.defineProperty(globalThis,'__onboardingApi',{configurable:true,value:fn});return ()=>{if(old)Object.defineProperty(globalThis,'__onboardingApi',old);else delete globalThis.__onboardingApi;};}
async function change(tree,label,value){await act(async()=>{field(tree,label).props.onChange({target:{value}});await tick();});}
async function chooseScope(tree){
  await change(tree,'Votre magasin Fnac','Fnac Test');
  await act(async()=>{tree.root.findByProps({role:'option'}).props.onClick();await tick();});
  await change(tree,'Votre département','tech');
}

test('Mention régionale : avertissement et accord explicite avant création seulement',async()=>{
  const submissions=[],restore=apiMock(async()=>({needsPin:true}));let tree;
  const regional={...data,stores:[...data.stores,{id:'fnac-region-guadeloupe',name:'Fnac Guadeloupe',directoryStatus:'regional-choice',active:true}],departmentsByStore:{...data.departmentsByStore,'fnac-region-guadeloupe':[{id:'tech',name:'Technique',active:true}]}};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:regional,onSubmit:async(...args)=>submissions.push(args)}));});
    await change(tree,'Votre magasin Fnac','guadeloupe');
    assert.match(text(tree.toJSON()),/Mention régionale · espace commun/);
    await act(async()=>{tree.root.findByProps({role:'option'}).props.onClick();await tick();});
    assert.equal(field(tree,'Votre magasin Fnac').props.value,'Fnac Guadeloupe');
    assert.match(text(tree.toJSON()),/ne désigne pas un magasin précis/);
    assert.match(text(tree.toJSON()),/bilans sont communs.*notifications partagées/);
    assert.match(text(tree.toJSON()),/ajouter leurs noms précis/);
    await change(tree,'Votre département','tech');await change(tree,'Votre prénom','Alice');
    await change(tree,'Votre nouveau code PIN','4829');await change(tree,'Confirmer votre code PIN','4829');
    assert.equal(click(tree,'Créer mon profil').props.disabled,true);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,0);assert.match(text(tree.toJSON()),/Confirmez avoir compris/);
    await act(async()=>{tree.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});await tick();});
    assert.equal(click(tree,'Créer mon profil').props.disabled,false);
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,1);assert.equal(submissions[0][0].storeId,'fnac-region-guadeloupe');assert.equal(submissions[0][2].regionalConsent,true);
    // Un profil déjà enregistré ne doit pas être bloqué par une nouvelle case.
    await act(async()=>tree.unmount());
    const existing={...regional,sellers:[...regional.sellers,{id:3,name:'Charlie',storeId:'fnac-region-guadeloupe',departmentId:'tech',active:true}]};
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:existing,initialProfile:{storeId:'fnac-region-guadeloupe',sellerId:3},onSubmit:async()=>{}}));await tick();});
    assert.equal(tree.root.findAllByProps({type:'checkbox'}).length,0);assert.match(text(tree.toJSON()),/Profil sur cet appareil/i);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Inscription : prénom libre puis deux PIN à 4 chiffres avant création',async()=>{
  const requests=[],submissions=[],restore=apiMock(async(...args)=>{requests.push(args);return {needsPin:true};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async(...args)=>submissions.push(args)}));});
    await chooseScope(tree);await change(tree,'Votre prénom','Alice');
    assert.match(text(tree.toJSON()),/Créez votre profil/);assert.match(text(tree.toJSON()),/Vérifiez votre département : il ne pourra plus être modifié/);
    assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);assert.equal(requests.length,0);
    await change(tree,'Votre nouveau code PIN','4829');await change(tree,'Confirmer votre code PIN','4828');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});assert.equal(submissions.length,0);assert.match(text(tree.toJSON()),/ne correspondent pas/);
    await change(tree,'Confirmer votre code PIN','4829');await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,1);assert.deepEqual(submissions[0][0],{storeId:'store-1',departmentId:'tech'});assert.equal(submissions[0][1],'4829');assert.equal(submissions[0][2].mode,'register');assert.equal(submissions[0][2].name,'Alice');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Prénom existant : migration avec ancien PIN, sans nouveau profil',async()=>{
  const requests=[],submissions=[],restore=apiMock(async(path,options)=>{requests.push({path,...options});return {needsPin:false};});let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async(...args)=>submissions.push(args)}));});await chooseScope(tree);await change(tree,'Votre prénom','morgan');
    assert.equal(requests.length,1);assert.equal(requests[0].body.sellerId,1);assert.match(text(tree.toJSON()),/Profil existant : Morgan/);assert.match(text(tree.toJSON()),/Passez à un PIN de 4 chiffres/);
    assert.equal(field(tree,'Ancien code PIN à 8 chiffres').props.maxLength,8);assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);
    await change(tree,'Ancien code PIN à 8 chiffres','73628519');await change(tree,'Votre nouveau code PIN','7284');await change(tree,'Confirmer votre code PIN','7284');
    await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions.length,1);assert.deepEqual(submissions[0][0],{storeId:'store-1',departmentId:'tech',sellerId:1});assert.equal(submissions[0][2].mode,'migrate');assert.equal(submissions[0][2].oldPin,'73628519');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Profil existant sans PIN : premier code à 4 chiffres ; mauvais département bloqué',async()=>{
  const restore=apiMock(async()=>({needsPin:true}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async()=>{}}));});await chooseScope(tree);await change(tree,'Votre prénom','Elodie');
    assert.match(text(tree.toJSON()),/autre département/);assert.equal(click(tree,'Créer mon profil'),undefined);
    await act(async()=>{click(tree,'Utiliser le profil Élodie · Éditorial').props.onClick();await tick();});
    assert.equal(field(tree,'Votre département').props.value,'editorial');assert.match(text(tree.toJSON()),/Profil existant : Élodie/);assert.match(text(tree.toJSON()),/Première connexion/);
    await change(tree,'Votre département','tech');await change(tree,'Votre prénom','Morgan');assert.match(text(tree.toJSON()),/Première connexion/);assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);assert.equal(click(tree,'Créer mon profil'),undefined);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Profil mémorisé : connexion à 4 chiffres sans redemander le prénom',async()=>{
  const submissions=[],restore=apiMock(async()=>({needsPin:false,pinLength:4,pinSalt:'salt-profil-1234567890'}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,initialProfile:{storeId:'store-1',sellerId:1},onSubmit:async(...x)=>submissions.push(x)}));await tick();});
    assert.equal(tree.root.findAllByProps({'aria-label':'Votre prénom'}).length,0);assert.match(text(tree.toJSON()),/VOTRE PROFIL SUR CET APPAREIL/);assert.equal(field(tree,'Code PIN personnel').props.maxLength,4);
    await change(tree,'Code PIN personnel','4829');await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await tick();});
    assert.equal(submissions[0][2].mode,'login');assert.equal(submissions[0][2].pinSalt,'salt-profil-1234567890');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Un nom existant saisi par l’administrateur reste utilisable même avec un caractère particulier',async()=>{
  const restore=apiMock(async()=>({needsPin:false,pinLength:4})),custom={...data,sellers:[...data.sellers,{id:3,name:'Jean/Léo',storeId:'store-1',departmentId:'tech',active:true}]};let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:custom,onSubmit:async()=>{}}));});await chooseScope(tree);await change(tree,'Votre prénom','Jean/Léo');
    assert.match(text(tree.toJSON()),/Profil existant : Jean\/Léo/);assert(!text(tree.toJSON()).includes('Saisissez un prénom valide'));assert.equal(field(tree,'Code PIN personnel').props.maxLength,4);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Recherche sans sélection : aide hors de la rangée et géolocalisation toujours utilisable',async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator'),restore=apiMock(async()=>({needsPin:true}));let tree;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(ok){ok({coords:{latitude:43,longitude:1}});}}}});
  const located={...data,stores:data.stores.map(store=>({...store,lat:43,lon:1}))};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:located,onSubmit:async()=>{}}));});
    await change(tree,'Votre magasin Fnac','aucun résultat');
    const hint=tree.root.findByProps({className:'store-search-hint'});
    assert.equal(hint.parent.props.className.trim(),'session-form'); // L’aide ne décale pas les boutons au moment du clic.
    assert.equal(field(tree,'Votre département').props.disabled,true);
    await act(async()=>{field(tree,'Trouver un magasin proche').props.onClick();await tick();});
    assert.equal(field(tree,'Votre magasin Fnac').props.value,'Fnac Test');
    assert.equal(field(tree,'Votre département').props.disabled,false);
    assert.match(text(tree.toJSON()),/Fnac Test proposé/);
  } finally {if(tree)await act(async()=>tree.unmount());restore();if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator;}
});

test('Prénoms : suggestions visibles, limitées au magasin et au département, sélection clavier sans doublon',async()=>{
  const requests=[],restore=apiMock(async(path,options)=>{requests.push(options.body);return {needsPin:false,pinLength:4,pinSalt:'profil-existant'};});let tree;
  const custom={...data,stores:[...data.stores,{id:'store-2',name:'Fnac Autre',active:true}],sellers:[...data.sellers,
    {id:3,name:'Émilie',storeId:'store-1',departmentId:'tech',active:true},
    {id:4,name:'Elliot',storeId:'store-1',departmentId:'tech',active:true},
    {id:5,name:'Emma',storeId:'store-1',departmentId:'tech',active:false},
    {id:6,name:'Enzo',storeId:'store-2',departmentId:'tech',active:true}]};
  const key=key=>({key,preventDefault(){},stopPropagation(){}}),options=()=>tree.root.findAllByProps({role:'option'}).map(text);
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:custom,onSubmit:async()=>{}}));});
    assert.equal(field(tree,'Votre prénom').props.disabled,true);
    await chooseScope(tree);await act(async()=>field(tree,'Votre prénom').props.onFocus());
    assert.equal(field(tree,'Votre prénom').props.role,'combobox');assert.equal(field(tree,'Votre prénom').props['aria-expanded'],true);
    assert.deepEqual(options(),['Elliot','Émilie','Morgan']);
    await change(tree,'Votre prénom','emil');assert.deepEqual(options(),['Émilie']);
    await act(async()=>field(tree,'Votre prénom').props.onKeyDown(key('ArrowDown')));
    assert.match(field(tree,'Votre prénom').props['aria-activedescendant'],/option-0$/);
    await act(async()=>{field(tree,'Votre prénom').props.onKeyDown(key('Enter'));await tick();});
    assert.equal(field(tree,'Votre prénom').props.value,'Émilie');assert.equal(field(tree,'Votre prénom').props['aria-expanded'],false);
    assert.equal(requests.at(-1).sellerId,3);assert.match(text(tree.toJSON()),/Profil existant : Émilie/);
    assert.equal(field(tree,'Code PIN personnel').props.maxLength,4);assert.equal(click(tree,'Créer mon profil'),undefined);
    await change(tree,'Votre département','editorial');await act(async()=>field(tree,'Votre prénom').props.onFocus());
    assert.deepEqual(options(),['Élodie']);
    await act(async()=>tree.root.findByProps({role:'option'}).props.onClick());assert.equal(field(tree,'Votre prénom').props.value,'Élodie');
    await act(async()=>field(tree,'Votre prénom').props.onFocus());await act(async()=>field(tree,'Votre prénom').props.onKeyDown(key('Escape')));
    assert.equal(field(tree,'Votre prénom').props['aria-expanded'],false);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Prénoms : la saisie libre reste disponible, y compris sans suggestion',async()=>{
  const restore=apiMock(async()=>({needsPin:true}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async()=>{}}));});
    await chooseScope(tree);await change(tree,'Votre prénom','Nouvelle');
    assert.equal(tree.root.findAllByProps({role:'option'}).length,0);
    assert.match(text(tree.toJSON()),/Aucun prénom trouvé dans ce département/);assert.match(text(tree.toJSON()),/Créez votre profil/);
    assert.equal(field(tree,'Votre nouveau code PIN').props.maxLength,4);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Prénoms nombreux : liste bornée, défilement indiqué et recherche dans tous les profils',async()=>{
  const restore=apiMock(async()=>({needsPin:false,pinLength:4}));let tree;
  const custom={...data,sellers:Array.from({length:35},(_,i)=>({id:i+1,name:`Vendeur ${String(i+1).padStart(2,'0')}`,storeId:'store-1',departmentId:'tech',active:true}))};
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data:custom,onSubmit:async()=>{}}));});await chooseScope(tree);
    await act(async()=>field(tree,'Votre prénom').props.onFocus());
    assert.equal(tree.root.findAllByProps({role:'option'}).length,30);assert.match(text(tree.toJSON()),/faites défiler ou précisez votre recherche/);
    await change(tree,'Votre prénom','35');const matches=tree.root.findAllByProps({role:'option'});
    assert.equal(matches.length,1);assert.equal(text(matches[0]),'Vendeur 35');
    await act(async()=>{matches[0].props.onClick();await tick();});assert.match(text(tree.toJSON()),/Profil existant : Vendeur 35/);
    assert.equal(field(tree,'Code PIN personnel').props.maxLength,4);
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Département : l’indication vide reste distincte jusqu’à une sélection',async()=>{
  const restore=apiMock(async()=>({needsPin:true}));let tree;
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(SessionForm,{data,onSubmit:async()=>{}}));await tick();});
    assert.equal(field(tree,'Votre département').props.value,'');assert.equal(field(tree,'Votre département').props.className,'is-placeholder');
    await change(tree,'Votre magasin Fnac','Fnac Test');await act(async()=>{tree.root.findByProps({role:'option'}).props.onClick();await tick();});
    assert.equal(field(tree,'Votre département').props.disabled,false);assert.equal(field(tree,'Votre département').props.className,'is-placeholder');
    await change(tree,'Votre département','tech');assert.equal(field(tree,'Votre département').props.value,'tech');assert.equal(field(tree,'Votre département').props.className,'');
    await change(tree,'Votre département','');assert.equal(field(tree,'Votre département').props.className,'is-placeholder');
  } finally {if(tree)await act(async()=>tree.unmount());restore();}
});

test('Une vérification de profil échouée se réaffiche après chaque nouvelle tentative',async()=>{
  let calls=0,tree;const restore=apiMock(async()=>{calls++;return {};});
  try {
    await act(async()=>{tree=TestRenderer.create(React.createElement(VisibleFeedbackProvider,null,React.createElement(SessionForm,{data,onSubmit:async()=>{}})));});
    await chooseScope(tree);await change(tree,'Votre prénom','Morgan');
    const feedback=()=>tree.root.findByProps({'aria-label':'Message'});
    assert.match(text(feedback()),/Vérification du profil impossible/);assert.equal(calls,1);
    for(let i=0;i<2;i++){
      const retry=feedback().findAllByType('button').find(button=>text(button)==='Vérifier');
      await act(async()=>{retry.props.onClick();await tick();});
      assert.match(text(feedback()),/Vérification du profil impossible/);assert.equal(calls,i+2);
    }
  }finally{if(tree)await act(async()=>tree.unmount());restore();}
});
