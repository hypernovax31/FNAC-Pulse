import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import {build} from 'esbuild';
import {STARTUP_PUSH_PENDING_KEY} from '../src/startup-permissions.js';

const require=createRequire(import.meta.url),{act}=TestRenderer;
const bundled=await build({entryPoints:['src/App.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['react','lucide-react'],define:{'import.meta.env':'{"BASE_URL":"/","VITE_BACKEND":"cloud"}'},logLevel:'silent',plugins:[{name:'startup-fixtures',setup(b){
  b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'mock'}));
  b.onResolve({filter:/^\.\/cloud$/},()=>({path:'cloud',namespace:'mock'}));
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__startupTest.api(...x);export const uid=()=>"test-id";export const dateLabel=()=>"date";export const timeLabel=()=>"heure";export const kmBetween=(a,b,c,d)=>Math.abs(a-c)+Math.abs(b-d);`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`
    export const CLOUD=true,ADMIN_SESSION='admin';
    export const observeVendor=fn=>globalThis.__startupTest.observe(fn);
    export const listenStore=()=>()=>{};
    export const prepareFcm=options=>globalThis.__startupTest.prepare(options);
    export const subscribeFcm=(api,options)=>globalThis.__startupTest.subscribe(api,options);
    export const unsubscribeFcm=()=>globalThis.__startupTest.unsubscribe();
    export const notificationsWanted=()=>localStorage.getItem('fnac-pulse-fcm-enabled')==='1';
    export const sellerLogin=()=>{},sellerChoosePin=()=>{},sellerMigratePin=()=>{},sellerRegister=()=>{},sellerLogout=()=>{},adminLogin=()=>{},adminLogout=()=>{},changeAdminPassword=()=>{};
  `,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const App=module.exports.default;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const session={storeId:'near',sellerId:1,uid:'fictif',accessVersion:'v1'};
const data={stores:[{id:'near',name:'Fnac Près',lat:43.6,lon:1.4,active:true},{id:'far',name:'Fnac Loin',lat:48,lon:2,active:true}],sellers:[{id:1,name:'Morgan',storeId:'near',departmentId:'tech',active:true}],services:[],departmentsByStore:{near:[{id:'tech',name:'Technique',active:true}],far:[{id:'tech',name:'Technique',active:true}]},today:'2026-11-02',stats:null};

function environment({geoPermission='prompt',notificationPermission='default',notificationResult='granted',wanted=false,geoDeferred=false,notificationDeferred=false,auth='manual',existingTouch=true}={}) {
  const names=['window','navigator','document','Notification','localStorage','Audio','__startupTest'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const values=new Map();if(existingTouch)values.set('fnac-pulse-touch-welcome-v1','done');if(wanted)values.set('fnac-pulse-fcm-enabled','1');
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const e={values,gesture:false,notifications:[],locations:[],sounds:[],prepares:0,prepareFails:false,subscriptions:0,requests:[],auth:null,geoSuccess:null};
  const permission={permission:notificationPermission,requestPermission(){
    e.notifications.push({gesture:e.gesture});
    if(notificationDeferred)return new Promise(resolve=>{e.resolveNotification=value=>{this.permission=value;resolve(value);};});
    this.permission=notificationResult;return Promise.resolve(notificationResult);
  }};
  const geo={getCurrentPosition(success,error,options){e.locations.push({gesture:e.gesture,options});if(geoDeferred){e.geoSuccess=success;e.geoError=error;}else success({coords:{latitude:43.61,longitude:1.42}});}};
  const registration={pushManager:{getSubscription:async()=>null}};
  const nav={standalone:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',platform:'iPhone',maxTouchPoints:5,geolocation:geo,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)},permissions:{query:async({name})=>({state:name==='geolocation'?geoPermission:permission.permission,addEventListener(){},removeEventListener(){}})}};
  const media=query=>({matches:query==='(display-mode: standalone)',addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  const win={navigator:nav,isSecureContext:true,PushManager:function(){},Notification:permission,matchMedia:media,addEventListener(){},removeEventListener(){},scrollTo(){}};
  const doc={visibilityState:'visible',body:{style:{}},documentElement:{dataset:{},style:{}},activeElement:null,addEventListener(){},removeEventListener(){},getElementById(){return null;},querySelector(){return null;}};
  const mock={
    observe(fn){e.auth=fn;if(auth!=='manual')queueMicrotask(()=>fn(auth));return ()=>{if(e.auth===fn)e.auth=null;};},
    async api(path,options={}){e.requests.push({path,method:options.method||'GET',body:options.body});if(path.startsWith('/api/bootstrap'))return data;if(path==='/api/goals')return {goals:{}};if(path.startsWith('/api/summary-goals'))return {};return {};},
    async prepare({signal}={}){if(signal?.aborted)throw Error('annulé');e.prepares++;if(e.prepareFails)throw Error('hors ligne');return 'token-fictif';},
    async subscribe(api,{signal}={}){if(signal?.aborted)throw Error('annulé');e.subscriptions++;storage.setItem('fnac-pulse-fcm-enabled','1');return {};},
    async unsubscribe(){storage.removeItem('fnac-pulse-fcm-enabled');},
  };
  const put=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  class AudioMock {play(){e.sounds.push({gesture:e.gesture});return Promise.resolve();}pause(){}}
  put('window',win);put('navigator',nav);put('document',doc);put('Notification',permission);put('localStorage',storage);put('Audio',AudioMock);put('__startupTest',mock);
  e.restore=()=>{for(const [name,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];};
  e.authAs=async value=>{assert(e.auth);await act(async()=>{e.auth(value);await tick();await tick();});};
  e.press=async button=>{await act(async()=>{e.gesture=true;try{button.props.onClick();}finally{e.gesture=false;}await tick();await tick();});};
  return e;
}
function section(tree,name){return tree.root.findByProps({'aria-label':name});}
function action(tree,name){return section(tree,name).findByType('button');}
function button(tree,name){return tree.root.findAllByType('button').find(item=>text(item).includes(name));}
async function mount(){let tree;await act(async()=>{tree=TestRenderer.create(React.createElement(React.StrictMode,null,React.createElement(App)));await tick();await tick();});return tree;}
async function finish(tree,e){if(tree)await act(async()=>tree.unmount());e.restore();}

test('PWA : autorisations dès le démarrage, avant données ou profil, puis rattachement automatique',async()=>{
  const e=environment();let tree;
  try {
    tree=await mount();assert.match(text(tree.toJSON()),/Bien démarrer/);assert.equal(e.requests.some(x=>x.path.startsWith('/api/bootstrap')),false);
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
    await e.press(action(tree,'Notifications d’équipe'));
    assert.deepEqual(e.notifications,[{gesture:true}]);assert.equal(e.prepares,1);assert.equal(e.subscriptions,0);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),'1');
    assert.match(text(tree.toJSON()),/activation après le choix de votre profil/);
    await e.authAs(null); // le catalogue peut arriver après l'autorisation
    await e.press(action(tree,'Géolocalisation'));
    assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);assert.equal(e.locations[0].options.enableHighAccuracy,false);
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
    assert.equal(tree.root.findByProps({'aria-label':'Votre magasin Fnac'}).props.value,'Fnac Près');
    assert.equal(e.requests.some(x=>JSON.stringify(x.body||{}).includes('43.61')),false);
    await e.authAs(session);await act(async()=>{await tick();await tick();});
    assert.equal(e.subscriptions,1);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');
    assert.match(text(tree.toJSON()),/Morgan/);
  } finally {await finish(tree,e);}
});

test('PWA : autorisations existantes réutilisées sans nouvelle demande et session conservée',async()=>{
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree;
  try {
    tree=await mount();await act(async()=>{await tick();await tick();});
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,false);
    assert(e.subscriptions>=1);assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);assert.match(text(tree.toJSON()),/Morgan/);
    assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');
  } finally {await finish(tree,e);}
});

test('PWA : refus et notifications coupées ne sont pas activés silencieusement, accès toujours possible',async()=>{
  const e=environment({geoPermission:'denied',notificationPermission:'granted',auth:session});let tree;
  try {
    tree=await mount();assert.match(text(tree.toJSON()),/Bien démarrer/);assert.match(text(tree.toJSON()),/Bloquée/);
    assert.equal(e.locations.length,0);assert.equal(e.notifications.length,0);assert.equal(e.subscriptions,0);
    await e.press(button(tree,'Continuer'));await act(async()=>{await tick();});
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);assert.match(text(tree.toJSON()),/Morgan/);assert.equal(e.subscriptions,0);
    assert.equal(e.values.get('fnac-pulse-fcm-enabled'),undefined);
  } finally {await finish(tree,e);}
});

test('Position tardive : une recherche manuelle commencée ne doit jamais être remplacée',async()=>{
  const e=environment({geoDeferred:true,auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));assert.equal(e.locations[0].gesture,true);
    await e.press(button(tree,'Continuer'));
    const input=()=>tree.root.findByProps({'aria-label':'Votre magasin Fnac'});
    await act(async()=>{input().props.onChange({target:{value:'Fnac Loin'}});await tick();});
    await act(async()=>{e.geoSuccess({coords:{latitude:43.61,longitude:1.42}});await tick();await tick();});
    assert.equal(input().props.value,'Fnac Loin');assert.equal(tree.root.findByProps({'aria-label':'Votre département'}).props.value,'');
    assert.doesNotMatch(text(tree.toJSON()),/Fnac Près proposé/);
  } finally {await finish(tree,e);}
});

test('Refus du dialogue système : aucun abonnement en attente et accès possible',async()=>{
  const e=environment({notificationResult:'denied',auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));
    assert.match(text(tree.toJSON()),/Notifications d’équipe/);assert.match(text(tree.toJSON()),/Bloquées/);
    assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);assert.equal(e.prepares,0);assert.equal(e.subscriptions,0);
    await e.press(button(tree,'Continuer'));assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
  } finally {await finish(tree,e);}
});

test('Premier lancement : accueil sonore au premier appui, puis autorisations sans seconde ouverture de bienvenue',async()=>{
  const e=environment({existingTouch:false,auth:null});let tree;
  try {
    tree=await mount();assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
    assert.equal(e.sounds.length,0);assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
    await e.press(button(tree,'Accéder aux services'));
    assert.deepEqual(e.sounds,[{gesture:true}]);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');assert.match(text(tree.toJSON()),/Bien démarrer/);
    await act(async()=>tree.unmount());tree=await mount();assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur/);assert.match(text(tree.toJSON()),/Bien démarrer/);assert.equal(e.sounds.length,1);
  } finally {await finish(tree,e);}
});

test('Échec réseau : activation non présentée comme acquise et réessai possible',async()=>{
  const e=environment({auth:null});e.prepareFails=true;let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));
    assert.match(text(section(tree,'Notifications d’équipe')),/Activation non confirmée/);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),'1');assert.equal(e.subscriptions,0);
    await e.press(action(tree,'Géolocalisation'));assert.match(text(tree.toJSON()),/Bien démarrer/);
    e.prepareFails=false;await e.press(action(tree,'Notifications d’équipe'));
    assert.equal(e.prepares,2);assert.equal(e.notifications.length,1); // permission déjà accordée, pas de deuxième dialogue système
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
  } finally {await finish(tree,e);}
});

test('Position tardive : le profil mémorisé ne change jamais de magasin',async()=>{
  const e=environment({geoDeferred:true,auth:null});e.values.set('fnac-pulse-device-profile-v1',JSON.stringify({storeId:'near',sellerId:1}));let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));await e.press(button(tree,'Continuer'));
    await act(async()=>{e.geoSuccess({coords:{latitude:48,longitude:2}});await tick();await tick();});
    assert.match(text(tree.toJSON()),/VOTRE PROFIL SUR CET APPAREIL/);assert.match(text(tree.toJSON()),/Fnac Près/);assert.doesNotMatch(text(tree.toJSON()),/Fnac Loin proposé/);
  } finally {await finish(tree,e);}
});

test('Permission en attente : double appui ignoré et rattachement si le profil arrive entre-temps',async()=>{
  const e=environment({notificationDeferred:true,auth:null});let tree;
  try {
    tree=await mount();const activate=action(tree,'Notifications d’équipe');
    await act(async()=>{e.gesture=true;try{activate.props.onClick();activate.props.onClick();}finally{e.gesture=false;}await tick();});
    assert.equal(e.notifications.length,1);assert.equal(e.notifications[0].gesture,true);
    await e.press(button(tree,'Continuer'));await e.authAs(session);
    assert.equal(e.subscriptions,0);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);
    await act(async()=>{e.resolveNotification('granted');await tick();await tick();await tick();});
    assert.equal(e.prepares,1);assert.equal(e.subscriptions,1);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');
  } finally {await finish(tree,e);}
});

test('Déconnexion pendant la demande : ne pas réactiver les notifications après coup',async()=>{
  const e=environment({notificationDeferred:true,auth:session});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));await e.press(button(tree,'Continuer'));
    await e.press(tree.root.findByProps({'aria-label':'Mon profil, Morgan'}));await e.press(button(tree,'Se déconnecter'));
    await act(async()=>{e.resolveNotification('granted');await tick();await tick();});
    assert.equal(e.prepares,0);assert.equal(e.subscriptions,0);assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),undefined);
  } finally {await finish(tree,e);}
});
