import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import Database from 'better-sqlite3';
import { LEGACY_STORE_ID } from '../src/catalog.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fnac-pulse-test-'));
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function start(port,folder=temp) {
  const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:folder,ADMIN_PASSWORD:'MotDePasseDeTest!2026'}});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Le serveur de test ne démarre pas')),10000);
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('est prêt')){clearTimeout(timer);resolve();}});
    child.once('error',err=>{clearTimeout(timer);reject(err)});
    child.once('exit',code=>{if(code!==null&&code!==0){clearTimeout(timer);reject(new Error(`Serveur arrêté : ${code}`));}});
  });
  return child;
}
async function stop(child) {if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}

test('API Fnac Pulse : saisie, isolation, administration, push et persistance',async t=>{
  const port=await freePort();const url=`http://127.0.0.1:${port}`;let server=await start(port);
  async function request(route,method='GET',body,token) {
    const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const value=await r.json();return {status:r.status,value};
  }
  try {
    const first=await request('/api/bootstrap');
    assert.equal(first.status,200);assert.equal(first.value.sellers.length,12);assert.equal(first.value.services.length,11);
    assert(first.value.stores.length>=170);assert.equal(first.value.stats,null);
    const store=first.value.stores.find(s=>s.id===LEGACY_STORE_ID);
    const other=first.value.stores.find(s=>s.name==='Fnac Bordeaux');
    assert(first.value.sellers.every(s=>s.storeId===store.id));
    const s1=first.value.sellers[0].id, s2=first.value.sellers[1].id, service=first.value.services[0].id;
    const body={storeId:store.id,sellerId:s1,serviceId:service,requestId:'request-test-0001'};
    assert.equal((await request('/api/sales','POST',{...body,storeId:other.id})).status,400);
    const sale=await request('/api/sales','POST',body);assert.equal(sale.status,201);
    const duplicate=await request('/api/sales','POST',body);assert.equal(duplicate.value.duplicate,true);
    let view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;
    assert.equal(view.stats.day.total,1);assert.equal(view.stats.week.total,1);assert.equal(view.stats.month.total,1);assert.equal(view.stats.mineTotal,1);
    for(const period of ['day','week','month'])assert.deepEqual(view.stats[period].mineByService,[{serviceId:service,count:1}]);
    assert.equal(view.stats.leaderboard[0].id,s1);
    assert.equal((await request(`/api/bootstrap?storeId=${other.id}&sellerId=${s1}`)).value.stats.day.total,0);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s2})).status,409);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s1})).status,200);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s1})).status,409);
    assert.equal((await request('/api/admin/all')).status,401);
    assert.equal((await request('/api/admin/login','POST',{password:'incorrect'})).status,401);
    const login=await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'});assert.equal(login.status,200);const token=login.value.token;
    assert.equal((await request(`/api/admin/goals?storeId=${store.id}&sellerId=${s1}`)).status,401);
    assert.equal((await request(`/api/goals?storeId=${other.id}&sellerId=${s1}`)).status,400);
    const target={storeId:store.id,sellerId:s1,serviceId:service,values:{day:2,week:8,month:30},revision:null};
    let goal=await request('/api/admin/goals','POST',target,token);assert.equal(goal.status,200);
    const revision=goal.value.goals[`s${service}`].revision;
    assert.equal((await request('/api/goals','POST',{...target,values:{day:-1,week:8,month:30},revision})).status,400);
    assert.equal((await request('/api/goals','POST',target)).status,409);
    goal=await request('/api/goals','POST',{...target,values:{day:3,week:null,month:30},revision});assert.equal(goal.status,200);
    assert.equal(goal.value.goals[`s${service}`].day,3);
    assert.deepEqual((await request(`/api/admin/goals?storeId=${store.id}&sellerId=${s2}`, 'GET',undefined,token)).value.goals,{});
    const schedule={storeId:store.id,sellerId:s1,workdays:[1,2,3,4,6],revision:null};
    assert.equal((await request('/api/admin/workdays','POST',schedule)).status,401);
    assert.equal((await request('/api/admin/workdays','POST',{...schedule,workdays:[]},token)).status,400);
    assert.equal((await request('/api/admin/workdays','POST',{...schedule,storeId:other.id},token)).status,400);
    const planned=await request('/api/admin/workdays','POST',schedule,token);assert.equal(planned.status,200);
    assert.deepEqual(planned.value.workdays,[1,2,3,4,6]);
    assert.equal(planned.value.goals[`s${service}`].day,3);
    assert.equal((await request('/api/admin/workdays','POST',schedule,token)).status,409);
    const withSunday=await request('/api/admin/workdays','POST',{...schedule,workdays:[0,6,2],revision:planned.value.workdaysRevision},token);
    assert.equal(withSunday.status,200);assert.deepEqual(withSunday.value.workdays,[2,6,0]);
    assert.deepEqual((await request(`/api/goals?storeId=${store.id}&sellerId=${s2}`)).value.workdays,[1,2,3,4,5]);

    const name=first.value.sellers[0].name;
    assert.equal((await request('/api/admin/entities/sellers','POST',{name,storeId:other.id},token)).status,201);
    assert.equal((await request('/api/admin/entities/sellers','POST',{name:name.toLowerCase(),storeId:other.id},token)).status,409);
    const ids=first.value.services.map(x=>x.id);[ids[0],ids[4]]=[ids[4],ids[0]];
    assert.equal((await request('/api/admin/services/order','POST',{storeId:store.id,serviceIds:ids},token)).status,200);
    assert.equal((await request(`/api/bootstrap?storeId=${store.id}`)).value.services[0].id,5);
    assert.equal((await request(`/api/bootstrap?storeId=${other.id}`)).value.services[0].id,1);
    assert.equal((await request('/api/admin/adjust','POST',{storeId:store.id,sellerId:s1,serviceId:service,count:3},token)).status,200);
    assert.equal((await request('/api/admin/adjust','POST',{storeId:store.id,sellerId:s1,serviceId:service,count:-1},token)).status,400);
    view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;assert.equal(view.stats.day.total,3);
    for(const period of ['day','week','month'])assert.deepEqual(view.stats[period].mineByService,[{serviceId:service,count:3}]);
    assert.equal((await request(`/api/admin/entities/sellers/${s1}`,'PATCH',{name:'Morgan Test'},token)).status,200);
    view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;assert.equal(view.stats.leaderboard[0].name,'Morgan Test');
    // A valid EC public key simulates the structure of a browser PushSubscription.
    const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();const keys={p256dh:ecdh.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')};
    let sub={endpoint:'https://attacker.example/push',keys};
    assert.equal((await request('/api/push/subscribe','POST',{storeId:store.id,sellerId:s1,subscription:sub})).status,400);
    sub={endpoint:'https://jmt17.google.com/fcm/send/test-id',keys};
    assert.equal((await request('/api/push/subscribe','POST',{storeId:store.id,sellerId:s1,subscription:sub})).status,200);
    assert.equal((await request('/api/push/subscribe','DELETE',{endpoint:sub.endpoint})).status,200);
    const publicKey=first.value.pushPublicKey;
    await stop(server);server=await start(port);
    view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;
    assert.equal(view.stats.day.total,3);assert.equal(view.stats.leaderboard[0].name,'Morgan Test');assert.equal(view.pushPublicKey,publicKey);
    const restored=(await request(`/api/goals?storeId=${store.id}&sellerId=${s1}`)).value;
    assert.equal(restored.goals[`s${service}`].day,3);assert.deepEqual(restored.workdays,[2,6,0]);assert(restored.workdaysRevision);
    console.log('Ventes, isolation des magasins, administration, validation push et persistance : OK');
  } finally {await stop(server);fs.rmSync(temp,{recursive:true,force:true});}
});

test('SQLite historique : migration des vendeurs sans perdre les ventes',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-old-'));
  const old=new Database(path.join(folder,'pulse.sqlite'));
  old.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',lat REAL,lon REAL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE sellers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,icon TEXT NOT NULL DEFAULT 'other',active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sales (id TEXT PRIMARY KEY,request_id TEXT UNIQUE,store_id TEXT NOT NULL REFERENCES stores(id),seller_id INTEGER NOT NULL REFERENCES sellers(id),service_id INTEGER NOT NULL REFERENCES services(id),business_date TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,source TEXT NOT NULL DEFAULT 'sale');
  `);
  old.prepare('INSERT INTO stores(id,name) VALUES (?,?)').run(LEGACY_STORE_ID,'Fnac Labège');
  old.prepare('INSERT INTO sellers(id,name) VALUES (?,?)').run(7,'Éric');
  old.prepare('INSERT INTO services(id,name,icon) VALUES (?,?,?)').run(1,'DMax','play');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  old.prepare('INSERT INTO sales(id,store_id,seller_id,service_id,business_date,created_at) VALUES (?,?,?,?,?,?)').run('legacy-sale',LEGACY_STORE_ID,7,1,date,new Date().toISOString());
  old.close();const port=await freePort();let server;
  try {
    server=await start(port,folder);
    const result=await (await fetch(`http://127.0.0.1:${port}/api/bootstrap?storeId=${LEGACY_STORE_ID}&sellerId=7`)).json();
    assert.deepEqual(result.sellers,[{id:7,name:'Éric',storeId:LEGACY_STORE_ID,departmentId:'tech'}]);
    assert.equal(result.stats.day.total,1);assert.equal(result.stats.mineTotal,1);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite départements : isolation, objectifs agrégés, transfert et persistance',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-depts-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  try {
    server=await start(port,folder);
    const first=(await request('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=first.stores.find(s=>s.name==='Fnac Bordeaux').id;
    const [one,two]=first.sellers.slice(0,2).map(s=>s.id),service=first.services[0].id;
    assert(first.sellers.every(s=>s.departmentId==='tech'));
    const token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    assert.equal((await request('/api/admin/departments','POST',{storeId:store,name:'Photo'})).status,401);
    const created=await request('/api/admin/departments','POST',{storeId:store,name:'Photo'},token);assert.equal(created.status,201);
    assert.equal((await request(`/api/admin/departments/${created.body.id}`,'PATCH',{storeId:store,name:'Image'},token)).status,200);
    assert.equal((await request('/api/admin/departments','POST',{storeId:store,name:'image'},token)).status,409);
    assert.equal((await request(`/api/admin/entities/sellers/${two}`,'PATCH',{storeId:store,departmentId:'editorial'},token)).status,200);
    assert.equal((await request('/api/admin/departments/editorial','PATCH',{storeId:store,active:false},token)).status,409);
    assert.equal((await request(`/api/admin/entities/sellers/${two}`,'PATCH',{storeId:other,departmentId:'cash'},token)).status,400);
    for(const [sellerId,month] of [[one,12],[two,24]])assert.equal((await request('/api/admin/goals','POST',{storeId:store,sellerId,serviceId:service,values:{day:null,week:null,month},revision:null},token)).status,200);
    let goals=(await request(`/api/summary-goals?storeId=${store}`)).body;
    assert.equal(goals.store.byService[`s${service}`].month,36);assert.equal(goals.departments.tech.byService[`s${service}`].month,12);assert.equal(goals.departments.editorial.byService[`s${service}`].month,24);
    assert(!JSON.stringify(goals).includes('workdays'));assert(!JSON.stringify(goals).includes(first.sellers[0].name));
    const a=await request('/api/sales','POST',{storeId:store,sellerId:one,serviceId:service,requestId:'local-tech-sale-0001'});
    const b=await request('/api/sales','POST',{storeId:store,sellerId:two,serviceId:service,requestId:'local-editorial-sale-1'});
    assert.equal(a.status,201);assert.equal(b.status,201);
    let tech=(await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats;
    let editorial=(await request(`/api/bootstrap?storeId=${store}&sellerId=${two}`)).body.stats;
    assert.equal(tech.day.total,1);assert.equal(editorial.day.total,1);assert.equal(tech.summary.store.day.total,2);
    assert.equal(tech.activity[0].sellerId,one);assert.equal(editorial.activity[0].sellerId,two);
    assert.equal((await request(`/api/admin/entities/sellers/${one}`,'PATCH',{storeId:store,departmentId:'editorial'},token)).status,200);
    assert.equal((await request('/api/sales/remove','POST',{storeId:store,sellerId:one,serviceId:service})).status,409);
    assert.equal((await request('/api/sales','POST',{storeId:store,sellerId:one,serviceId:service,requestId:'local-moved-sale-001'})).status,201);
    editorial=(await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats;
    assert.equal(editorial.day.total,2);assert.equal(editorial.mineTotal,1);assert.equal(editorial.day.mineByService.find(x=>x.serviceId===service).count,2);
    assert.equal(editorial.summary.store.day.total,3);assert.equal(editorial.summary.departments.tech.day.total,1);assert.equal(editorial.summary.departments.editorial.day.total,2);
    goals=(await request(`/api/summary-goals?storeId=${store}`)).body;
    assert.equal(goals.departments.editorial.byService[`s${service}`].month,36);assert.equal(goals.departments.tech.byService[`s${service}`].month,null);
    await stop(server);server=await start(port,folder);
    const restored=(await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body;
    assert.equal(restored.stats.summary.store.day.total,3);assert.equal(restored.stats.summary.departments.tech.day.total,1);
    assert.equal(restored.sellers.find(s=>s.id===one).departmentId,'editorial');assert.equal(restored.departmentsByStore[store].find(d=>d.id===created.body.id).name,'Image');
    assert.equal(restored.departmentsByStore[other],undefined);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite annuaire Fnac : migration non destructive et idempotente des magasins',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-stores-'));
  const old=new Database(path.join(folder,'pulse.sqlite'));
  old.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE stores (id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',lat REAL,lon REAL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE sellers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,store_id TEXT);
    CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,icon TEXT NOT NULL DEFAULT 'other',active INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sales (id TEXT PRIMARY KEY,request_id TEXT UNIQUE,store_id TEXT NOT NULL REFERENCES stores(id),seller_id INTEGER NOT NULL REFERENCES sellers(id),service_id INTEGER NOT NULL REFERENCES services(id),business_date TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,source TEXT NOT NULL DEFAULT 'sale');
    CREATE TABLE seller_goals (store_id TEXT NOT NULL REFERENCES stores(id),seller_id INTEGER NOT NULL REFERENCES sellers(id),service_id INTEGER NOT NULL REFERENCES services(id),day INTEGER,week INTEGER,month INTEGER,revision TEXT NOT NULL,PRIMARY KEY(store_id,seller_id,service_id));
    CREATE TABLE seller_workdays (store_id TEXT NOT NULL REFERENCES stores(id),seller_id INTEGER NOT NULL REFERENCES sellers(id),days TEXT NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(store_id,seller_id));
  `);
  const insert=old.prepare('INSERT INTO stores(id,name,city,address,lat,lon,active) VALUES (?,?,?,?,?,?,?)');
  insert.run(LEGACY_STORE_ID,'Fnac Labège','Labège','',43.551969,1.506877,1);
  insert.run('osm-node-3782323705','Fnac Laval','Laval','5 Rue du Général de Gaulle',48.070549,-0.77434,1);
  insert.run('osm-node-2445153699',"Fnac Toulouse – 77 Rue d'Alsace-Lorraine",'Toulouse',"77 Rue d'Alsace-Lorraine",43.607949,1.4455,1);
  insert.run('osm-node-7619822721','Fnac Nantes','Nantes','',47.21,-1.55,0);
  insert.run('custom-shop','Espace ajouté','', '',12,3,1);
  old.prepare('INSERT INTO sellers(id,name,store_id) VALUES (?,?,?)').run(7,'Éric',LEGACY_STORE_ID);
  old.prepare('INSERT INTO sellers(id,name,store_id) VALUES (?,?,?)').run(8,'Vendeur Laval','osm-node-3782323705');
  old.prepare('INSERT INTO services(id,name,icon) VALUES (?,?,?)').run(1,'DMax','play');
  old.prepare('INSERT INTO sales(id,store_id,seller_id,service_id,business_date,created_at) VALUES (?,?,?,?,?,?)').run('historique','osm-node-3782323705',8,1,'2026-10-01','2026-10-01T12:00:00Z');
  old.prepare('INSERT INTO seller_goals VALUES (?,?,?,?,?,?,?)').run(LEGACY_STORE_ID,7,1,1,3,12,'revision-goal');
  old.prepare('INSERT INTO seller_workdays VALUES (?,?,?,?)').run(LEGACY_STORE_ID,7,'[1,3,5]','revision-days');
  old.close();const port=await freePort();let server;
  try {
    server=await start(port,folder);
    const payload=await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json();
    assert.equal(payload.stores.find(s=>s.fnacId==='cl57').id,LEGACY_STORE_ID);
    assert.deepEqual(payload.directoryRegions,['Fnac Guadeloupe','Fnac La Réunion']);
    assert(payload.stores.every(s=>s.directoryStatus!=='region'));
    assert.equal(payload.stores.find(s=>s.fnacId==='cl449').id,'osm-node-3782323705');
    assert.equal(payload.stores.find(s=>s.fnacId==='cl56').name,"Fnac Toulouse - Jeanne-d'Arc (Micro)");
    assert(payload.stores.some(s=>s.id==='custom-shop'));
    assert.equal(payload.sellers.find(s=>s.id===8).storeId,'osm-node-3782323705');
    await stop(server);server=await start(port,folder);await stop(server);server=null;
    const check=new Database(path.join(folder,'pulse.sqlite'),{readonly:true});
    assert.equal(check.prepare("SELECT active FROM stores WHERE id='osm-node-7619822721'").get().active,0);
    assert.equal(check.prepare("SELECT COUNT(*) n FROM stores WHERE fnac_id='cl57'").get().n,1);
    assert.equal(check.prepare("SELECT store_id FROM sales WHERE id='historique'").get().store_id,'osm-node-3782323705');
    assert.equal(check.prepare('SELECT month FROM seller_goals WHERE seller_id=7').get().month,12);
    assert.equal(check.prepare('SELECT days FROM seller_workdays WHERE seller_id=7').get().days,'[1,3,5]');check.close();
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});
