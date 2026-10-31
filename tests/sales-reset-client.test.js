import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parisToday} from '../src/cloud-stats.js';
import {saleInGeneration,salesGeneration} from '../src/sales-reset.js';

const require=createRequire(import.meta.url);
const stubs={
  'firebase/app':`export function initializeApp(){return {}}`,
  'firebase/auth':`export function getAuth(){return {}};export function onAuthStateChanged(){};export function signInWithCustomToken(){};export function signInWithEmailAndPassword(){};export function signOut(){};export function setPersistence(){};export const browserSessionPersistence={};export const EmailAuthProvider={};export function reauthenticateWithCredential(){};export function updatePassword(){}`,
  'firebase/firestore':`export function getFirestore(){return {}};export function doc(db,...p){return {key:p.join('/')}};export function collection(db,...p){return {key:p.join('/')+'?query'}};export function where(){};export function query(ref){return ref};export function onSnapshot(ref,opts,next){globalThis.__resetListeners.set(ref.key,next);return ()=>globalThis.__resetListeners.delete(ref.key)}`,
  'firebase/messaging':`export async function isSupported(){return false};export function getMessaging(){};export async function getToken(){};export async function deleteToken(){}`,
};
const bundled=await build({entryPoints:['src/cloud.js'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({VITE_BACKEND:'cloud'})},plugins:[{name:'firebase-reset-fictif',setup(b){
  b.onResolve({filter:/^firebase\//},args=>({path:args.path,namespace:'fake-firebase'}));
  b.onLoad({filter:/.*/,namespace:'fake-firebase'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(module,module.exports,require);
const {listenStore}=module.exports;
const snapshot=(data,cache=false)=>({data:()=>data,exists:()=>data!==undefined,metadata:{fromCache:cache}});
const salesSnapshot=(rows,added=[],cache=false)=>({docs:rows.map(data=>({data:()=>data})),metadata:{fromCache:cache},docChanges:()=>added.map(data=>({type:'added',doc:{data:()=>data}}))});

test('Reset client : les anciennes ventes disparaissent immédiatement, les nouvelles restent annoncées',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__resetListeners');globalThis.__resetListeners=new Map();
  const store='shop-test',day=parisToday(),updates=[],announcements=[],errors=[];
  const session={storeId:store,sellerId:1,uid:'seller-test',accessVersion:'valid-version'};
  const catalog={stores:[{id:store,name:'Magasin test',active:true}],sellers:[{id:1,name:'Morgan',active:true,storeId:store,departmentId:'tech'}],services:[{id:1,name:'DMax',active:true}],serviceOrders:{}};
  const old={id:'old-sale',storeId:store,sellerId:1,serviceId:1,businessDate:day,createdAt:new Date().toISOString(),source:'sale',clientId:'other',departmentId:'tech'};
  try {
    const stop=listenStore(session,day,'this-device',(data,live)=>updates.push({data,live}),sale=>announcements.push(sale),error=>errors.push(error));
    const emit=(key,value)=>{const listener=globalThis.__resetListeners.get(key);assert(listener,`Écoute manquante : ${key}`);listener(value);};
    emit('pulseStatus/seller-test',snapshot({active:true,storeId:store,sellerId:1,version:'valid-version'}));
    emit('pulse/catalog',snapshot(catalog));
    emit(`pulseStores/${store}/sales/~summary-goals~`,snapshot(undefined));
    emit(`pulseStores/${store}/sales?query`,salesSnapshot([old],[old]));
    assert.equal(updates.length,0); // ne pas afficher d'anciennes ventes avant le marqueur
    emit(`pulseStores/${store}/sales/~sales-reset~`,snapshot(undefined));
    assert.equal(updates.at(-1).data.stats.day.total,1);assert.equal(announcements.length,0); // historique initial
    emit(`pulseStores/${store}/sales/~sales-reset~`,snapshot({generation:'reset-job-1'}));
    assert.equal(updates.at(-1).data.stats.day.total,0);
    const fresh={...old,id:'new-sale-1',generation:'reset-job-1'};
    emit(`pulseStores/${store}/sales?query`,salesSnapshot([old,fresh],[fresh]));
    assert.equal(updates.at(-1).data.stats.day.total,1);assert.equal(announcements.length,1);
    const newer={...old,id:'new-sale-2',generation:'reset-job-2'};
    emit(`pulseStores/${store}/sales?query`,salesSnapshot([old,fresh,newer],[newer]));
    assert.equal(updates.at(-1).data.stats.day.total,1);assert.equal(announcements.length,1);
    emit(`pulseStores/${store}/sales/~sales-reset~`,snapshot({generation:'reset-job-2'}));
    assert.equal(updates.at(-1).data.stats.day.total,1);assert.equal(announcements.length,2);assert.equal(announcements[1].id,'new-sale-2');
    emit(`pulseStores/${store}/sales/~sales-reset~`,snapshot({generation:'reset-job-2'},true));
    assert.equal(updates.at(-1).live,false);assert.deepEqual(errors,[]);
    stop();assert.equal(globalThis.__resetListeners.size,0);
  } finally {if(previous)Object.defineProperty(globalThis,'__resetListeners',previous);else delete globalThis.__resetListeners;}
});

test('Reset client : les anciennes données sans génération restent valides avant le premier reset',()=>{
  assert.equal(salesGeneration(), '');assert(saleInGeneration({},''));assert(!saleInGeneration({},'new-generation'));
  assert(saleInGeneration({generation:'new-generation'},'new-generation'));
  assert(!saleInGeneration({generation:'another-generation'},'new-generation'));
});
