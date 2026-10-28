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
    assert.equal((await request('/api/goals','POST',{...target,values:{day:0,week:8,month:30},revision})).status,400);
    assert.equal((await request('/api/goals','POST',target)).status,409);
    goal=await request('/api/goals','POST',{...target,values:{day:3,week:null,month:30},revision});assert.equal(goal.status,200);
    assert.equal(goal.value.goals[`s${service}`].day,3);
    assert.deepEqual((await request(`/api/admin/goals?storeId=${store.id}&sellerId=${s2}`, 'GET',undefined,token)).value.goals,{});
    const schedule={storeId:store.id,sellerId:s1,workdays:[1,2,3,4,6],revision:null};
    assert.equal((await request('/api/admin/workdays','POST',schedule)).status,401);
    assert.equal((await request('/api/admin/workdays','POST',{...schedule,workdays:[1,2,3,4]},token)).status,400);
    assert.equal((await request('/api/admin/workdays','POST',{...schedule,storeId:other.id},token)).status,400);
    const planned=await request('/api/admin/workdays','POST',schedule,token);assert.equal(planned.status,200);
    assert.deepEqual(planned.value.workdays,[1,2,3,4,6]);
    assert.equal(planned.value.goals[`s${service}`].day,3);
    assert.equal((await request('/api/admin/workdays','POST',schedule,token)).status,409);
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
    assert.equal(restored.goals[`s${service}`].day,3);assert.deepEqual(restored.workdays,[1,2,3,4,6]);assert(restored.workdaysRevision);
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
    assert.deepEqual(result.sellers,[{id:7,name:'Éric',storeId:LEGACY_STORE_ID}]);
    assert.equal(result.stats.day.total,1);assert.equal(result.stats.mineTotal,1);
  } finally {if(server)await stop(server);fs.rmSync(folder,{recursive:true,force:true});}
});
