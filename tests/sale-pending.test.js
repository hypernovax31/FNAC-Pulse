import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PENDING_SALES_KEY,readPendingSales,savePendingSales} from '../src/sale-pending.js';
const record={owner:'["store",1,"uid","v1"]',day:'2026-10-26',storeId:'store',sellerId:1,serviceId:1,departmentId:'tech',requestId:'sale-request-001',clientId:'device-id-001',originTokenId:'',generation:''};

test('Reprise de vente : stockage borné aux données nécessaires, aucun jeton ou PIN',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v)};
  assert.deepEqual(readPendingSales(storage),[]);savePendingSales([record],storage);assert.deepEqual(readPendingSales(storage),[record]);
  assert(!values.get(PENDING_SALES_KEY).includes('password'));assert(!values.get(PENDING_SALES_KEY).includes('pinMac'));
  storage.setItem(PENDING_SALES_KEY,'invalide');assert.deepEqual(readPendingSales(storage),[]);
  storage.setItem(PENDING_SALES_KEY,JSON.stringify([record,{...record,requestId:'bad'},{...record,departmentId:''},{...record,serviceId:-1}]));
  assert.deepEqual(readPendingSales(storage),[record]);
  const unavailable={getItem(){throw Error()},setItem(){throw Error()}};
  assert.deepEqual(readPendingSales(unavailable),[]);assert.doesNotThrow(()=>savePendingSales([record],unavailable));
});
