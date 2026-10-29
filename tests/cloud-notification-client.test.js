import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const stubs={
  'firebase/app':`export function initializeApp(){return {}}`,
  'firebase/auth':`export function getAuth(){return {}};export function onAuthStateChanged(){};export function signInWithCustomToken(){};export function signInWithEmailAndPassword(){};export function signOut(){};export function setPersistence(){};export const browserSessionPersistence={};export const EmailAuthProvider={};export function reauthenticateWithCredential(){};export function updatePassword(){}`,
  'firebase/firestore':`export function getFirestore(){return {}};export function doc(){};export function collection(){};export function query(){};export function where(){};export function onSnapshot(){}`,
  'firebase/messaging':`export async function isSupported(){return true};export function getMessaging(){return {}};export async function getToken(){globalThis.__testFcmTokens++;return 'token-fictif'};export async function deleteToken(){globalThis.__testFcmDeletes++;return true}`,
};
const result=await build({entryPoints:['src/cloud.js'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({VITE_BACKEND:'cloud',VITE_FIREBASE_VAPID_KEY:'cle-publique-test'})},plugins:[{name:'firebase-fictif',setup(b){
  b.onResolve({filter:/^firebase\//},args=>({path:args.path,namespace:'firebase-fictif'}));
  b.onLoad({filter:/.*/,namespace:'firebase-fictif'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,require);
const {subscribeFcm,unsubscribeFcm,notificationsWanted}=module.exports;

test('FCM : ne demande jamais la permission pendant une vérification ou une désactivation',async()=>{
  const names=['navigator','Notification','localStorage','__testFcmTokens','__testFcmDeletes'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const put=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  try {
    let release;const ready=new Promise(resolve=>{release=resolve;});
    put('navigator',{serviceWorker:{ready}});put('Notification',{permission:'granted'});
    const values=new Map();put('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
    put('__testFcmTokens',0);put('__testFcmDeletes',0);const calls=[];
    const api=async(path,options)=>calls.push({path,...options});
    // La permission peut avoir changé pendant l'attente du service worker.
    const pending=subscribeFcm(api);Notification.permission='default';release({});
    await assert.rejects(pending,/Autorisation de notification non accordée/);
    await assert.rejects(unsubscribeFcm(api),/Autorisation de notification non accordée/);
    assert.equal(globalThis.__testFcmTokens,0);assert.equal(calls.length,0);
    Notification.permission='granted';
    let releaseSecond;navigator.serviceWorker.ready=new Promise(resolve=>{releaseSecond=resolve;});
    const controller=new AbortController(),cancelled=subscribeFcm(api,{signal:controller.signal});
    controller.abort();releaseSecond({});await assert.rejects(cancelled,{name:'AbortError'});
    assert.equal(globalThis.__testFcmTokens,0);assert.equal(calls.length,0);
    let releaseApi,markStarted;const held=new Promise(resolve=>{releaseApi=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});
    const lateController=new AbortController(),late=subscribeFcm(async()=>{markStarted();await held;},{signal:lateController.signal});
    await started;lateController.abort();releaseApi();await assert.rejects(late,{name:'AbortError'});
    assert.equal(notificationsWanted(),false);globalThis.__testFcmTokens=0;
    await subscribeFcm(api);
    assert.equal(globalThis.__testFcmTokens,1);assert.equal(notificationsWanted(),true);assert.equal(calls[0].method,'POST');
    await unsubscribeFcm(api);assert.equal(calls[1].method,'DELETE');assert.equal(globalThis.__testFcmDeletes,1);assert.equal(notificationsWanted(),false);
    put('localStorage',{getItem(){throw Error('stockage bloqué')}});assert.equal(notificationsWanted(),false);
  } finally {
    for(const [name,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
});
