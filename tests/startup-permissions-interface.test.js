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
    export const listenStore=(...args)=>globalThis.__startupTest.listen(...args);
    export const prepareFcm=options=>globalThis.__startupTest.prepare(options);
    export const subscribeFcm=(api,options)=>globalThis.__startupTest.subscribe(api,options);
    export const unsubscribeFcm=()=>globalThis.__startupTest.unsubscribe();
    export const notificationsWanted=()=>localStorage.getItem('fnac-pulse-fcm-enabled')==='1';
    export const sellerLogin=(...x)=>globalThis.__startupTest.sellerLogin(...x),sellerChoosePin=()=>{},sellerMigratePin=()=>{},sellerRegister=(...x)=>globalThis.__startupTest.sellerRegister(...x),sellerLogout=()=>{},adminLogin=()=>{},adminLogout=()=>{},changeAdminPassword=()=>{},adminAccountEmail=async()=>"admin@example.test",createAdministrator=()=>{},createDirectAdministrator=()=>{},inviteAdministrator=()=>{},requestAdminPasswordReset=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{},requestAdminEmailChange=()=>{},inspectAdminEmailChange=()=>{},confirmAdminEmailChange=()=>{},resendAdminVerification=()=>{};
  `,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const App=module.exports.default;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const session={storeId:'near',sellerId:1,uid:'fictif',accessVersion:'v1'};
const data={stores:[{id:'near',name:'Fnac Près',lat:43.6,lon:1.4,active:true},{id:'far',name:'Fnac Loin',lat:48,lon:2,active:true}],sellers:[{id:1,name:'Morgan',storeId:'near',departmentId:'tech',active:true}],services:[],departmentsByStore:{near:[{id:'tech',name:'Technique',active:true}],far:[{id:'tech',name:'Technique',active:true}]},today:'2026-11-02',stats:null};

function environment({geoPermission='prompt',geoResult='success',notificationPermission='default',notificationResult='granted',wanted=false,geoDeferred=false,notificationDeferred=false,prepareDeferred=false,auth='manual',existingTouch=true}={}) {
  const names=['window','navigator','document','Notification','localStorage','Audio','__startupTest'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const values=new Map();if(existingTouch)values.set('fnac-pulse-touch-welcome-v1','done');if(wanted)values.set('fnac-pulse-fcm-enabled','1');
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const e={values,gesture:false,notifications:[],locations:[],sounds:[],audioLoads:0,audioInstances:0,audioReject:false,listenCalls:0,onSale:null,prepares:0,prepareFails:false,subscriptions:0,requests:[],sellerCalls:[],auth:null,geoSuccess:null,geoResult};
  const permission={permission:notificationPermission,requestPermission(){
    e.notifications.push({gesture:e.gesture});
    if(notificationDeferred)return new Promise(resolve=>{e.resolveNotification=value=>{this.permission=value;resolve(value);};});
    this.permission=notificationResult;return Promise.resolve(notificationResult);
  }};
  const geo={getCurrentPosition(success,error,options){
    e.locations.push({gesture:e.gesture,options});
    if(geoDeferred){e.geoSuccess=success;e.geoError=error;}
    else if(e.geoResult==='denied')error({code:1});
    else if(e.geoResult==='unavailable')error({code:2});
    else success({coords:{latitude:43.61,longitude:1.42}});
  }};
  const registration={pushManager:{getSubscription:async()=>null}};
  const nav={standalone:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',platform:'iPhone',maxTouchPoints:5,geolocation:geo,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)},permissions:{query:async({name})=>({state:name==='geolocation'?geoPermission:permission.permission,addEventListener(){},removeEventListener(){}})}};
  const media=query=>({matches:query==='(display-mode: standalone)',addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  const windowEvents=new Map();
  const win={navigator:nav,isSecureContext:true,PushManager:function(){},Notification:permission,matchMedia:media,addEventListener(name,fn){if(!windowEvents.has(name))windowEvents.set(name,new Set());windowEvents.get(name).add(fn);},removeEventListener(name,fn){windowEvents.get(name)?.delete(fn);},scrollTo(){}};
  e.dispatchWindow=(name,event)=>{for(const fn of windowEvents.get(name)||[])fn(event);};
  const doc={visibilityState:'visible',body:{style:{}},documentElement:{dataset:{},style:{}},activeElement:null,addEventListener(){},removeEventListener(){},getElementById(){return null;},querySelector(){return null;}};
  const mock={
    observe(fn){e.auth=fn;if(auth!=='manual')queueMicrotask(()=>fn(auth));return ()=>{if(e.auth===fn)e.auth=null;};},
    listen(_session,_day,_client,onChange,onSale,onError){e.listenCalls++;e.onSale=onSale;e.onChange=onChange;e.onError=onError;return ()=>{if(e.onSale===onSale){e.onSale=null;e.onChange=null;e.onError=null;}};},
    async api(path,options={}){e.requests.push({path,method:options.method||'GET',body:options.body});if(path.startsWith('/api/bootstrap'))return e.addedSeller?{...data,sellers:[...data.sellers,e.addedSeller]}:data;if(path==='/api/auth/status')return {needsPin:false,pinLength:4,pinSalt:'sel-fictif'};if(path==='/api/goals')return {goals:{}};if(path.startsWith('/api/summary-goals'))return {};return {};},
    async sellerLogin(_api,selection,pin,pinSalt){e.sellerCalls.push({mode:'login',selection,pin,pinSalt});return {...selection,uid:'fictif',accessVersion:'v1'};},
    async sellerRegister(_api,selection,name,pin){e.sellerCalls.push({mode:'register',selection,name,pin});e.addedSeller={id:2,name,storeId:selection.storeId,departmentId:selection.departmentId,active:true};return {...selection,sellerId:2,uid:'fictif-nouveau',accessVersion:'v1'};},
    async prepare({signal}={}){
      if(signal?.aborted)throw Error('annulé');e.prepares++;if(e.prepareFails)throw Error('hors ligne');
      if(prepareDeferred)return await new Promise((resolve,reject)=>{e.resolvePrepare=()=>resolve('token-fictif');signal?.addEventListener('abort',()=>reject(Error('annulé')),{once:true});});
      return 'token-fictif';
    },
    async subscribe(api,{signal}={}){if(signal?.aborted)throw Error('annulé');e.subscriptions++;storage.setItem('fnac-pulse-fcm-enabled','1');return {};},
    async unsubscribe(){storage.removeItem('fnac-pulse-fcm-enabled');},
  };
  const put=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  class AudioMock {constructor(){e.audioInstances++;this.paused=true;}load(){e.audioLoads++;}play(){e.sounds.push({gesture:e.gesture});if(e.audioReject)return Promise.reject(Error('lecture refusée'));this.paused=false;return Promise.resolve();}pause(){this.paused=true;}}
  e.doc=doc;e.permission=permission;e.mock=mock;
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
    assert.match(text(tree.toJSON()),/Bien démarrer/); // le profil est proposé avant l’accueil
    assert(tree.root.findByProps({'aria-label':'Votre profil pour les notifications'}));
    assert.equal(tree.root.findByProps({'aria-label':'Votre magasin Fnac'}).props.value,'Fnac Près');
    await e.press(button(tree,'Plus tard'));
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
    assert.equal(tree.root.findAllByProps({'aria-label':'Activation des notifications'}).length,0); // accord déjà donné, profil pas encore choisi
    assert(tree.root.findByProps({'aria-label':'Notifications autorisées, activation après le choix du profil'}));
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
  const e=environment({geoPermission:'denied',geoResult:'denied',notificationPermission:'granted',auth:session});let tree;
  try {
    tree=await mount();assert.match(text(tree.toJSON()),/Bien démarrer/);assert.doesNotMatch(text(section(tree,'Géolocalisation')),/refusé/);
    assert.equal(e.locations.length,0);assert.equal(e.notifications.length,0);assert.equal(e.subscriptions,0);
    await e.press(action(tree,'Géolocalisation'));assert.equal(e.locations[0].gesture,true);
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : accès refusé/);
    await e.press(button(tree,'Continuer'));await act(async()=>{await tick();});
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);assert.match(text(tree.toJSON()),/Morgan/);assert.equal(e.subscriptions,0);
    assert.equal(e.values.get('fnac-pulse-fcm-enabled'),undefined);
  } finally {await finish(tree,e);}
});

test('iPhone : l’état Permissions refusé ne remplace pas une vraie tentative depuis le bouton',async()=>{
  const e=environment({geoPermission:'denied',geoResult:'success',notificationPermission:'denied',auth:null});let tree;
  try {
    tree=await mount();assert.equal(e.locations.length,0);
    assert.equal(action(tree,'Géolocalisation').props.disabled,false);
    assert.match(text(action(tree,'Géolocalisation')),/Activer/);
    await e.press(action(tree,'Géolocalisation'));
    assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);
    assert.match(text(section(tree,'Géolocalisation')),/Autorisée/);
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : position obtenue/);
  } finally {await finish(tree,e);}
});

test('iPhone : refus immédiats visibles à chaque appui, aide détaillée et réessai après réglage',async()=>{
  const e=environment({geoPermission:'denied',geoResult:'denied',notificationPermission:'denied',auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));
    let geo=section(tree,'Géolocalisation');
    assert.match(text(geo),/Vérification 1 : accès refusé/);
    assert.match(text(geo),/Comment autoriser sur iPhone/);assert.match(text(geo),/Sites Safari/);
    assert.match(text(geo),/Réglages du site web/);assert.match(text(geo),/application installée peuvent être distinctes/);
    assert.equal(action(tree,'Géolocalisation').props.disabled,false);
    await e.press(action(tree,'Géolocalisation'));geo=section(tree,'Géolocalisation');
    assert.match(text(geo),/Vérification 2 : accès refusé/);assert.equal(e.locations.length,2);
    assert(e.locations.every(item=>item.gesture));
    const status=geo.findByProps({className:'startup-location-result'});
    assert.equal(status.props.role,'status');assert.equal(status.props['aria-live'],'polite');
    e.geoResult='success';await e.press(action(tree,'Géolocalisation'));
    assert.equal(e.locations.length,3);assert.match(text(section(tree,'Géolocalisation')),/Vérification 3 : position obtenue/);
  } finally {await finish(tree,e);}
});

test('La préparation réseau des notifications ne bloque pas la géolocalisation',async()=>{
  const e=environment({notificationPermission:'granted',prepareDeferred:true,auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));
    assert.equal(e.prepares,1);assert.equal(typeof e.resolvePrepare,'function');
    assert.equal(action(tree,'Géolocalisation').props.disabled,false);
    await e.press(action(tree,'Géolocalisation'));
    assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : position obtenue/);
    await act(async()=>{e.resolvePrepare();await tick();await tick();});
    assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),'1');
  } finally {await finish(tree,e);}
});

test('Une invite de notification qui ne répond pas ne rend pas le bouton de position inerte',async()=>{
  const e=environment({notificationDeferred:true,geoResult:'denied',auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));
    assert.equal(e.notifications.length,1);assert.equal(action(tree,'Géolocalisation').props.disabled,false);
    await e.press(action(tree,'Géolocalisation'));
    assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : accès refusé/);
    await act(async()=>{e.resolveNotification('denied');await tick();await tick();});
  } finally {await finish(tree,e);}
});

test('Deux appuis pendant une recherche ne lancent qu’une demande de position',async()=>{
  const e=environment({geoDeferred:true,notificationPermission:'denied',auth:null});let tree;
  try {
    tree=await mount();const activate=action(tree,'Géolocalisation');
    await act(async()=>{e.gesture=true;try{activate.props.onClick();activate.props.onClick();}finally{e.gesture=false;}await tick();});
    assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);
    await act(async()=>{e.geoSuccess({coords:{latitude:43.61,longitude:1.42}});await tick();});
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : position obtenue/);
  } finally {await finish(tree,e);}
});

test('Expiration de la position : réessai possible et résultat tardif abandonné',async()=>{
  const e=environment({geoDeferred:true,notificationPermission:'denied',auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));
    const lateSuccess=e.geoSuccess;assert.equal(action(tree,'Géolocalisation').props.disabled,true);
    await act(async()=>{e.geoError({code:3});await tick();});
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : la recherche a expiré/);
    assert.equal(action(tree,'Géolocalisation').props.disabled,false);
    await act(async()=>{lateSuccess({coords:{latitude:43.61,longitude:1.42}});await tick();});
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 1 : la recherche a expiré/);
    await e.press(action(tree,'Géolocalisation'));
    await act(async()=>{e.geoSuccess({coords:{latitude:43.61,longitude:1.42}});await tick();});
    assert.match(text(section(tree,'Géolocalisation')),/Vérification 2 : position obtenue/);
  } finally {await finish(tree,e);}
});

test('Position tardive : une recherche manuelle commencée ne doit jamais être remplacée',async()=>{
  const e=environment({geoDeferred:true,auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));assert.equal(e.locations[0].gesture,true);
    await e.press(button(tree,'Plus tard'));
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
    await e.press(button(tree,'Plus tard'));assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
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
    assert.match(text(tree.toJSON()),/Bien démarrer/); // le profil reste proposé
    await e.press(button(tree,'Plus tard'));
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
  } finally {await finish(tree,e);}
});

test('Préparation échouée avant profil : erreur actionnable, puis nouvelle tentative à la connexion',async()=>{
  const e=environment({auth:null});e.prepareFails=true;let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));await e.press(button(tree,'Plus tard'));
    const card=section(tree,'Activation des notifications');
    assert.match(text(card),/Activation à finaliser/);assert.match(text(card),/préparation a échoué/);assert.match(text(card),/En savoir plus/);
    assert(tree.root.findByProps({'aria-label':'Activation des notifications à finaliser'}));
    e.prepareFails=false;await e.authAs(session);await act(async()=>{await tick();await tick();});
    assert.equal(e.subscriptions,1);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);
  } finally {await finish(tree,e);}
});

test('Préparation en attente : pas de carte redondante et choix du profil accessible',async()=>{
  const e=environment({notificationPermission:'granted',prepareDeferred:true,auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));await e.press(button(tree,'Plus tard'));
    assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),'1');assert.equal(tree.root.findAllByProps({'aria-label':'Activation des notifications'}).length,0);
    await e.press(tree.root.findByProps({'aria-label':'Notifications autorisées, activation après le choix du profil'}));
    assert.match(text(tree.toJSON()),/Autorisation accordée/);assert.match(text(tree.toJSON()),/Profil à choisir pour terminer l’activation/);
    assert.equal(button(tree,'Choisir mon profil').props.disabled,false);
    await act(async()=>{e.resolvePrepare();await tick();await tick();});
  } finally {await finish(tree,e);}
});

test('Position tardive : le profil mémorisé ne change jamais de magasin',async()=>{
  const e=environment({geoDeferred:true,auth:null});e.values.set('fnac-pulse-device-profile-v1',JSON.stringify({storeId:'near',sellerId:1}));let tree;
  try {
    tree=await mount();await e.press(action(tree,'Géolocalisation'));await e.press(button(tree,'Plus tard'));
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
    await e.press(button(tree,'Plus tard'));await e.authAs(session);
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

test('Son des alertes cloud : état courant, premier plan, refus et aucun réabonnement du flux',async()=>{
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree;
  const sale=(name='Camille')=>({serviceName:'DMax',sellerName:name});
  const announce=async item=>act(async()=>{assert(e.onSale);e.onSale(item);await tick();await tick();});
  try {
    tree=await mount();await act(async()=>{await tick();await tick();});
    assert(tree.root.findByProps({'aria-label':'Notifications activées'}));assert.equal(e.sounds.length,0);assert(e.onSale);
    const listens=e.listenCalls,subscriptions=e.subscriptions;
    await announce(sale());assert.equal(e.sounds.length,1);assert.match(text(tree.toJSON()),/1 DMax fait par Camille/);
    const rapidToggle=tree.root.findByProps({'aria-label':'Désactiver le son Fnac'}).props.onClick;
    await act(async()=>{rapidToggle();rapidToggle();await tick();});
    assert.equal(e.values.get('fnac-pulse-sale-sound-v1'),'on');assert.match(text(tree.toJSON()),/Son Fnac activé sur cet appareil\./);assert.equal(e.sounds.length,1);
    await e.press(tree.root.findByProps({'aria-label':'Désactiver le son Fnac'}));
    assert.equal(e.values.get('fnac-pulse-sale-sound-v1'),'off');assert.match(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./);assert.equal(e.sounds.length,1);
    await announce(sale('Alex'));assert.equal(e.sounds.length,1);assert.match(text(tree.toJSON()),/1 DMax fait par Alex/);
    assert.match(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./); // deux messages indépendants
    await e.press(tree.root.findByProps({'aria-label':'Activer le son Fnac'}));
    assert.equal(e.values.get('fnac-pulse-sale-sound-v1'),'on');assert.match(text(tree.toJSON()),/Son Fnac activé sur cet appareil\./);assert.equal(e.sounds.length,1);
    await announce(sale('Sam'));assert.equal(e.sounds.length,2);assert.equal(e.audioInstances,1);assert.equal(e.listenCalls,listens);assert.equal(e.subscriptions,subscriptions);
    e.doc.visibilityState='hidden';await announce(sale('Lou'));assert.equal(e.sounds.length,2);
    e.doc.visibilityState='visible';e.permission.permission='denied';await announce(sale('Noa'));assert.equal(e.sounds.length,2);
    e.permission.permission='granted';e.values.delete('fnac-pulse-fcm-enabled');await announce(sale('Léa'));assert.equal(e.sounds.length,2);
    e.values.set('fnac-pulse-fcm-enabled','1');e.audioReject=true;await announce(sale('Sacha'));
    assert.equal(e.sounds.length,3);assert.match(text(tree.toJSON()),/1 DMax fait par Sacha/); // l'alerte reste visible même si play() est rejeté
    e.audioReject=false;
    await e.press(tree.root.findByProps({'aria-label':'Notifications activées'}));await e.press(button(tree,'Désactiver sur cet appareil'));
    await announce(sale('Robin'));assert.equal(e.sounds.length,3);assert.match(text(tree.toJSON()),/1 DMax fait par Robin/);
    assert.equal(e.listenCalls,listens); // le flux de ventes ne redémarre pas lors d'un changement de préférence
  } finally {await finish(tree,e);}
});

test('Son : une modification depuis une autre fenêtre ne laisse pas de message périmé',async()=>{
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree;
  try {
    tree=await mount();await e.press(tree.root.findByProps({'aria-label':'Désactiver le son Fnac'}));
    assert.match(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./);
    e.values.set('fnac-pulse-sale-sound-v1','on');
    await act(async()=>{e.dispatchWindow('storage',{key:'fnac-pulse-sale-sound-v1',newValue:'on'});await tick();});
    assert(tree.root.findByProps({'aria-label':'Désactiver le son Fnac'}));
    assert.doesNotMatch(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./);assert.equal(e.sounds.length,0);
  } finally {await finish(tree,e);}
});

test('Cartes tactiles : doubles gestes, retrait distinct, annulation préservée et garde hors ligne',async()=>{
  const previousServices=data.services,service={id:1,name:'DMax',active:true};data.services=[service];
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree,finishSale;
  const api=e.mock.api;
  e.mock.api=(path,options={})=>{
    if(path==='/api/sales'&&options.method==='POST'){
      e.requests.push({path,method:'POST',body:options.body});
      return new Promise(resolve=>{finishSale=resolve;});
    }
    return api(path,options);
  };
  const period={total:1,byService:[{id:1,name:'DMax',count:1}],bySeller:[],mineByService:[{serviceId:1,count:1}],start:data.today,end:data.today};
  const live={...data,stats:{day:period,week:period,month:period,mine:[{serviceId:1,count:1}],mineTotal:1,leaderboard:[],activity:[]}};
  try {
    tree=await mount();await act(async()=>{assert(e.onChange);e.onChange(live,true);await tick();});
    const add=()=>tree.root.findByProps({'aria-label':'Ajouter une vente DMax'}),remove=()=>tree.root.findByProps({'aria-label':'Retirer une vente DMax'});
    const addClick=add().props.onClick,removeClick=remove().props.onClick;
    await act(async()=>{addClick();addClick();removeClick();await tick();});
    assert.equal(e.requests.filter(x=>x.path==='/api/sales'&&x.method==='POST').length,1);
    assert.equal(e.requests.filter(x=>x.path==='/api/sales/remove').length,0);
    assert(add().props.disabled);assert(remove().props.disabled);
    await act(async()=>{finishSale({id:'vente-fictive'});await tick();await tick();});
    assert(!add().props.disabled);assert(!remove().props.disabled);assert.match(text(tree.toJSON()),/Vente enregistrée\./);assert(button(tree,'Annuler'));
    await e.press(tree.root.findByProps({'aria-label':'Désactiver le son Fnac'}));
    assert.match(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./);assert(button(tree,'Annuler'));
    await e.press(button(tree,'Annuler'));
    assert(e.requests.some(x=>x.path==='/api/sales/vente-fictive'&&x.method==='DELETE'));assert.match(text(tree.toJSON()),/Vente annulée\./);
    assert.match(text(tree.toJSON()),/Son Fnac désactivé sur cet appareil\./);
    await e.press(remove());assert(e.requests.some(x=>x.path==='/api/sales/remove'&&x.method==='POST'));
    await act(async()=>{e.onError({code:'unavailable'});await tick();});
    const before=e.requests.filter(x=>x.path==='/api/sales'&&x.method==='POST').length;
    await e.press(add());assert.equal(e.requests.filter(x=>x.path==='/api/sales'&&x.method==='POST').length,before);
    assert.match(text(tree.toJSON()),/Connexion interrompue : la vente n’a pas été enregistrée/);
  } finally {data.services=previousServices;await finish(tree,e);}
});

test('Cartes tactiles : sans profil, l’appui invite à se connecter sans écrire de vente',async()=>{
  const previousServices=data.services;data.services=[{id:1,name:'DMax',active:true}];
  const e=environment({auth:null});let tree;
  try {
    tree=await mount();await e.press(button(tree,'Plus tard'));
    await e.press(tree.root.findByProps({'aria-label':'Ajouter une vente DMax'}));
    assert.match(text(tree.toJSON()),/Choisissez d’abord votre magasin et votre profil/);
    assert(!e.requests.some(x=>x.path==='/api/sales'&&x.method==='POST'));
  } finally {data.services=previousServices;await finish(tree,e);}
});

test('Bien démarrer : connexion du profil dans la modale puis association des notifications',async()=>{
  const e=environment({auth:null});let tree;
  try {
    tree=await mount();await e.press(action(tree,'Notifications d’équipe'));await e.press(action(tree,'Géolocalisation'));
    const profile=()=>section(tree,'Votre profil pour les notifications');
    const change=async(label,value)=>act(async()=>{profile().findByProps({'aria-label':label}).props.onChange({target:{value}});await tick();});
    assert.equal(profile().findByProps({'aria-label':'Votre magasin Fnac'}).props.value,'Fnac Près');
    await change('Votre département','tech');await change('Votre prénom','Morgan');
    assert.match(text(profile()),/Profil existant : Morgan/);await change('Code PIN personnel','4829');
    await act(async()=>{await profile().findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();await tick();});
    assert.deepEqual(e.sellerCalls,[{mode:'login',selection:{storeId:'near',departmentId:'tech',sellerId:1},pin:'4829',pinSalt:'sel-fictif'}]);
    assert.equal(e.subscriptions,1);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');
    assert.equal(e.values.get(STARTUP_PUSH_PENDING_KEY),undefined);assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":1/);
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);assert.match(text(tree.toJSON()),/Morgan/);
  } finally {await finish(tree,e);}
});

test('Bien démarrer : création d’un profil et PIN sans quitter la modale ; permissions facultatives',async()=>{
  const e=environment({auth:null});let tree;
  try {
    tree=await mount();const profile=()=>section(tree,'Votre profil pour les notifications');
    const change=async(label,value)=>act(async()=>{profile().findByProps({'aria-label':label}).props.onChange({target:{value}});await tick();});
    await change('Votre magasin Fnac','Fnac Près');
    await act(async()=>{profile().findByProps({role:'option'}).props.onClick();await tick();});
    await change('Votre département','tech');await change('Votre prénom','Alice');
    await change('Votre nouveau code PIN','7264');await change('Confirmer votre code PIN','7264');
    await act(async()=>{await profile().findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.deepEqual(e.sellerCalls,[{mode:'register',selection:{storeId:'near',departmentId:'tech'},name:'Alice',pin:'7264'}]);
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);assert.equal(e.subscriptions,0);
    assert.match(text(profile()),/Votre profil est déjà connecté/);
    await e.press(button(tree,'Continuer'));assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
    assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":2/);
  } finally {await finish(tree,e);}
});
