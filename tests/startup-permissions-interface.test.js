import {summarize,parisToday} from '../src/cloud-stats.js';
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
  b.onLoad({filter:/^api$/,namespace:'mock'},()=>({contents:`export const api=(...x)=>globalThis.__startupTest.api(...x);let counter=0;export const uid=()=>"test-id-"+(++counter);export const dateLabel=()=>"date";export const timeLabel=()=>"heure";export const kmBetween=(a,b,c,d)=>Math.abs(a-c)+Math.abs(b-d);`,loader:'js'}));
  b.onLoad({filter:/^cloud$/,namespace:'mock'},()=>({contents:`
    export const claimAdminAccess=(...x)=>globalThis.__directLogin?.claim?.(...x),registerAdminForApproval=(...x)=>globalThis.__directLogin?.manualRegister?.(...x),deleteTestFirebaseAccount=()=>{}; export const CLOUD=true,ADMIN_SESSION='admin';
    export const observeVendor=fn=>globalThis.__startupTest.observe(fn);
    export const listenStore=(...args)=>globalThis.__startupTest.listen(...args);
    export const prepareFcm=options=>globalThis.__startupTest.prepare(options);
    export const subscribeFcm=(api,options)=>globalThis.__startupTest.subscribe(api,options);
    export const unsubscribeFcm=()=>globalThis.__startupTest.unsubscribe();
    export const notificationsWanted=()=>localStorage.getItem('fnac-pulse-fcm-enabled')==='1';
    export const sellerLogin=(...x)=>globalThis.__startupTest.sellerLogin(...x),sellerChoosePin=()=>{},sellerMigratePin=(...x)=>globalThis.__startupTest.sellerMigratePin(...x),sellerRegister=(...x)=>globalThis.__startupTest.sellerRegister(...x),sellerLogout=(...x)=>globalThis.__startupTest.sellerLogout(...x),adminLogin=(...x)=>globalThis.__startupTest.adminLogin(...x),adminLogout=(...x)=>globalThis.__startupTest.adminLogout(...x),changeAdminPassword=()=>{},adminAccountEmail=async()=>"admin@example.test",createAdministrator=()=>{},createDirectAdministrator=()=>{},createAdminEnrollmentCode=()=>{},cancelAdminEnrollmentCode=()=>{},registerAdminWithCode=()=>{},changeFirstCodeAdminPassword=()=>{},inviteAdministrator=()=>{},requestAdminPasswordReset=()=>{},inspectAdminPasswordReset=()=>{},confirmAdminPasswordReset=()=>{},inspectAdminVerification=()=>{},confirmAdminVerification=()=>{},requestAdminEmailChange=()=>{},inspectAdminEmailChange=()=>{},confirmAdminEmailChange=()=>{},resendAdminVerification=()=>{};
  `,loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const App=module.exports.default;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node?'':Array.isArray(node)?node.map(text).join(''):text(node.children);
const session={storeId:'near',sellerId:1,uid:'fictif',accessVersion:'v1'};
const data={stores:[{id:'near',name:'Fnac Près',lat:43.6,lon:1.4,active:true},{id:'far',name:'Fnac Loin',lat:48,lon:2,active:true}],sellers:[{id:1,name:'Morgan',storeId:'near',departmentId:'tech',active:true}],services:[],departmentsByStore:{near:[{id:'tech',name:'Technique',active:true}],far:[{id:'tech',name:'Technique',active:true}]},today:'2026-11-02',stats:null};

function environment({geoPermission='prompt',geoResult='success',notificationPermission='default',notificationResult='granted',wanted=false,geoDeferred=false,notificationDeferred=false,prepareDeferred=false,auth='manual',existingTouch=true,standalone=true,directInvitation=false,adminValues:initialAdminValues={}}={}) {
  const names=['window','navigator','document','Notification','localStorage','sessionStorage','Audio','__startupTest'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const values=new Map();if(existingTouch)values.set('fnac-pulse-touch-welcome-v1','done');if(wanted)values.set('fnac-pulse-fcm-enabled','1');
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const adminValues=new Map(Object.entries(initialAdminValues));
  const adminStorage={getItem:key=>adminValues.get(key)??null,setItem:(key,value)=>adminValues.set(key,value),removeItem:key=>adminValues.delete(key)};
  const e={values,adminValues,failBootstrap:false,adminFail:false,sellerLoginFails:false,pinStatus:null,logoutCount:0,adminLogins:[],gesture:false,notifications:[],locations:[],sounds:[],audioLoads:0,audioInstances:0,audioReject:false,audioHang:false,audioPauses:0,listenCalls:0,onSale:null,prepares:0,prepareFails:false,subscriptions:0,requests:[],sellerCalls:[],auth:null,geoSuccess:null,geoResult};
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
  const nav={standalone,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',platform:'iPhone',maxTouchPoints:5,geolocation:geo,serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)},permissions:{query:async({name})=>({state:name==='geolocation'?geoPermission:permission.permission,addEventListener(){},removeEventListener(){}})}};
  const mediaEvents=new Map();
  const media=query=>({get matches(){return standalone&&query==='(display-mode: standalone)';},addEventListener(name,fn){if(name==='change'){if(!mediaEvents.has(query))mediaEvents.set(query,new Set());mediaEvents.get(query).add(fn);}},removeEventListener(name,fn){if(name==='change')mediaEvents.get(query)?.delete(fn);},addListener(){},removeListener(){}});
  e.displayAs=value=>{standalone=value;nav.standalone=value;for(const listeners of mediaEvents.values())for(const fn of listeners)fn({matches:value});};
  const windowEvents=new Map();
  const win={navigator:nav,__fnacOpenAdminInvitation:directInvitation,isSecureContext:true,PushManager:function(){},Notification:permission,matchMedia:media,addEventListener(name,fn){if(!windowEvents.has(name))windowEvents.set(name,new Set());windowEvents.get(name).add(fn);},removeEventListener(name,fn){windowEvents.get(name)?.delete(fn);},scrollTo(){}};
  e.dispatchWindow=(name,event)=>{for(const fn of windowEvents.get(name)||[])fn(event);};
  const documentEvents=new Map();
  const doc={visibilityState:'visible',body:{style:{}},documentElement:{dataset:{},style:{}},activeElement:null,addEventListener(name,fn){if(!documentEvents.has(name))documentEvents.set(name,new Set());documentEvents.get(name).add(fn);},removeEventListener(name,fn){documentEvents.get(name)?.delete(fn);},getElementById(){return null;},querySelector(){return null;}};
  e.dispatchDocument=(name,event)=>{for(const fn of documentEvents.get(name)||[])fn(event);};
  const mock={
    observe(fn){e.auth=fn;if(auth!=='manual')queueMicrotask(()=>fn(auth));return ()=>{if(e.auth===fn)e.auth=null;};},
    listen(_session,_day,_client,onChange,onSale,onError){e.listenCalls++;e.onSale=onSale;e.onChange=onChange;e.onError=onError;return ()=>{if(e.onSale===onSale){e.onSale=null;e.onChange=null;e.onError=null;}};},
    async api(path,options={}){e.requests.push({path,method:options.method||'GET',body:options.body});if(path.startsWith('/api/bootstrap')){if(e.failBootstrap)throw Error('Connexion indisponible');return e.addedSeller?{...data,sellers:[...data.sellers,e.addedSeller]}:data;}if(path==='/api/auth/status')return e.pinStatus||{needsPin:false,pinLength:4,pinSalt:'sel-fictif'};if(path==='/api/auth/admin-account-status')return {passwordChangeRequired:false};if(path==='/api/admin/all')return {sellers:[],services:[],serviceOrders:{},serviceRemovalsByStore:{},departmentsByStore:{}};if(path==='/api/goals')return {goals:{}};if(path.startsWith('/api/summary-goals'))return {};return {};},
    async sellerLogout(){e.logoutCount++;},async adminLogin(email,password){e.adminLogins.push({email,password});if(e.adminFail)throw Error('Identifiants incorrects');return 'admin';},async adminLogout(){},
    async sellerLogin(_api,selection,pin,pinSalt){e.sellerCalls.push({mode:'login',selection,pin,pinSalt});if(e.sellerLoginFails)throw Object.assign(Error('Code PIN incorrect.'),{status:401});return {...selection,uid:'fictif',accessVersion:'v1'};},
    async sellerMigratePin(_api,selection,oldPin,newPin,pinSalt){e.sellerCalls.push({mode:'migrate',selection,oldPin,newPin,pinSalt});return {...selection,uid:'fictif',accessVersion:'v1'};},
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
  class AudioMock {constructor(){e.audioInstances++;this.paused=true;}load(){e.audioLoads++;}play(){e.sounds.push({gesture:e.gesture});if(e.audioHang)return new Promise(()=>{});if(e.audioReject)return Promise.reject(Error('lecture refusée'));this.paused=false;return Promise.resolve();}pause(){e.audioPauses++;this.paused=true;}}
  e.doc=doc;e.permission=permission;e.mock=mock;
  put('window',win);put('navigator',nav);put('document',doc);put('Notification',permission);put('localStorage',storage);put('sessionStorage',adminStorage);put('Audio',AudioMock);put('__startupTest',mock);
  e.restore=()=>{for(const [name,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];};
  e.authAs=async value=>{assert(e.auth);await act(async()=>{e.auth(value);await tick();await tick();});};
  e.press=async button=>{await act(async()=>{e.gesture=true;try{button.props.onClick();}finally{e.gesture=false;}await tick();await tick();});};
  return e;
}
function section(tree,name){return tree.root.findByProps({'aria-label':name});}
function action(tree,name){return section(tree,name).findByType('button');}
function button(tree,name){return tree.root.findAllByType('button').find(item=>text(item).includes(name));}
async function mount({stayAtLaunch=false}={}){
  let tree;await act(async()=>{tree=TestRenderer.create(React.createElement(React.StrictMode,null,React.createElement(App)));await tick();await tick();});
  // Seuls les parcours sans session franchissent l'écran de bienvenue ; la
  // vérification de session n'a plus de sortie anticipée et attend Auth.
  if(!stayAtLaunch){
    const start=tree.root.findAllByProps({className:'startup-start'})[0];
    if(start)await act(async()=>{start.props.onClick();await tick();await tick();});
  }
  return tree;
}
async function finish(tree,e){if(tree)await act(async()=>tree.unmount());e.restore();}
async function documentGesture(e,{trusted=true,target={closest:()=>null},type='pointerdown'}={}){
  await act(async()=>{e.gesture=true;try{e.dispatchDocument(type,{isTrusted:trusted,target});}finally{e.gesture=false;}await tick();await tick();});
}

test('PWA : autorisations dès le démarrage, avant le profil, puis rattachement automatique',async()=>{
  const e=environment();let tree;
  try {
    tree=await mount();assert.match(text(tree.toJSON()),/Vérification de votre session/);
    await e.authAs(null);await e.press(button(tree,'Plus tard · Accéder aux services'));
    assert.match(text(tree.toJSON()),/Bien démarrer/);assert.equal(e.sellerCalls.length,0,'les autorisations précèdent le choix du profil');
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
    tree=await mount();assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    assert.equal(e.locations.length,0);assert.equal(e.notifications.length,0);assert.equal(e.subscriptions,0);
    await e.press(section(tree,'Autorisations de cet appareil').findAllByType('button').find(b=>text(b).includes('Configurer')));
    assert.match(text(tree.toJSON()),/Bien démarrer/);assert.doesNotMatch(text(section(tree,'Géolocalisation')),/refusé/);
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

test('Premier lancement : son au geste puis autorisations ; profil reproposé sans rejouer le son',async()=>{
  const e=environment({existingTouch:false,auth:null});let tree;
  try {
    tree=await mount({stayAtLaunch:true});assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer/);
    assert.equal(e.sounds.length,0);assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
    await e.press(button(tree,'Accéder aux services'));
    assert.deepEqual(e.sounds,[{gesture:true}]);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');assert.match(text(tree.toJSON()),/Bien démarrer/);
    await act(async()=>tree.unmount());tree=await mount({stayAtLaunch:true});assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.equal(e.sounds.length,1);
    await e.press(button(tree,'Accéder aux services'));assert.match(text(tree.toJSON()),/Bien démarrer/);assert.equal(e.sounds.length,1);
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
    tree=await mount();await e.press(button(tree,'Configurer'));await e.press(action(tree,'Notifications d’équipe'));await e.press(button(tree,'Continuer'));
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
    const day=parisToday(),catalog={sellers:data.sellers,services:data.services,stores:data.stores,departmentsByStore:data.departmentsByStore,serviceOrders:{}};
    const existing={id:'vente-existante',storeId:session.storeId,sellerId:1,departmentId:'tech',serviceId:1,createdAt:new Date().toISOString(),businessDate:day,deletedAt:null,source:'sale'};
    tree=await mount();await act(async()=>{assert(e.onChange);e.onChange({...live,today:day},true,{catalog,sales:[existing],generation:''});await tick();});
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
    assert.match(text(tree.toJSON()),/Connexion interrompue : aucune nouvelle vente n’a été envoyée/);
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

test('Bien démarrer : création d’un profil et accès direct ; permissions facultatives',async()=>{
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
    assert.doesNotMatch(text(tree.toJSON()),/Bien démarrer|Bienvenue sur/);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    assert(tree.root.findByProps({'aria-label':'Autorisations de cet appareil'}));
    assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":2/);
  } finally {await finish(tree,e);}
});

async function selectMorganOnLaunch(tree,e=null) {
  const profile=()=>section(tree,'Sélection du profil vendeur');
  const change=async(label,value)=>act(async()=>{profile().findByProps({'aria-label':label}).props.onChange({target:{value}});await tick();});
  await change('Votre magasin Fnac','Fnac Près');
  await act(async()=>{profile().findAllByProps({role:'option'}).find(item=>text(item).includes('Fnac Près')).props.onClick();await tick();});
  await change('Votre département','tech');
  const name=profile().findByProps({'aria-label':'Votre prénom'});
  await act(async()=>{name.props.onFocus();await tick();});
  assert(profile().findAllByProps({role:'option'}).some(item=>text(item).includes('Morgan')),'suggestion de prénom dès le lancement');
  await act(async()=>{profile().findAllByProps({role:'option'}).find(item=>text(item).includes('Morgan')).props.onClick();await tick();await tick();});
  await change('Code PIN personnel','4829');
  await act(async()=>{
    if(e)e.gesture=true;
    let pending;try {pending=profile().findByType('form').props.onSubmit({preventDefault(){},isTrusted:!!e});} finally {if(e)e.gesture=false;}
    await pending;await tick();await tick();
  });
}

test('Navigateur : profil, suggestions et PIN puis accueil immédiat',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.doesNotMatch(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.match(text(button(tree,'Plus tard')),/Accéder aux services/);
    assert.equal(tree.root.findByProps({'aria-label':'Ouvrir l’administration'}).props.disabled,false);
    assert(section(tree,'Sélection du profil vendeur').findByProps({'aria-label':'Votre magasin Fnac'}));
    await selectMorganOnLaunch(tree);
    assert.deepEqual(e.sellerCalls,[{mode:'login',selection:{storeId:'near',departmentId:'tech',sellerId:1},pin:'4829',pinSalt:'sel-fictif'}]);
    assert.equal(tree.root.findAllByProps({'aria-label':'Sélection du profil vendeur'}).length,0);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Bonjour, Morgan/);
    assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":1/);
    assert.equal(e.sounds.length,0);
  } finally {await finish(tree,e);}
});

test('PIN incorrect : rester sur le choix du profil sans ouvrir une fausse session',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    e.sellerLoginFails=true;tree=await mount({stayAtLaunch:true});await selectMorganOnLaunch(tree);
    assert.match(text(tree.toJSON()),/Code PIN incorrect/);assert.match(text(tree.toJSON()),/Bienvenue sur/);
    assert.doesNotMatch(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.equal(e.logoutCount,0);assert.equal(e.values.get('fnac-pulse-session-v1'),undefined);
    assert(section(tree,'Sélection du profil vendeur').findByProps({'aria-label':'Code PIN personnel'}));
  } finally {await finish(tree,e);}
});

test('Lancement : création autonome du vendeur et accueil immédiat',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    tree=await mount({stayAtLaunch:true});const profile=()=>section(tree,'Sélection du profil vendeur');
    const change=async(label,value)=>act(async()=>{profile().findByProps({'aria-label':label}).props.onChange({target:{value}});await tick();});
    await change('Votre magasin Fnac','Fnac Près');
    await act(async()=>{profile().findAllByProps({role:'option'}).find(x=>text(x).includes('Fnac Près')).props.onClick();await tick();});
    await change('Votre département','tech');await change('Votre prénom','Alice');
    await change('Votre nouveau code PIN','7264');await change('Confirmer votre code PIN','7264');
    await act(async()=>{await profile().findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.deepEqual(e.sellerCalls,[{mode:'register',selection:{storeId:'near',departmentId:'tech'},name:'Alice',pin:'7264'}]);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
    assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":2/);
    assert.equal(e.notifications.length,0);assert.equal(e.sounds.length,0);
  } finally {await finish(tree,e);}
});

test('Administration depuis le lancement : connexion indépendante, retour et saisie vendeur conservée',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    tree=await mount({stayAtLaunch:true});const profile=()=>section(tree,'Sélection du profil vendeur');
    const store=profile().findByProps({'aria-label':'Votre magasin Fnac'});
    await act(async()=>{store.props.onChange({target:{value:'Fnac Près'}});await tick();});
    await act(async()=>{profile().findAllByProps({role:'option'}).find(x=>text(x).includes('Fnac Près')).props.onClick();await tick();});
    await e.press(tree.root.findByProps({'aria-label':'Ouvrir l’administration'}));
    let dialog=()=>tree.root.findByProps({role:'dialog','aria-label':'Espace administrateur'});
    assert(dialog());assert.doesNotMatch(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    await act(async()=>{dialog().findByProps({id:'admin-email'}).props.onChange({target:{value:'admin@example.test'}});dialog().findByProps({id:'admin-password'}).props.onChange({target:{value:'Personnel-fictif!'}});await tick();});
    await act(async()=>{await dialog().findByProps({className:'admin-login-form'}).props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.deepEqual(e.adminLogins,[{email:'admin@example.test',password:'Personnel-fictif!'}]);
    assert.equal(e.adminValues.get('pulse-admin-token'),'admin');
    assert(tree.root.findByProps({role:'dialog','aria-label':'Administration'}));
    await e.press(tree.root.findByProps({role:'dialog','aria-label':'Administration'}).findByProps({'aria-label':'Fermer'}));
    assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.doesNotMatch(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.equal(profile().findByProps({'aria-label':'Votre magasin Fnac'}).props.value,'Fnac Près');
    assert.equal(e.logoutCount,0);assert.equal(e.adminValues.get('pulse-admin-token'),'admin');
    await e.press(tree.root.findByProps({'aria-label':'Ouvrir l’administration'}));
    assert(tree.root.findByProps({role:'dialog','aria-label':'Administration'}));
  } finally {await finish(tree,e);}
});

test('Session vendeur et magasin admin mémorisés : accueil immédiat sans déconnexion ni effacement',async()=>{
  const e=environment({auth:session,adminValues:{'pulse-admin-token':'admin','pulse-admin-managed-store-v1':'far'}});let tree;
  try {
    tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.match(text(tree.toJSON()),/Morgan/);assert.match(text(tree.toJSON()),/Fnac Près/);
    assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);assert.equal(e.logoutCount,0);
    await e.press(tree.root.findByProps({'aria-label':'Mon profil, Morgan'}));
    const personal=tree.root.findByProps({role:'dialog','aria-label':'Mon profil'});
    assert.match(text(personal),/Votre session reste ouverte/);
    await e.press(personal.findByProps({'aria-label':'Fermer'}));
    assert.equal(e.logoutCount,0);assert.match(text(tree.toJSON()),/Morgan/);
    await e.press(tree.root.findByProps({'aria-label':'Administration'}));
    const admin=tree.root.findByProps({role:'dialog','aria-label':'Administration'});
    assert.match(text(admin),/Magasin sélectionné : Fnac Loin/);
    assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');assert.equal(e.logoutCount,0);
    await e.press(admin.findByProps({'aria-label':'Fermer'}));
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Morgan/);
  } finally {await finish(tree,e);}
});

test('Authentification lente : aucun écran de bienvenue avant la restauration, navigateur comme PWA',async()=>{
  for(const standalone of [false,true]) {
    const e=environment({standalone,auth:'manual',adminValues:{'pulse-admin-managed-store-v1':'far'}});let tree;
    try {
      const cached=JSON.stringify(session);e.values.set('fnac-pulse-session-v1',cached);
      tree=await mount({stayAtLaunch:true});
      assert.match(text(tree.toJSON()),/Vérification de votre session/);
      assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services|VOTRE TABLEAU DE BORD/);
      assert.equal(e.sounds.length,0);assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
      await e.authAs(session);
      assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Bonjour, Morgan/);
      assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
      assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0,'aucune étape automatique ne masque l’accueil');
      assert.equal(e.values.get('fnac-pulse-session-v1'),cached);assert.equal(e.logoutCount,0);
      assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');
    } finally {await finish(tree,e);}
  }
});

test('Session absente après vérification : profil et choix Plus tard restent proposés',async()=>{
  const e=environment({auth:'manual',standalone:false});let tree;
  try {
    e.values.set('fnac-pulse-device-profile-v1',JSON.stringify({storeId:'near',sellerId:1}));
    tree=await mount({stayAtLaunch:true});assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur/);
    await e.authAs(null);
    assert.match(text(tree.toJSON()),/Bienvenue sur/);assert.match(text(tree.toJSON()),/Morgan/);
    assert(section(tree,'Sélection du profil vendeur').findByProps({'aria-label':'Code PIN personnel'}));
    assert(button(tree,'Plus tard'));assert.equal(e.logoutCount,0);
  } finally {await finish(tree,e);}
});

test('Session devenue invalide : profil à reconnecter, sans conserver un accès fantôme',async()=>{
  const e=environment({auth:session});let tree;
  try {
    e.values.set('fnac-pulse-session-v1',JSON.stringify(session));tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert(e.onError);
    await act(async()=>{e.onError({code:'permission-denied'});await tick();await tick();});
    assert.equal(e.logoutCount,1);assert.equal(e.values.get('fnac-pulse-session-v1'),undefined);
    assert.match(text(tree.toJSON()),/Reconnectez-vous avec votre code PIN/);
    assert(tree.root.findByProps({'aria-label':'Code PIN personnel'}));
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0,'aucune ancienne invitation ne bloque la reconnexion');
    assert.doesNotMatch(text(tree.toJSON()),/Bonjour, Morgan/);
  } finally {await finish(tree,e);}
});

test('PWA connectée : autorisations non bloquantes, consentement explicite et réglages retrouvables',async()=>{
  const e=environment({auth:session});let tree;
  try {
    tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
    await e.press(button(tree,'Configurer'));
    assert(tree.root.findByProps({role:'dialog','aria-label':'Bien démarrer'}));
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/,'le tableau de bord reste derrière le dialogue volontaire');
    await e.press(action(tree,'Notifications d’équipe'));await e.press(action(tree,'Géolocalisation'));
    assert.deepEqual(e.notifications,[{gesture:true}]);assert.equal(e.locations.length,1);assert.equal(e.locations[0].gesture,true);
    assert.equal(e.subscriptions,1);assert.equal(e.values.get('fnac-pulse-fcm-enabled'),'1');
    await e.press(button(tree,'Continuer'));
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);assert.match(text(tree.toJSON()),/Bonjour, Morgan/);
    await e.press(tree.root.findByProps({className:'permissions-link'}));
    assert(tree.root.findByProps({role:'dialog','aria-label':'Bien démarrer'}),'les autorisations restent accessibles même après configuration');
    await e.press(button(tree,'Continuer'));
    assert.equal(e.notifications.length,1);assert.equal(e.locations.length,1);
  } finally {await finish(tree,e);}
});

test('Navigateur connecté : installation uniquement à la demande',async()=>{
  const e=environment({auth:session,standalone:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    await e.press(tree.root.findByProps({'aria-label':'Installer Fnac Pulse'}));
    const dialog=tree.root.findByProps({role:'dialog','aria-label':'Installer Fnac Pulse'});
    assert.match(text(dialog),/Sur l’écran d’accueil/);
    await e.press(dialog.findByProps({'aria-label':'Fermer'}));
    assert.match(text(tree.toJSON()),/Bonjour, Morgan/);assert.equal(e.logoutCount,0);
  } finally {await finish(tree,e);}
});

test('Invitation admin avec vendeur connecté : le dialogue voulu ouvre sur l’accueil, sans écran intermédiaire',async()=>{
  for(const standalone of [false,true]) {
    const e=environment({standalone,auth:'manual',directInvitation:true,adminValues:{'pulse-admin-token':'admin','pulse-admin-managed-store-v1':'far'}});let tree;
    try {
      tree=await mount({stayAtLaunch:true});assert.match(text(tree.toJSON()),/Ouverture de l’administration/);
      await e.authAs(session);
      const admin=tree.root.findByProps({role:'dialog','aria-label':'Administration'});
      assert.match(text(admin),/Magasin sélectionné : Fnac Loin/);assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
      assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
      assert.equal(tree.root.findAllByProps({role:'dialog'}).length,1);assert.equal(e.logoutCount,0);
      await e.press(admin.findByProps({'aria-label':'Fermer'}));assert.match(text(tree.toJSON()),/Bonjour, Morgan/);
    } finally {await finish(tree,e);}
  }
});

test('Lancement : chargement et panne actionnables, sans effacer le magasin admin',async()=>{
  const e=environment({auth:'manual',adminValues:{'pulse-admin-token':'admin','pulse-admin-managed-store-v1':'far'}});let tree;
  try {
    e.failBootstrap=true;tree=await mount({stayAtLaunch:true});
    assert.match(text(tree.toJSON()),/Vérification de votre session/);
    assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|VOTRE TABLEAU DE BORD/);
    assert.equal(button(tree,'Continuer sans attendre'),undefined,'aucune sortie anticipée pendant la vérification de session');
    assert.equal(tree.root.findAllByType('button').length,0,'page de chargement sans action');
    assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');
    await e.authAs(null);
    assert.match(text(tree.toJSON()),/Profil indisponible/);assert.match(text(tree.toJSON()),/Administration indisponible/);
    assert.equal(tree.root.findByProps({'aria-label':'Ouvrir l’administration'}).props.disabled,true);
    e.failBootstrap=false;
    await e.press(tree.root.findByProps({className:'startup-admin-status'}).findByType('button'));
    assert.equal(tree.root.findByProps({'aria-label':'Ouvrir l’administration'}).props.disabled,false);
    assert(section(tree,'Sélection du profil vendeur').findByProps({'aria-label':'Votre magasin Fnac'}));
    assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');
  } finally {await finish(tree,e);}
});

test('Navigation mobile : l’ordre des boutons suit l’ordre des blocs affichés',async()=>{
  const e=environment({standalone:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});await e.authAs(null);
    await e.press(button(tree,'Plus tard · Accéder aux services'));
    const blocks=tree.root.findAllByType('section').map(node=>node.props.id).filter(id=>['today','services','objectifs','summary','ranking'].includes(id));
    assert.deepEqual(blocks,['today','services','summary','ranking'],'blocs visibles sans session, dans l’ordre de la page');
    const labels=tree.root.findByProps({className:'mobile-nav'}).findAllByType('button').map(item=>text(item));
    assert.deepEqual(labels,['Aujourd’hui','Services','Objectifs','Bilan','Classement'],'barre mobile alignée sur les blocs');
    const navOrder=labels.map(label=>({'Aujourd’hui':'today',Services:'services',Objectifs:'objectifs',Bilan:'summary',Classement:'ranking'})[label]);
    assert.deepEqual(navOrder.filter(id=>blocks.includes(id)),blocks,'tout bouton pointe vers un bloc positionné au même rang');
  } finally {await finish(tree,e);}
});

test('Invitation directe : administration avant l’accueil, y compris pendant les permissions',async()=>{
  for(const leaveBeforeData of [false,true]) {
    const e=environment({auth:'manual',directInvitation:true,adminValues:{'pulse-admin-token':'admin','pulse-admin-managed-store-v1':'far'}});let tree;
    try {
      tree=await mount({stayAtLaunch:true});
      assert.match(text(tree.toJSON()),/Ouverture de l’administration après le chargement/);
      assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');
      await e.authAs(null);
      if(leaveBeforeData)await e.press(button(tree,'Plus tard · Accéder aux services'));
      const dialog=tree.root.findByProps({role:'dialog','aria-label':'Administration'});
      assert.match(text(dialog),/Magasin sélectionné : Fnac Loin/);
      assert.equal(e.adminValues.get('pulse-admin-managed-store-v1'),'far');
      assert.doesNotMatch(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
      await e.press(dialog.findByProps({'aria-label':'Fermer'}));
      assert.match(text(tree.toJSON()),leaveBeforeData?/Bien démarrer/:/Bienvenue sur/);
    } finally {await finish(tree,e);}
  }
});

test('PWA : le geste de connexion joue le son une fois et ouvre directement l’accueil',async()=>{
  const e=environment({auth:null,existingTouch:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});await selectMorganOnLaunch(tree,e);
    assert.deepEqual(e.sounds,[{gesture:true}]);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Morgan/);
    assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);assert.equal(e.logoutCount,0);
  } finally {await finish(tree,e);}
});

test('PWA restaurée : aucun autoplay, son au premier vrai geste et aucune répétition',async()=>{
  const e=environment({auth:session,existingTouch:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.equal(e.sounds.length,0);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),undefined);
    await documentGesture(e,{trusted:false});assert.equal(e.sounds.length,0,'un événement artificiel ne déclenche pas la lecture');
    await documentGesture(e);assert.deepEqual(e.sounds,[{gesture:true}]);
    assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');
    await documentGesture(e,{type:'click'});await documentGesture(e,{type:'keydown'});
    assert.equal(e.sounds.length,1);assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
  } finally {await finish(tree,e);}
});

test('PWA restaurée : son désactivé conservé et échec de lecture non bloquant avec réessai',async()=>{
  const muted=environment({auth:session,existingTouch:false});let tree;
  try {
    muted.values.set('fnac-pulse-sale-sound-v1','off');tree=await mount({stayAtLaunch:true});
    await documentGesture(muted);assert.equal(muted.sounds.length,0);
    assert.equal(muted.values.get('fnac-pulse-sale-sound-v1'),'off');assert.equal(muted.values.get('fnac-pulse-touch-welcome-v1'),'done');
    assert(tree.root.findByProps({'aria-label':'Activer le son Fnac'}));
  } finally {await finish(tree,muted);}
  const rejected=environment({auth:session,existingTouch:false});tree=null;
  try {
    rejected.audioReject=true;tree=await mount({stayAtLaunch:true});await documentGesture(rejected);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Le son Fnac n’a pas pu être lu/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    rejected.audioReject=false;
    await rejected.press(tree.root.findByProps({className:'toast toast-warning toast-sound-error'}).findByProps({className:'toast-action'}));
    assert.deepEqual(rejected.sounds,[{gesture:true},{gesture:true}]);assert.equal(rejected.values.get('fnac-pulse-touch-welcome-v1'),'done');
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
  } finally {await finish(tree,rejected);}
});

test('PWA : lecteur bloqué libéré sans bloquer l’accueil, puis réessai au geste',async()=>{
  const e=environment({auth:session,existingTouch:false});let tree;
  try {
    e.audioHang=true;tree=await mount({stayAtLaunch:true});await documentGesture(e);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.equal(e.sounds.length,1);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,6200));await tick();});
    assert.match(text(tree.toJSON()),/Le son Fnac n’a pas pu être lu/);assert(e.audioPauses>=1);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);
    e.audioHang=false;await e.press(tree.root.findByProps({className:'toast toast-warning toast-sound-error'}).findByProps({className:'toast-action'}));
    assert.deepEqual(e.sounds,[{gesture:true},{gesture:true}]);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');
  } finally {await finish(tree,e);}
});

test('PWA : soumission artificielle sans son, prochain geste réel pris en compte',async()=>{
  const e=environment({auth:null,existingTouch:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});await selectMorganOnLaunch(tree);
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.equal(e.sounds.length,0);
    await documentGesture(e);assert.deepEqual(e.sounds,[{gesture:true}]);
  } finally {await finish(tree,e);}
});

test('Changement vers la PWA : une session ouverte ne rappelle jamais l’écran de bienvenue',async()=>{
  const e=environment({auth:session,existingTouch:false,standalone:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    await act(async()=>{e.displayAs(true);await tick();await tick();});
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,0);assert.equal(e.sounds.length,0);
    assert(tree.root.findByProps({'aria-label':'Autorisations de cet appareil'}));
    await documentGesture(e);assert.deepEqual(e.sounds,[{gesture:true}]);assert.equal(e.logoutCount,0);
  } finally {await finish(tree,e);}
});

test('PWA : lecture refusée, accès sans son et choix des permissions préservés',async()=>{
  const e=environment({auth:null,existingTouch:false});let tree;
  try {
    e.audioReject=true;tree=await mount({stayAtLaunch:true});await e.press(button(tree,'Plus tard'));
    assert.deepEqual(e.sounds,[{gesture:true}]);assert.match(text(tree.toJSON()),/Le son n’a pas pu être lu/);
    assert.match(text(tree.toJSON()),/Continuer sans son/);
    await e.press(button(tree,'Continuer sans son'));
    assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),'done');assert.match(text(tree.toJSON()),/Bien démarrer/);
    assert.equal(e.notifications.length,0);assert.equal(e.locations.length,0);
  } finally {await finish(tree,e);}
});

test('Tableau de bord après le lancement : invitation en haut et textes conservés',async()=>{
  const e=environment({auth:session});let tree;
  try {
    tree=await mount();
    const output=text(tree.toJSON());
    assert(output.indexOf('Restez informés')>=0&&output.indexOf('Restez informés')<output.indexOf('VOTRE TABLEAU DE BORD'));
    assert.match(output,/VENTES QUOTIDIENNES/);assert.match(output,/Touchez un service pour ajouter une vente\./);
    assert(output.indexOf('VENTES QUOTIDIENNES')<output.indexOf('VOTRE PROGRESSION'));assert.match(output,/En cas d’égalité : Nb de DMAX, puis Nb de FVD/);
    assert.doesNotMatch(output,/VOTRE ESPACE DE VENTE/);assert.match(output,/La vente, c’est notre rayon\. Les services aussi\. 😉/);
    assert(tree.root.findByProps({'aria-label':'Mon profil, Morgan'}));
  } finally {await finish(tree,e);}
});

test('Plus tard dans un navigateur : accès à l’accueil sans profil ni lecture sonore',async()=>{
  const e=environment({standalone:false,auth:null,existingTouch:false});let tree;
  try {
    tree=await mount({stayAtLaunch:true});await e.press(button(tree,'Plus tard'));
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert(tree.root.findByProps({'aria-label':'Votre magasin Fnac'}));
    assert.equal(e.sellerCalls.length,0);assert.equal(e.sounds.length,0);assert.equal(e.values.get('fnac-pulse-touch-welcome-v1'),undefined);
  } finally {await finish(tree,e);}
});

test('Invitation directe dans un navigateur : pas de modale d’installation au-dessus de l’administration',async()=>{
  const e=environment({standalone:false,auth:'manual',directInvitation:true});let tree;
  try {
    tree=await mount({stayAtLaunch:true});await e.authAs(null);await e.press(button(tree,'Plus tard · Accéder aux services'));
    assert(tree.root.findByProps({role:'dialog','aria-label':'Espace administrateur'}));
    assert.equal(tree.root.findAllByProps({role:'dialog'}).length,1,'une seule modale visible');
    await e.press(tree.root.findByProps({role:'dialog','aria-label':'Espace administrateur'}).findByProps({'aria-label':'Fermer'}));
    assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
  } finally {await finish(tree,e);}
});

test('Profil mémorisé déconnecté au lancement : PIN requis, sans redemander le prénom',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    e.values.set('fnac-pulse-device-profile-v1',JSON.stringify({storeId:'near',sellerId:1}));
    tree=await mount({stayAtLaunch:true});const profile=()=>section(tree,'Sélection du profil vendeur');
    assert.match(text(profile()),/Morgan/);assert.match(text(profile()),/Fnac Près/);
    assert.equal(profile().findAllByProps({'aria-label':'Votre prénom'}).length,0);
    assert(profile().findByProps({'aria-label':'Code PIN personnel'}));assert.equal(e.sellerCalls.length,0);
    await act(async()=>{profile().findByProps({'aria-label':'Code PIN personnel'}).props.onChange({target:{value:'4829'}});await tick();});
    await act(async()=>{await profile().findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.deepEqual(e.sellerCalls,[{mode:'login',selection:{storeId:'near',departmentId:'tech',sellerId:1},pin:'4829',pinSalt:'sel-fictif'}]);
    assert.equal(e.logoutCount,0);assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);
    assert.doesNotMatch(text(tree.toJSON()),/Bienvenue sur|Accéder aux services/);
  } finally {await finish(tree,e);}
});

test('Ancien PIN au lancement : migration individuelle à 4 chiffres sans perte de profil',async()=>{
  const e=environment({standalone:false,auth:null});let tree;
  try {
    e.values.set('fnac-pulse-device-profile-v1',JSON.stringify({storeId:'near',sellerId:1}));
    e.pinStatus={needsPin:false,pinLength:8,pinSalt:'sel-fictif'};
    tree=await mount({stayAtLaunch:true});const profile=()=>section(tree,'Sélection du profil vendeur');
    const change=async(label,value)=>act(async()=>{profile().findByProps({'aria-label':label}).props.onChange({target:{value}});await tick();});
    assert.match(text(profile()),/Passez à un PIN de 4 chiffres/);
    await change('Ancien code PIN à 8 chiffres','73628519');await change('Votre nouveau code PIN','7284');await change('Confirmer votre code PIN','7284');
    await act(async()=>{await profile().findByType('form').props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.deepEqual(e.sellerCalls,[{mode:'migrate',selection:{storeId:'near',departmentId:'tech',sellerId:1},oldPin:'73628519',newPin:'7284',pinSalt:'sel-fictif'}]);
    assert.match(e.values.get('fnac-pulse-device-profile-v1'),/"sellerId":1/);assert.equal(e.logoutCount,0);
  } finally {await finish(tree,e);}
});

test('Échec de connexion admin au lancement : pas de droit attribué ni déconnexion vendeur',async()=>{
  const e=environment({auth:session});let tree;
  try {
    e.adminFail=true;tree=await mount({stayAtLaunch:true});await e.press(tree.root.findByProps({'aria-label':'Administration'}));
    const dialog=()=>tree.root.findByProps({role:'dialog','aria-label':'Espace administrateur'});
    await act(async()=>{dialog().findByProps({id:'admin-email'}).props.onChange({target:{value:'admin@example.test'}});dialog().findByProps({id:'admin-password'}).props.onChange({target:{value:'incorrect'}});await tick();});
    await act(async()=>{await dialog().findByProps({className:'admin-login-form'}).props.onSubmit({preventDefault(){}});await tick();await tick();});
    assert.match(text(dialog()),/Identifiants incorrects/);assert.equal(e.adminValues.get('pulse-admin-token'),undefined);
    assert.equal(e.logoutCount,0);assert.match(text(tree.toJSON()),/VOTRE TABLEAU DE BORD/);assert.match(text(tree.toJSON()),/Morgan/);
  } finally {await finish(tree,e);}
});

test('Ventes rapides : affichage immédiat provisoire, déduplication temps réel, réponse tardive et annulation',async()=>{
  const previousServices=data.services,service={id:1,name:'DMax',active:true};data.services=[service];
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree;
  const pending=[],api=e.mock.api;
  e.mock.api=(path,options={})=>{
    if(path==='/api/sales'&&options.method==='POST'){
      e.requests.push({path,method:'POST',body:options.body});
      return new Promise((resolve,reject)=>pending.push({resolve,reject,body:options.body}));
    }
    return api(path,options);
  };
  const day=parisToday(),catalog={sellers:data.sellers,services:data.services,stores:data.stores,departmentsByStore:data.departmentsByStore,serviceOrders:{}};
  const emit=sales=>e.onChange({...data,today:day,stats:summarize(catalog,sales,session.sellerId,day,session.storeId)},true,{catalog,sales,generation:'generation-test'});
  const sale=body=>({id:body.requestId,storeId:session.storeId,sellerId:1,departmentId:'tech',serviceId:1,createdAt:new Date().toISOString(),businessDate:day,deletedAt:null,source:'sale'});
  try {
    tree=await mount();await act(async()=>{emit([]);await tick();});
    const count=()=>text(tree.root.findByProps({id:'service-count-1'})),add=()=>tree.root.findByProps({'aria-label':'Ajouter une vente DMax'});
    const baseBootstrap=e.requests.filter(x=>x.path.startsWith('/api/bootstrap')).length;
    await act(async()=>{const click=add().props.onClick;click();click();await tick();});
    assert.equal(pending.length,1);assert.match(count(),/^1 aujourd’hui1 en cours/);
    assert.match(text(tree.toJSON()),/les chiffres incluent 1 vente en cours/);assert.doesNotMatch(text(tree.toJSON()),/Vente enregistrée\./);
    assert(add().props.disabled); // pas de doublon par double geste tant que le POST n'a pas répondu
    const first=sale(pending[0].body);
    await act(async()=>{emit([first]);await tick();});
    assert.match(count(),/^1 aujourd’hui$/);assert.doesNotMatch(text(tree.toJSON()),/les chiffres incluent/);
    assert(add().props.disabled); // l'instantané a précédé la réponse HTTP
    await act(async()=>{pending[0].resolve({id:first.id});await tick();await tick();});
    assert(!add().props.disabled);assert.match(text(tree.toJSON()),/Vente enregistrée\./);
    assert.equal(e.requests.filter(x=>x.path.startsWith('/api/bootstrap')).length,baseBootstrap,'pas de bootstrap additionnel bloquant');
    await act(async()=>{add().props.onClick();await tick();});assert.equal(pending.length,2);assert.match(count(),/^2 aujourd’hui1 en cours/);
    await act(async()=>{pending[1].resolve({id:pending[1].body.requestId});await tick();await tick();});
    assert(!add().props.disabled);assert.match(count(),/^2 aujourd’hui1 en cours/);assert(button(tree,'Annuler'));
    await e.press(button(tree,'Annuler'));assert.match(count(),/^1 aujourd’hui$/);assert.match(text(tree.toJSON()),/Vente annulée\./);
    await act(async()=>{add().props.onClick();await tick();});assert.equal(pending.length,3);assert.match(count(),/^2 aujourd’hui1 en cours/);
    await act(async()=>{pending[2].reject(Error('réponse perdue'));await tick();await tick();});
    assert.match(count(),/^1 aujourd’hui$/);assert.match(text(tree.toJSON()),/Résultat non confirmé/);assert.doesNotMatch(text(tree.toJSON()),/Vente enregistrée\./);
    const retry=()=>tree.root.findByProps({'aria-label':'Vérifier l’envoi DMax'});
    assert(!retry().props.disabled);assert(tree.root.findByProps({'aria-label':'Retirer une vente DMax'}).props.disabled);
    await act(async()=>{retry().props.onClick();await tick();});assert.equal(pending.length,4);
    assert.equal(pending[3].body.requestId,pending[2].body.requestId,'le rejeu garde le même identifiant');
    await act(async()=>{pending[3].resolve({id:pending[3].body.requestId,duplicate:true});await tick();await tick();});
    assert(!add().props.disabled);assert.match(text(tree.toJSON()),/Vente enregistrée\./);
  } finally {data.services=previousServices;await finish(tree,e);}
});

test('Réponse perdue : reprise du même identifiant après réouverture et résolution par instantané serveur',async()=>{
  const previousServices=data.services;data.services=[{id:1,name:'DMax',active:true}];
  const e=environment({geoPermission:'granted',notificationPermission:'granted',wanted:true,auth:session});let tree;
  const pending=[],api=e.mock.api;
  e.mock.api=(path,options={})=>{
    if(path==='/api/sales'&&options.method==='POST'){
      e.requests.push({path,method:'POST',body:options.body});return new Promise((resolve,reject)=>pending.push({resolve,reject,body:options.body}));
    }
    return api(path,options);
  };
  const day=parisToday(),catalog={sellers:data.sellers,services:data.services,stores:data.stores,departmentsByStore:data.departmentsByStore,serviceOrders:{}};
  const emit=sales=>e.onChange({...data,today:day,stats:summarize(catalog,sales,1,day,session.storeId)},true,{catalog,sales,generation:''});
  try {
    tree=await mount();await act(async()=>{emit([]);await tick();});
    await act(async()=>{tree.root.findByProps({'aria-label':'Ajouter une vente DMax'}).props.onClick();await tick();});
    const id=pending[0].body.requestId;
    assert.equal(pending[0].body.expectedDate,day);assert.equal(pending[0].body.expectedDepartmentId,'tech');
    assert.match(e.values.get('fnac-pulse-pending-sales-v1'),new RegExp(id));
    await act(async()=>{pending[0].reject(Error('réponse perdue'));await tick();});
    assert(tree.root.findByProps({'aria-label':'Vérifier l’envoi DMax'}));
    await act(async()=>tree.unmount());tree=null;
    tree=await mount();await act(async()=>{emit([]);await tick();});
    const retry=tree.root.findByProps({'aria-label':'Vérifier l’envoi DMax'});
    await act(async()=>{retry.props.onClick();await tick();});assert.equal(pending[1].body.requestId,id);assert.equal(pending[1].body.expectedDate,day);
    // L'instantané durable arrive avant une seconde réponse perdue.
    const committed={id,storeId:session.storeId,sellerId:1,departmentId:'tech',serviceId:1,businessDate:day,createdAt:new Date().toISOString(),deletedAt:null,source:'sale'};
    await act(async()=>{emit([committed]);await tick();});assert.equal(JSON.parse(e.values.get('fnac-pulse-pending-sales-v1')).length,0);
    await act(async()=>{pending[1].reject(Error('réponse perdue encore'));await tick();await tick();});
    assert.match(text(tree.toJSON()),/Vente enregistrée\./);assert.doesNotMatch(text(tree.toJSON()),/Résultat non confirmé/);
    assert.match(text(tree.root.findByProps({id:'service-count-1'})),/^1 aujourd’hui$/);
    assert(!tree.root.findByProps({'aria-label':'Ajouter une vente DMax'}).props.disabled);
  } finally {data.services=previousServices;await finish(tree,e);}
});
