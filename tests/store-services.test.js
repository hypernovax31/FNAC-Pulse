import {test} from 'node:test';
import assert from 'node:assert/strict';
import {servicesForStore,serviceRemovedForStore} from '../src/catalog.js';
import {summarize} from '../src/cloud-stats.js';

test('Service retiré : catalogue et bilans isolés par magasin, sans migration destructive',()=>{
  const cat={services:[{id:1,name:'DMax',active:true},{id:2,name:'Garantie',active:true},{id:3,name:'Ancien',active:false}],
    sellers:[{id:1,name:'Alice',storeId:'a',active:true},{id:2,name:'Benoît',storeId:'b',active:true}],
    serviceOrders:{a:[2,1,3]},serviceRemovalsByStore:{a:[1]}};
  assert.equal(serviceRemovedForStore(cat,'a',1),true);assert.equal(serviceRemovedForStore(cat,'b',1),false);
  assert.deepEqual(servicesForStore(cat,'a').map(s=>s.id),[2]);
  assert.deepEqual(servicesForStore(cat,'b').map(s=>s.id),[1,2]);
  assert.deepEqual(servicesForStore(cat,'a',{activeOnly:false,includeRemoved:true}).map(s=>s.id),[2,1,3]);
  assert.deepEqual(servicesForStore({...cat,serviceRemovalsByStore:undefined},'a').map(s=>s.id),[2,1]);
  const sale=(id,sellerId,serviceId)=>({id,sellerId,serviceId,businessDate:'2026-11-01',createdAt:'2026-11-01T12:00:00.000Z',source:'sale'});
  const a=summarize(cat,[sale('a1',1,1),sale('a2',1,2)],1,'2026-11-01');
  const b=summarize(cat,[sale('b1',2,1),sale('b2',2,2)],2,'2026-11-01');
  assert.equal(a.day.total,1);assert.equal(a.mineTotal,1);assert.equal(a.activity.length,1);assert.deepEqual(a.day.byService.map(s=>s.id),[2]);
  assert.equal(b.day.total,2);assert.equal(b.mineTotal,2);assert.deepEqual(b.day.byService.map(s=>s.id),[1,2]);
});
