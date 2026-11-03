import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parisToday} from '../src/cloud-stats.js';

// Exercer le vrai écouteur du client, sans Firestore ni push réels : le son
// n'est raccordé qu'au callback onSale, donc les autres événements ne doivent
// jamais y parvenir.
const require=createRequire(import.meta.url);
const sources={
  'firebase/app':`export const initializeApp=()=>({});;export function deleteApp(){};`,
  'firebase/auth':`export const getAuth=()=>({});export const onAuthStateChanged=()=>()=>{};export const signInWithCustomToken=()=>{};export const signInWithEmailAndPassword=()=>{};export const signOut=()=>{};export const setPersistence=()=>{};export const browserSessionPersistence={};export const EmailAuthProvider={};export const reauthenticateWithCredential=()=>{};export const updatePassword=()=>{};;export function createUserWithEmailAndPassword(){};export const inMemoryPersistence={};export function verifyBeforeUpdateEmail(){};export function sendEmailVerification(){};export function sendPasswordResetEmail(){};export function verifyPasswordResetCode(){};export function confirmPasswordReset(){};export function reload(){};export function checkActionCode(){};export function applyActionCode(){};`,
  'firebase/firestore':`export const getFirestore=()=>({});export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=(_db,...parts)=>({path:parts.join('/')});export const query=x=>x;export const where=()=>({});export const onSnapshot=(ref,_options,next)=>globalThis.__liveScope.listen(ref.path,next);`,
  'firebase/messaging':`export const getMessaging=()=>({});export const getToken=()=>{};export const deleteToken=()=>{};export const isSupported=()=>true;`,
};
const bundled=await build({entryPoints:['src/cloud.js'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',define:{'import.meta.env':'{"VITE_BACKEND":"cloud"}'},plugins:[{name:'firebase-fixtures',setup(b){
  b.onResolve({filter:/^firebase\/(app|auth|firestore|messaging)$/},args=>({path:args.path,namespace:'firebase-fixture'}));
  b.onLoad({filter:/.*/,namespace:'firebase-fixture'},args=>({contents:sources[args.path],loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {listenStore}=module.exports;

test('Flux cloud : seuls les collègues récents du département déclenchent le callback sonore',()=>{
  const previous=globalThis.__liveScope,handlers=new Map(),stopped=[],received=[],errors=[];
  globalThis.__liveScope={listen(path,fn){handlers.set(path,fn);return ()=>stopped.push(path);}};
  const day=parisToday(),store='magasin-test',session={storeId:store,sellerId:1,uid:'uid-test',accessVersion:'v1'};
  const catalog={
    stores:[{id:store,name:'Magasin fictif',active:true}],
    sellers:[{id:1,name:'Morgan',storeId:store,departmentId:'tech',active:true},{id:2,name:'Camille',storeId:store,departmentId:'tech',active:true},{id:3,name:'Alex',storeId:store,departmentId:'editorial',active:true}],
    services:[{id:1,name:'DMax',active:true},{id:2,name:'Service retiré',active:true}],serviceRemovalsByStore:{[store]:[2]},
  };
  const doc=(value,fromCache=false)=>({metadata:{fromCache},exists:()=>true,data:()=>value});
  const row=(id,extra={})=>({id,source:'sale',businessDate:day,createdAt:new Date().toISOString(),sellerId:2,serviceId:1,departmentId:'tech',clientId:'autre-appareil',...extra});
  const snap=(rows,{fromCache=false,type='added'}={})=>({metadata:{fromCache},docs:[],docChanges:()=>rows.map(data=>({type,doc:{data:()=>data}}))});
  let stop;
  try {
    stop=listenStore(session,day,'appareil-actuel',()=>{},value=>received.push(value),error=>errors.push(error));
    assert(handlers.has(`pulseStores/${store}/sales`));
    handlers.get('pulseStatus/uid-test')(doc({active:true,version:'v1',storeId:store,sellerId:1}));
    handlers.get('pulse/catalog')(doc(catalog));
    handlers.get(`pulseStores/${store}/sales/~sales-reset~`)(doc({}));
    handlers.get(`pulseStores/${store}/sales`)(snap([row('historique-recent')])); // premier serveur : historique, pas d'alerte
    handlers.get(`pulseStores/${store}/sales`)(snap([row('cache')],{fromCache:true}));
    assert.deepEqual(received,[]);
    handlers.get(`pulseStores/${store}/sales`)(snap([
      row('collegue'),row('ma-vente-autre-telephone',{sellerId:1}),row('autre-departement',{sellerId:3,departmentId:'editorial'}),
      row('service-retire',{serviceId:2}),row('correction',{source:'adjustment'}),row('supprimee',{deletedAt:new Date().toISOString()}),
      row('ancienne',{createdAt:new Date(Date.now()-120000).toISOString()}),row('meme-appareil',{clientId:'appareil-actuel'}),
    ]));
    assert.deepEqual(received.map(x=>[x.id,x.sellerName,x.serviceName]),[['collegue','Camille','DMax']]);
    handlers.get(`pulseStores/${store}/sales`)(snap([row('modification')],{type:'modified'}));
    assert.equal(received.length,1);assert.deepEqual(errors,[]);
  } finally {stop?.();if(previous===undefined)delete globalThis.__liveScope;else globalThis.__liveScope=previous;}
  assert.equal(stopped.length,5);
});
