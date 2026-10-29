import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarChip} from '../src/calendar.js';
import {isFreshSale,createSaleSnapshotFilter,createSaleAnnouncer} from '../src/live-sales.js';
import {summarize} from '../src/cloud-stats.js';

const DAY='2026-10-29',NOW=Date.parse('2026-10-29T15:30:00Z');
const sale=(extra={})=>({id:'a',source:'sale',businessDate:DAY,createdAt:new Date(NOW-1000).toISOString(),sellerId:2,serviceId:1,departmentId:'tech',clientId:'autre',...extra});
const snap=(fromCache,changes)=>({metadata:{fromCache},docChanges:()=>changes.map(([type,row])=>({type,doc:{data:()=>row}}))});

test('Date : semaine ISO et noms français, y compris aux changements d’année',()=>{
  assert.deepEqual(calendarChip(DAY),{week:'S44',weekday:'Jeu',month:'Oct',day:'29'});
  assert.deepEqual(calendarChip('2021-01-01'),{week:'S53',weekday:'Ven',month:'Jan',day:'1'});
  assert.deepEqual(calendarChip('2021-01-04'),{week:'S1',weekday:'Lun',month:'Jan',day:'4'});
  assert.deepEqual(calendarChip('2027-01-01'),{week:'S53',weekday:'Ven',month:'Jan',day:'1'});
  assert.deepEqual(calendarChip('2027-01-04'),{week:'S1',weekday:'Lun',month:'Jan',day:'4'});
});

test('Ventes en direct : pas de son au chargement ni au retour des anciennes données',()=>{
  const filter=createSaleSnapshotFilter({day:DAY,clientId:'moi',now:()=>NOW});
  const old=sale({id:'ancienne',createdAt:new Date(NOW-180000).toISOString()});
  assert.deepEqual(filter(snap(true,[['added',old]])),[]); // premier état du cache
  assert.deepEqual(filter(snap(false,[['added',old],['added',sale()]])),[]); // première base serveur
  assert.deepEqual(filter(snap(true,[['added',sale()]])),[]); // cache après déconnexion
  const fresh=sale({id:'nouvelle'});
  const changes=[['added',fresh],['added',old],['added',sale({clientId:'moi'})],['added',sale({deletedAt:'2026-10-29'})],['added',sale({businessDate:'2026-10-28'})],['modified',sale({id:'correction'})]];
  assert.deepEqual(filter(snap(false,changes)),[fresh]);
  assert.equal(isFreshSale(sale({createdAt:new Date(NOW+6000).toISOString()}),DAY,'moi',NOW),false);
});

test('Annonce : catalogue tardif sans fuite des noms et sans perdre la vente',()=>{
  const received=[],announcer=createSaleAnnouncer(value=>received.push(value));
  announcer.add(sale());assert.equal(received.length,0);
  announcer.setCatalog({sellers:[{id:2,name:'Camille'}],services:[{id:1,name:'DMax'}]});
  assert.equal(received[0].sellerName,'Camille');assert.equal(received[0].serviceName,'DMax');
});

test('Activité du jour : toute l’équipe du département, triée, sans limite à six',()=>{
  const storeId='test-store',catalog={services:[{id:1,name:'DMax',active:true}],sellers:[{id:1,name:'Morgan',storeId,departmentId:'tech',active:true},{id:2,name:'Camille',storeId,departmentId:'tech',active:true},{id:3,name:'Lou',storeId,departmentId:'editorial',active:true}]};
  const rows=Array.from({length:12},(_,i)=>sale({id:`s${i}`,sellerId:i%2+1,createdAt:new Date(NOW-i*1000).toISOString()}));
  rows.push(sale({id:'autre-departement',sellerId:3,departmentId:'editorial'}),sale({id:'annulee',deletedAt:'2026-10-29'}),sale({id:'hier',businessDate:'2026-10-28'}),sale({id:'correction',source:'adjustment'}));
  const result=summarize(catalog,rows,1,DAY,storeId);
  assert.equal(result.activity.length,12);assert.deepEqual(result.activity.map(x=>x.id),rows.slice(0,12).map(x=>x.id));
  assert(result.activity.every(x=>x.sellerId===1||x.sellerId===2));
  assert.equal(result.summary.store.day.total,14); // vente annulée exclue ; correction incluse dans les totaux
});
