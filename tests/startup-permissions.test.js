import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLocationPermission,startupPushPending,setStartupPushPending,STARTUP_PUSH_PENDING_KEY} from '../src/startup-permissions.js';

function storage() {
  const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('Position : lecture au lancement sans demander de coordonnées ni de permission système',async()=>{
  let positions=0,queries=0;
  const nav={geolocation:{getCurrentPosition(){positions++;}},permissions:{async query(request){queries++;assert.equal(request.name,'geolocation');return {state:'granted'};}}};
  assert.equal(await readLocationPermission(nav),'granted');assert.equal(queries,1);assert.equal(positions,0);
  nav.permissions.query=async()=>({state:'denied'});assert.equal(await readLocationPermission(nav),'denied');
  nav.permissions.query=async()=>({state:'prompt'});assert.equal(await readLocationPermission(nav),'prompt');
  nav.permissions.query=async()=>({state:'unexpected'});assert.equal(await readLocationPermission(nav),'prompt');
  nav.permissions.query=async()=>{throw Error('non pris en charge');};assert.equal(await readLocationPermission(nav),'prompt');
  delete nav.permissions;assert.equal(await readLocationPermission(nav),'prompt');
  assert.equal(await readLocationPermission(null),'unsupported');assert.equal(positions,0);
});

test('Position : une vérification de permissions bloquée ne bloque pas le démarrage',async()=>{
  const nav={geolocation:{getCurrentPosition(){}},permissions:{query:()=>new Promise(()=>{})}};
  assert.equal(await readLocationPermission(nav,{timeout:5}),'prompt');
});

test('Notifications : intention avant profil, aucune identité ou position dans le stockage',()=>{
  const s=storage();assert.equal(startupPushPending(s),false);
  setStartupPushPending(true,s);assert.equal(startupPushPending(s),true);assert.deepEqual([...s.values],[[STARTUP_PUSH_PENDING_KEY,'1']]);
  setStartupPushPending(false,s);assert.equal(startupPushPending(s),false);assert.equal(s.values.size,0);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  assert.equal(startupPushPending(blocked),false);assert.doesNotThrow(()=>setStartupPushPending(true,blocked));assert.doesNotThrow(()=>setStartupPushPending(false,blocked));
});
