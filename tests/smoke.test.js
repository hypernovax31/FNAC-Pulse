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
import {saleAdditionFingerprintInput,saleCorrectionFingerprintInput} from '../src/sale-history.js';
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
// Installer une situation historique fictive préexistante, sans passer par les
// API désormais verrouillées et sans modifier de base réelle.
function historicalDepartment(folder,sellerId,departmentId) {
  const db=new Database(path.join(folder,'pulse.sqlite'));
  try {db.prepare('UPDATE sellers SET department_id=? WHERE id=?').run(departmentId,sellerId);}finally{db.close();}
}

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
    assert.equal((await request(`/api/admin/entities/sellers/${two}`,'PATCH',{storeId:store,departmentId:'editorial'},token)).status,409);
    historicalDepartment(folder,two,'editorial');
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
    assert.equal((await request(`/api/admin/entities/sellers/${one}`,'PATCH',{storeId:store,departmentId:'editorial'},token)).status,409);
    // Une ancienne réaffectation simulée vérifie que les ventes existantes
    // et leur département d'origine restent correctement comptabilisés.
    historicalDepartment(folder,one,'editorial');
    assert.equal((await request('/api/sales/remove','POST',{storeId:store,sellerId:one,serviceId:service})).status,409);
    assert.equal((await request('/api/sales','POST',{storeId:store,sellerId:one,serviceId:service,requestId:'local-moved-sale-001'})).status,201);
    editorial=(await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats;
    assert.equal(editorial.day.total,2);assert.equal(editorial.mineTotal,2);assert.equal(editorial.day.mineByService.find(x=>x.serviceId===service).count,2);
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
    assert.deepEqual(payload.stores.filter(s=>s.directoryStatus==='regional-choice').map(s=>s.name).sort(),['Fnac Guadeloupe','Fnac La Réunion']);
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

test('SQLite reset ventes : confirmation, toutes dates, isolation et reprise sans second effacement',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-reset-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  try {
    server=await start(port,folder);
    const data=(await request('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=data.stores.find(s=>s.name==='Fnac Bordeaux').id;
    const [one,two]=data.sellers.slice(0,2).map(x=>x.id),service=data.services[0].id;
    const admin=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    const otherSeller=(await request('/api/admin/entities/sellers','POST',{name:'Autre équipe',storeId:other},admin)).body.id;
    assert.equal((await request(`/api/admin/entities/sellers/${two}`,'PATCH',{storeId:store,departmentId:'editorial'},admin)).status,409);
    historicalDepartment(folder,two,'editorial');
    assert.equal((await request('/api/admin/goals','POST',{storeId:store,sellerId:one,serviceId:service,values:{day:null,week:null,month:25},revision:null},admin)).status,200);
    const old={storeId:store,sellerId:one,serviceId:service,requestId:'sqlite-old-sale-01'};
    assert.equal((await request('/api/sales','POST',old)).status,201);
    assert.equal((await request('/api/sales','POST',{...old,sellerId:two,requestId:'sqlite-old-sale-02'})).status,201);
    assert.equal((await request('/api/sales','POST',{storeId:other,sellerId:otherSeller,serviceId:service,requestId:'sqlite-other-sale-1'})).status,201);
    const raw=new Database(path.join(folder,'pulse.sqlite'));
    raw.prepare('INSERT INTO sales(id,request_id,store_id,seller_id,service_id,business_date,created_at,deleted_at,department_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('old-history-1','sqlite-history-001',store,one,service,'2020-01-01','2020-01-01T12:00:00Z','2020-01-01T13:00:00Z','tech');raw.close();
    const reset={storeId:store,jobId:'sqlite-reset-job-01',confirmation:'SUPPRIMER'};
    assert.equal((await request('/api/admin/sales/reset','POST',reset)).status,401);
    assert.equal((await request('/api/admin/sales/reset','POST',{...reset,confirmation:'OUI'},admin)).status,400);
    assert.equal((await request('/api/admin/sales/reset','POST',{...reset,storeId:'inconnu'},admin)).status,400);
    assert.equal((await request(`/api/admin/sales/reset?storeId=${store}`,'GET',undefined,admin)).body.status,'idle');
    const done=await request('/api/admin/sales/reset','POST',reset,admin);assert.equal(done.status,200);assert.equal(done.body.status,'done');assert.equal(done.body.deletedSales,3);
    assert.equal((await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats.summary.store.day.total,0);
    assert.equal((await request(`/api/bootstrap?storeId=${other}&sellerId=${otherSeller}`)).body.stats.day.total,1);
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${one}`)).body.goals[`s${service}`].month,25);
    assert.equal((await request('/api/sales','POST',old)).status,409);
    assert.equal((await request('/api/sales','POST',{...old,requestId:'sqlite-new-sale-01'})).status,201);
    assert.equal((await request('/api/admin/sales/reset','POST',reset,admin)).body.status,'done');
    assert.equal((await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats.day.total,1);
    assert.equal((await request('/api/admin/sales/reset','POST',{...reset,storeId:other},admin)).status,409);
    await stop(server);server=await start(port,folder);
    const adminAgain=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    assert.equal((await request('/api/admin/sales/reset','POST',reset,adminAgain)).body.status,'done');
    assert.equal((await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats.day.total,1);
    assert.equal((await request('/api/admin/sales/reset','POST',{...reset,jobId:'sqlite-reset-job-02'},adminAgain)).body.deletedSales,1);
    assert.equal((await request('/api/sales','POST',{...old,requestId:'sqlite-new-sale-02'})).status,201);
    assert.equal((await request('/api/admin/sales/reset','POST',reset,adminAgain)).body.status,'superseded');
    assert.equal((await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats.day.total,1);
    assert.equal((await request(`/api/bootstrap?storeId=${other}&sellerId=${otherSeller}`)).body.stats.day.total,1);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite reset objectifs : département isolé, objectifs non renseignés, rejouabilité et persistance',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-goals-reset-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  try {
    server=await start(port,folder);
    const data=(await request('/api/bootstrap')).body,store=LEGACY_STORE_ID,other=data.stores.find(s=>s.name==='Fnac Bordeaux').id;
    const [one,two,archived]=data.sellers.slice(0,3).map(x=>x.id),service=data.services[0].id,service2=data.services[1].id;
    const token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    const otherSeller=(await request('/api/admin/entities/sellers','POST',{name:'Autre équipe',storeId:other},token)).body.id;
    assert.equal((await request(`/api/admin/entities/sellers/${two}`,'PATCH',{storeId:store,departmentId:'editorial'},token)).status,409);
    historicalDepartment(folder,two,'editorial');
    const save=(sellerId,serviceId=service,storeId=store,month=20)=>request('/api/admin/goals','POST',{storeId,sellerId,serviceId,values:{day:null,week:null,month},revision:null},token);
    for(const id of [one,two,archived])assert.equal((await save(id)).status,200);
    assert.equal((await save(one,service2,store,0)).status,200);assert.equal((await save(otherSeller,service,other,35)).status,200);
    assert.equal((await request('/api/admin/workdays','POST',{storeId:store,sellerId:one,workdays:[2,6,0],revision:null},token)).status,200);
    assert.equal((await request('/api/sales','POST',{storeId:store,sellerId:one,serviceId:service,requestId:'sqlite-goals-sale-001'})).status,201);
    assert.equal((await request(`/api/admin/entities/sellers/${archived}`,'PATCH',{storeId:store,active:false},token)).status,200);
    const reset={storeId:store,departmentId:'tech',jobId:'sqlite-goals-reset-001',confirmation:'SUPPRIMER'};
    assert.equal((await request('/api/admin/goals/reset','POST',reset)).status,401);
    assert.equal((await request('/api/admin/goals/reset','POST',{...reset,confirmation:'OUI'},token)).status,400);
    assert.equal((await request('/api/admin/goals/reset','POST',{...reset,departmentId:'inconnu'},token)).status,400);
    assert.equal((await request(`/api/admin/goals/reset?storeId=${store}`,'GET',undefined,token)).body.status,'idle');
    const done=await request('/api/admin/goals/reset','POST',reset,token);assert.equal(done.status,200);assert.equal(done.body.status,'done');assert(done.body.totalSellers>=2);assert.equal(done.body.resetSellers,2);
    let current=(await request(`/api/goals?storeId=${store}&sellerId=${one}`)).body;
    assert.deepEqual(current.goals,{});assert.deepEqual(current.workdays,[2,6,0]);assert(current.workdaysRevision);
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${two}`)).body.goals[`s${service}`].month,20);
    assert.equal((await request(`/api/goals?storeId=${other}&sellerId=${otherSeller}`)).body.goals[`s${service}`].month,35);
    assert.equal((await request(`/api/bootstrap?storeId=${store}&sellerId=${one}`)).body.stats.day.total,1);
    let raw=new Database(path.join(folder,'pulse.sqlite'));assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM seller_goals WHERE store_id=? AND seller_id=?').get(store,archived).n,0);raw.close();
    assert.equal((await save(one,service,store,42)).status,200);
    assert.equal((await request('/api/admin/goals/reset','POST',reset,token)).body.status,'done');
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${one}`)).body.goals[`s${service}`].month,42);
    assert.equal((await request('/api/admin/goals/reset','POST',{...reset,departmentId:'editorial'},token)).status,409);
    await stop(server);server=await start(port,folder);
    const token2=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    assert.equal((await request('/api/admin/goals/reset','POST',reset,token2)).body.status,'done');
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${one}`)).body.goals[`s${service}`].month,42);
    assert.equal((await request('/api/admin/goals/reset','POST',{...reset,departmentId:'editorial',jobId:'sqlite-goals-reset-002'},token2)).body.status,'done');
    assert.deepEqual((await request(`/api/goals?storeId=${store}&sellerId=${two}`)).body.goals,{});
    assert.equal((await request('/api/admin/goals/reset','POST',reset,token2)).body.status,'superseded');
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${one}`)).body.goals[`s${service}`].month,42);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite local : création autonome du profil, prénom existant et persistance',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-register-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server=await start(port,folder);
  async function request(route,method='GET',body,token){const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};}
  try {
    const initial=(await request('/api/bootstrap')).value,store=LEGACY_STORE_ID,other=initial.stores.find(x=>x.name==='Fnac Bordeaux').id;
    const region=initial.stores.find(x=>x.name==='Fnac Guadeloupe').id,regional={storeId:region,departmentId:'tech',name:'Profil Régional'};
    assert.equal((await request('/api/auth/register','POST',regional)).status,400);
    assert.equal((await request('/api/auth/register','POST',{...regional,regionalConsent:true})).status,200);
    assert.equal((await request('/api/auth/register','POST',{storeId:store,departmentId:'absent',name:'Ariane'})).status,400);
    const created=await request('/api/auth/register','POST',{storeId:store,departmentId:'editorial',name:'  Ariane   Test  '});assert.equal(created.status,200);
    assert.equal((await request('/api/auth/register','POST',{storeId:store,departmentId:'tech',name:'ariane test'})).status,409);
    assert.equal((await request('/api/auth/register','POST',{storeId:other,departmentId:'tech',name:'Ariane Test'})).status,200);
    assert.equal((await request('/api/auth/register','POST',{storeId:store,departmentId:'tech',name:'morgan'})).status,409);
    const updated=(await request('/api/bootstrap')).value,person=updated.sellers.find(x=>x.id===created.value.sellerId);
    assert.equal(person.name,'Ariane Test');assert.equal(person.departmentId,'editorial');assert.equal(person.storeId,store);
    await stop(server);server=await start(port,folder);
    assert.equal((await request('/api/bootstrap')).value.sellers.find(x=>x.id===person.id).name,'Ariane Test');
  } finally {await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : suppression définitive ciblée, toutes dates, vendeur archivé et rejeu sûr',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-seller-delete-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server=await start(port,folder);
  async function request(route,method='GET',body,token){const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
  try {
    const base=(await request('/api/bootstrap')).body,store=LEGACY_STORE_ID,otherStore=base.stores.find(s=>s.name==='Fnac Bordeaux').id;
    const target=base.sellers[0],neighbor=base.sellers[1],service=base.services[0].id;
    let token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    const otherId=(await request('/api/admin/entities/sellers','POST',{name:'Autre magasin',storeId:otherStore},token)).body.id;
    const targetSale={storeId:store,sellerId:target.id,serviceId:service,requestId:'local-delete-target-001'};
    assert.equal((await request('/api/sales','POST',targetSale)).status,201);
    assert.equal((await request('/api/sales','POST',{...targetSale,requestId:'local-delete-target-002'})).status,201);
    assert.equal((await request('/api/sales','POST',{...targetSale,sellerId:neighbor.id,requestId:'local-delete-neighbor-001'})).status,201);
    assert.equal((await request('/api/sales','POST',{...targetSale,storeId:otherStore,sellerId:otherId,requestId:'local-delete-other-store-001'})).status,201);
    for(const [id,st] of [[target.id,store],[neighbor.id,store],[otherId,otherStore]]) {
      assert.equal((await request('/api/admin/goals','POST',{storeId:st,sellerId:id,serviceId:service,values:{day:null,week:null,month:15},revision:null},token)).status,200);
      assert.equal((await request('/api/admin/workdays','POST',{storeId:st,sellerId:id,workdays:[1,3,6],revision:null},token)).status,200);
    }
    let raw=new Database(path.join(folder,'pulse.sqlite'));
    raw.prepare("UPDATE sales SET business_date='2020-01-01',deleted_at='2020-01-02' WHERE request_id='local-delete-target-001'").run();
    raw.prepare('INSERT INTO subscriptions(endpoint,store_id,seller_id,subscription_json,updated_at) VALUES (?,?,?,?,?)').run('https://push.test/a',store,target.id,'{}','2026-01-01');
    raw.prepare('INSERT INTO subscriptions(endpoint,store_id,seller_id,subscription_json,updated_at) VALUES (?,?,?,?,?)').run('https://push.test/b',store,neighbor.id,'{}','2026-01-01');
    raw.close();
    assert.equal((await request(`/api/admin/entities/sellers/${target.id}`,'PATCH',{storeId:store,active:false},token)).status,200);
    const job={storeId:store,sellerId:target.id,jobId:'sqlite-seller-delete-001',expectedName:target.name,expectedDepartmentId:target.departmentId,expectedStoreName:base.stores.find(s=>s.id===store).name,confirmation:'SUPPRIMER'};
    assert.equal((await request('/api/admin/sellers/delete','POST',job)).status,401);
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,confirmation:'OUI'},token)).status,400);
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,storeId:otherStore},token)).status,400);
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,expectedName:'Nom périmé'},token)).status,409);
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,expectedDepartmentId:'editorial'},token)).status,409);
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,expectedStoreName:'Magasin périmé'},token)).status,409);
    assert.equal((await request(`/api/admin/sellers/delete?storeId=${store}`,'GET',undefined,token)).body.status,'idle');
    const deleted=await request('/api/admin/sellers/delete','POST',job,token);assert.equal(deleted.status,200);assert.equal(deleted.body.status,'done');assert.equal(deleted.body.deletedSales,2);
    raw=new Database(path.join(folder,'pulse.sqlite'));
    for(const table of ['sellers','sales','seller_goals','seller_workdays','subscriptions']) {
      const col=table==='sellers'?'id':'seller_id';assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=?`).get(target.id).n,0,table);
    }
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sales WHERE seller_id=?').get(neighbor.id).n,1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE seller_id=?').get(neighbor.id).n,1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM reset_sale_requests WHERE request_id=?').get(targetSale.requestId).n,1);raw.close();
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${neighbor.id}`)).body.goals[`s${service}`].month,15);
    assert.equal((await request(`/api/goals?storeId=${otherStore}&sellerId=${otherId}`)).body.goals[`s${service}`].month,15);
    assert.equal((await request('/api/admin/sellers/delete','POST',job,token)).body.status,'done');
    assert.equal((await request('/api/admin/sellers/delete','POST',{...job,sellerId:neighbor.id},token)).status,409);
    const created=(await request('/api/admin/entities/sellers','POST',{name:target.name,storeId:store},token)).body.id;assert.notEqual(created,target.id);
    assert.equal((await request('/api/sales','POST',{...targetSale,sellerId:created})).status,409);
    await stop(server);server=await start(port,folder);token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    assert.equal((await request('/api/admin/sellers/delete','POST',job,token)).body.status,'done');
    assert((await request('/api/bootstrap')).body.sellers.some(s=>s.id===created));
    assert.equal((await request(`/api/goals?storeId=${store}&sellerId=${neighbor.id}`)).body.goals[`s${service}`].month,15);
  } finally {await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : suppression définitive d’un service uniquement dans le magasin choisi',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-pulse-service-delete-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  try {
    server=await start(port,folder);
    const base=(await request('/api/bootstrap')).body,store=base.stores.find(s=>s.id===LEGACY_STORE_ID),other=base.stores.find(s=>s.name==='Fnac Bordeaux');
    const [one,two]=base.sellers.slice(0,2).map(s=>s.id),first=base.services[0],second=base.services[1];
    const token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    const added=await request('/api/admin/entities/sellers','POST',{name:'Vendeur Bordeaux',storeId:other.id,departmentId:'tech'},token);assert.equal(added.status,201);const otherSeller=added.body.id;
    const goal=(sellerId,storeId,serviceId,month)=>({sellerId,storeId,serviceId,values:{day:null,week:null,month},revision:null});
    for(const g of [goal(one,store.id,first.id,12),goal(two,store.id,first.id,22),goal(one,store.id,second.id,30),goal(otherSeller,other.id,first.id,40)])
      assert.equal((await request('/api/admin/goals','POST',g,token)).status,200);
    assert.equal((await request('/api/admin/workdays','POST',{storeId:store.id,sellerId:one,workdays:[1,3,5],revision:null},token)).status,200);
    const firstSale={storeId:store.id,sellerId:one,serviceId:first.id,requestId:'first-service-sale-01'};
    const firstResult=await request('/api/sales','POST',firstSale);assert.equal(firstResult.status,201);
    assert.equal((await request('/api/sales','POST',{...firstSale,sellerId:two,requestId:'second-service-sale-1'})).status,201);
    assert.equal((await request('/api/sales','POST',{...firstSale,serviceId:second.id,requestId:'other-service-sale-01'})).status,201);
    assert.equal((await request('/api/sales','POST',{storeId:other.id,sellerId:otherSeller,serviceId:first.id,requestId:'other-store-sale-0001'})).status,201);
    assert.equal((await request(`/api/sales/${firstResult.body.id}`,'DELETE',{storeId:store.id,sellerId:one})).status,200);
    const direct=new Database(path.join(folder,'pulse.sqlite'));direct.prepare('UPDATE sales SET business_date=? WHERE request_id=?').run('2020-01-01','second-service-sale-1');direct.close();
    const body={storeId:store.id,serviceId:first.id,jobId:'local-service-delete-01',expectedName:first.name,expectedStoreName:store.name,confirmation:'SUPPRIMER'};
    assert.equal((await request('/api/admin/services/delete','POST',body)).status,401);
    assert.equal((await request('/api/admin/services/delete','POST',{...body,expectedName:'Mauvais'},token)).status,409);
    assert.equal((await request('/api/admin/services/delete','POST',{...body,confirmation:'NON'},token)).status,400);
    const deleted=await request('/api/admin/services/delete','POST',body,token);assert.equal(deleted.status,200);assert.equal(deleted.body.status,'done');
    assert.equal(deleted.body.deletedSales,2);assert.equal(deleted.body.deletedGoals,2);
    const here=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${one}`)).body,there=(await request(`/api/bootstrap?storeId=${other.id}&sellerId=${otherSeller}`)).body;
    assert(!here.services.some(s=>s.id===first.id));assert(there.services.some(s=>s.id===first.id));assert.equal(here.stats.day.total,1);assert.equal(there.stats.day.total,1);
    const a=(await request(`/api/goals?storeId=${store.id}&sellerId=${one}`)).body,b=(await request(`/api/goals?storeId=${other.id}&sellerId=${otherSeller}`)).body;
    assert.equal(a.goals[`s${first.id}`],undefined);assert.equal(a.goals[`s${second.id}`].month,30);assert.deepEqual(a.workdays,[1,3,5]);assert.equal(b.goals[`s${first.id}`].month,40);
    assert.equal((await request('/api/sales','POST',{...firstSale,requestId:'blocked-after-delete'},undefined)).status,400);
    assert.equal((await request('/api/admin/goals','POST',goal(one,store.id,first.id,1),token)).status,400);
    const all=(await request('/api/admin/all','GET',undefined,token)).body;assert.deepEqual(all.serviceRemovalsByStore[store.id],[first.id]);assert(!all.serviceRemovalsByStore[other.id]);
    await stop(server);server=await start(port,folder);
    assert(!(await request(`/api/bootstrap?storeId=${store.id}`)).body.services.some(s=>s.id===first.id));
    const token2=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).body.token;
    assert.equal((await request('/api/admin/services/restore','POST',{storeId:store.id,serviceId:first.id,expectedName:first.name,expectedStoreName:store.name},token2)).status,200);
    assert.equal((await request('/api/sales','POST',firstSale)).status,409);
    assert.equal((await request('/api/sales','POST',{...firstSale,requestId:'new-after-reactivation'})).status,201);
    assert.equal((await request('/api/admin/services/delete','POST',body,token2)).body.status,'done');
    assert.equal((await request(`/api/bootstrap?storeId=${store.id}&sellerId=${one}`)).body.stats.day.total,2);
    assert.equal((await request('/api/admin/services/delete','POST',{...body,storeId:other.id},token2)).status,409);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : historique par vendeur et période, correction précise, confirmation et rejeu sûr',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-history-test-')),port=await freePort(),url=`http://127.0.0.1:${port}`,server=await start(port,folder);
  let db;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  try {
    const base=(await request('/api/bootstrap')).value,store=base.stores.find(s=>s.id===LEGACY_STORE_ID),other=base.stores.find(s=>s.name==='Fnac Bordeaux');
    const one=base.sellers.find(s=>s.id===1),two=base.sellers.find(s=>s.id===2),token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).value.token;
    db=new Database(path.join(folder,'pulse.sqlite'));
    const add=db.prepare('INSERT INTO sales(id,store_id,seller_id,service_id,business_date,created_at,source,department_id,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)');
    add.run('old-seller-sale-1',store.id,one.id,1,'2026-10-29','2026-10-29T12:00:00Z','sale','tech',null);
    add.run('old-seller-sale-2',store.id,one.id,2,'2026-10-30','2026-10-30T12:00:00Z','adjustment','tech',null);
    add.run('old-other-seller1',store.id,two.id,1,'2026-10-29','2026-10-29T12:00:00Z','sale','tech',null);
    add.run('old-other-store-1',other.id,one.id,1,'2026-10-29','2026-10-29T12:00:00Z','sale','tech',null);
    add.run('old-outside-month',store.id,one.id,1,'2026-09-29','2026-09-29T12:00:00Z','sale','tech',null);
    add.run('old-already-gone',store.id,one.id,1,'2026-10-29','2026-10-29T12:00:00Z','sale','tech','2026-10-29T13:00:00Z');
    const query=`/api/admin/sales/history?storeId=${store.id}&sellerId=${one.id}&period=month&anchor=2026-10-29`;
    assert.equal((await request(query)).status,401);
    assert.deepEqual((await request(query,'GET',undefined,token)).value.sales.map(s=>s.id),['old-seller-sale-2','old-seller-sale-1']);
    const correction={storeId:store.id,sellerId:one.id,period:'day',anchor:'2026-10-29',saleIds:['old-seller-sale-1'],requestId:'sqlite-correction-0001',confirmation:'SUPPRIMER',expectedSellerName:one.name,expectedStoreName:store.name};
    assert.equal((await request('/api/admin/sales/correct','POST',correction)).status,401);
    for(const period of ['week','month'])assert.equal((await request('/api/admin/sales/correct','POST',{...correction,period},token)).status,400);
    assert.equal((await request('/api/admin/sales/correct','POST',{...correction,saleIds:['old-seller-sale-1','old-other-seller1']},token)).status,409);
    assert.equal(db.prepare('SELECT deleted_at FROM sales WHERE id=?').get('old-seller-sale-1').deleted_at,null);
    assert.equal((await request('/api/admin/sales/correct','POST',correction,token)).value.deleted,1);
    assert(db.prepare('SELECT deleted_at FROM sales WHERE id=?').get('old-seller-sale-1').deleted_at);
    for(const id of ['old-seller-sale-2','old-other-seller1','old-other-store-1','old-outside-month'])assert.equal(db.prepare('SELECT deleted_at FROM sales WHERE id=?').get(id).deleted_at,null);
    assert.equal((await request('/api/admin/sales/correct','POST',correction,token)).value.duplicate,true);
    assert.equal((await request('/api/admin/sales/correct','POST',{...correction,saleIds:['old-seller-sale-2']},token)).status,409);
    assert.deepEqual((await request(query,'GET',undefined,token)).value.sales.map(s=>s.id),['old-seller-sale-2']);
  } finally {db?.close();await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : ajout historique atomique, département et service archivés, rejouable sans doublon',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-add-history-')),port=await freePort(),url=`http://127.0.0.1:${port}`,server=await start(port,folder);let db;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  try {
    const base=(await request('/api/bootstrap')).value,store=base.stores.find(s=>s.id===LEGACY_STORE_ID),other=base.stores.find(s=>s.name==='Fnac Bordeaux');
    const seller=base.sellers.find(s=>s.id===1),service=base.services.find(s=>s.id===1),token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).value.token;
    db=new Database(path.join(folder,'pulse.sqlite'));
    db.prepare('INSERT INTO seller_goals(store_id,seller_id,service_id,day,week,month,revision) VALUES (?,?,?,?,?,?,?)').run(store.id,seller.id,service.id,4,12,32,'revision-test');
    db.prepare('INSERT INTO departments(store_id,id,name,active,sort_order) VALUES (?,?,?,?,?)').run(store.id,'tech','Produits Techniques',1,0);
    db.prepare('INSERT INTO departments(store_id,id,name,active,sort_order) VALUES (?,?,?,?,?)').run(store.id,'editorial','Ancien département',0,1);
    db.prepare("UPDATE sellers SET active=0,department_id='editorial' WHERE id=?").run(seller.id);db.prepare('UPDATE services SET active=0 WHERE id=?').run(service.id);
    const goal=db.prepare('SELECT * FROM seller_goals').get();
    const body={storeId:store.id,sellerId:seller.id,period:'day',anchor:'2026-10-13',saleDate:'2026-10-13',serviceId:service.id,departmentId:'editorial',quantity:3,requestId:'sqlite-history-add-0001',confirmation:'AJOUTER',expectedSellerName:seller.name,expectedStoreName:store.name,expectedServiceName:service.name,expectedDepartmentName:'Ancien département'};
    const route='/api/admin/sales/add-correction';assert.equal((await request(route,'POST',body)).status,401);
    for(const period of ['week','month'])assert.equal((await request(route,'POST',{...body,period},token)).status,400);
    for(const invalid of [{saleDate:''},{saleDate:'2026-11-01'},{saleDate:'2026-02-30'},{saleDate:'2999-01-01'},{quantity:0},{quantity:21},{quantity:1.5},{confirmation:''}])
      assert.equal((await request(route,'POST',{...body,...invalid},token)).status,400,JSON.stringify(invalid));
    for(const changed of [{storeId:other.id},{sellerId:99999},{serviceId:99999},{departmentId:'missing'},{expectedDepartmentName:'Incorrect'},{expectedServiceName:'Incorrect'}])
      assert.equal((await request(route,'POST',{...body,...changed},token)).status,409,JSON.stringify(changed));
    assert.equal((await request(route,'POST',{...body,departmentId:'tech',expectedDepartmentName:'Produits Techniques'},token)).status,409);
    const [one,two]=await Promise.all([request(route,'POST',body,token),request(route,'POST',body,token)]);
    assert.equal(one.status,200);assert.equal(two.status,200);assert.deepEqual([one.value.duplicate,two.value.duplicate].sort(),[false,true]);
    const rows=db.prepare('SELECT * FROM sales WHERE store_id=?').all(store.id);assert.equal(rows.length,3);
    for(const row of rows){assert.equal(row.seller_id,seller.id);assert.equal(row.service_id,service.id);assert.equal(row.department_id,'editorial');assert.equal(row.business_date,'2026-10-13');assert.equal(row.source,'adjustment');assert.equal(row.deleted_at,null);assert(!row.created_at.startsWith('2026-10-13'));}
    assert.deepEqual(db.prepare('SELECT * FROM seller_goals').get(),goal);assert.equal(db.prepare('SELECT count(*) AS n FROM sales WHERE store_id=?').get(other.id).n,0);
    assert.equal((await request(route,'POST',{...body,quantity:2},token)).status,409);
    const query=`/api/admin/sales/history?storeId=${store.id}&sellerId=${seller.id}&period=month&anchor=2026-10-29`,list=(await request(query,'GET',undefined,token)).value.sales;assert.equal(list.length,3);
    const correction={storeId:store.id,sellerId:seller.id,period:'day',anchor:'2026-10-13',saleIds:[list[0].id],requestId:'sqlite-added-remove-001',confirmation:'SUPPRIMER',expectedSellerName:seller.name,expectedStoreName:store.name};
    assert.equal((await request('/api/admin/sales/correct','POST',correction,token)).value.deleted,1);assert.equal(db.prepare('SELECT count(*) AS n FROM sales WHERE deleted_at IS NULL').get().n,2);
    db.prepare('INSERT INTO store_service_removals(store_id,service_id) VALUES (?,?)').run(store.id,service.id);
    assert.equal((await request(route,'POST',{...body,requestId:'sqlite-history-removed'},token)).status,409);
    assert.equal((await request(route,'POST',body,token)).value.duplicate,true);assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n,3);
  } finally {db?.close();await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : anciens marqueurs semaine et mois rejouables sans écriture',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-legacy-history-')),port=await freePort(),url=`http://127.0.0.1:${port}`,server=await start(port,folder);let db;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  try {
    const base=(await request('/api/bootstrap')).value,store=base.stores.find(s=>s.id===LEGACY_STORE_ID),seller=base.sellers.find(s=>s.id===1),service=base.services.find(s=>s.id===1);
    const token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).value.token;
    db=new Database(path.join(folder,'pulse.sqlite'));
    db.prepare('INSERT INTO sales(id,store_id,seller_id,service_id,business_date,created_at,source,department_id) VALUES (?,?,?,?,?,?,?,?)').run('preserved-sale',store.id,seller.id,1,'2026-10-13','2026-10-13T12:00:00Z','sale','tech');
    const hash=value=>crypto.createHash('sha256').update(value).digest('base64url');
    for(const period of ['week','month']) {
      const addition={storeId:store.id,sellerId:seller.id,period,anchor:'2026-10-15',saleDate:'2026-10-13',serviceId:1,departmentId:'tech',quantity:2,requestId:`sqlite-legacy-add-${period}`,confirmation:'AJOUTER',expectedSellerName:seller.name,expectedStoreName:store.name,expectedServiceName:service.name,expectedDepartmentName:'Produits Techniques'};
      const removal={storeId:store.id,sellerId:seller.id,period,anchor:'2026-10-15',saleIds:['preserved-sale'],requestId:`sqlite-legacy-remove-${period}`,confirmation:'SUPPRIMER',expectedSellerName:seller.name,expectedStoreName:store.name};
      db.prepare('INSERT INTO sale_addition_requests VALUES (?,?,?,?)').run(addition.requestId,hash(saleAdditionFingerprintInput(addition)),2,1);
      db.prepare('INSERT INTO sale_correction_requests VALUES (?,?,?,?)').run(removal.requestId,hash(saleCorrectionFingerprintInput(removal)),1,1);
      const before=db.prepare('SELECT * FROM sales').all();
      assert.deepEqual((await request('/api/admin/sales/add-correction','POST',addition,token)).value,{ok:true,added:2,duplicate:true});
      assert.deepEqual((await request('/api/admin/sales/correct','POST',removal,token)).value,{ok:true,deleted:1,duplicate:true});
      assert.equal((await request('/api/admin/sales/add-correction','POST',{...addition,quantity:3},token)).status,409);
      assert.equal((await request('/api/admin/sales/correct','POST',{...removal,saleIds:['another-sale']},token)).status,409);
      assert.equal((await request('/api/admin/sales/add-correction','POST',{...addition,requestId:`sqlite-new-add-${period}`},token)).status,400);
      assert.equal((await request('/api/admin/sales/correct','POST',{...removal,requestId:`sqlite-new-remove-${period}`},token)).status,400);
      assert.deepEqual(db.prepare('SELECT * FROM sales').all(),before,'aucune vente modifiée');
    }
  } finally {db?.close();await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});

test('SQLite : migration sans minimum rétroactif, plancher serveur et changement de période',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fnac-goal-minimum-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let server=await start(port,folder),db;
  const request=async(route,method='GET',body,token)=>{const r=await fetch(url+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  try {
    const base=(await request('/api/bootstrap')).value,store=LEGACY_STORE_ID,seller=base.sellers[0].id,service=base.services[0].id;
    db=new Database(path.join(folder,'pulse.sqlite'));
    db.prepare('INSERT INTO seller_goals(store_id,seller_id,service_id,day,week,month,revision) VALUES (?,?,?,?,?,?,?)').run(store,seller,service,4,12,30,'ancien-objectif-001');
    await stop(server);
    db.exec('ALTER TABLE seller_goals DROP COLUMN minimum; ALTER TABLE seller_goals DROP COLUMN personal;');db.close();db=null;
    server=await start(port,folder);
    const token=(await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'})).value.token;
    const get=async()=>(await request(`/api/goals?storeId=${store}&sellerId=${seller}`)).value.goals[`s${service}`];
    let entry=await get();assert.equal(entry.month,30);assert.equal(entry.minimum,undefined);assert.equal(entry.revision,'ancien-objectif-001');
    const body={storeId:store,sellerId:seller,serviceId:service},month=n=>({day:null,week:null,month:n}),week=n=>({day:null,week:n,month:null});
    const personal=(values,revision)=>request('/api/goals','POST',{...body,values,revision});
    const admin=(values,revision)=>request('/api/admin/goals','POST',{...body,values,revision},token);
    let result=await personal(month(25),entry.revision);assert.equal(result.status,200);entry=result.value.goals[`s${service}`];assert.equal(entry.minimum,undefined);
    result=await admin(month(20),entry.revision);assert.equal(result.status,200);entry=result.value.goals[`s${service}`];assert.equal(entry.month,25);assert.equal(entry.minimum.amount,20);
    assert.equal((await personal(month(19),entry.revision)).status,403);assert.equal((await personal(week(999),entry.revision)).status,403);
    result=await personal(month(50),entry.revision);entry=result.value.goals[`s${service}`];assert.equal(entry.month,50);
    result=await admin(month(60),entry.revision);entry=result.value.goals[`s${service}`];assert.equal(entry.month,60);
    result=await admin(month(20),entry.revision);entry=result.value.goals[`s${service}`];assert.equal(entry.month,50);
    result=await admin(week(8),entry.revision);entry=result.value.goals[`s${service}`];assert.equal(entry.minimum.period,'week');
    assert.equal((await personal(month(9999),entry.revision)).status,403);
    assert.equal((await personal(week(8),entry.revision)).status,200);
  } finally {db?.close();await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});
