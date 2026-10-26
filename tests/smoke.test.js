import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fnac-pulse-test-'));
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function start(port) {
  const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:temp,ADMIN_PASSWORD:'MotDePasseDeTest!2026'}});
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
    const store=first.value.stores.find(s=>s.name==='Fnac Bordeaux');
    const other=first.value.stores.find(s=>s.name==='Fnac Bordeaux-Lac');
    const s1=first.value.sellers[0].id, s2=first.value.sellers[1].id, service=first.value.services[0].id;
    const body={storeId:store.id,sellerId:s1,serviceId:service,requestId:'request-test-0001'};
    const sale=await request('/api/sales','POST',body);assert.equal(sale.status,201);
    const duplicate=await request('/api/sales','POST',body);assert.equal(duplicate.value.duplicate,true);
    let view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;
    assert.equal(view.stats.day.total,1);assert.equal(view.stats.week.total,1);assert.equal(view.stats.month.total,1);assert.equal(view.stats.mineTotal,1);
    assert.equal(view.stats.leaderboard[0].id,s1);
    assert.equal((await request(`/api/bootstrap?storeId=${other.id}&sellerId=${s1}`)).value.stats.day.total,0);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s2})).status,409);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s1})).status,200);
    assert.equal((await request(`/api/sales/${sale.value.id}`,'DELETE',{storeId:store.id,sellerId:s1})).status,409);
    assert.equal((await request('/api/admin/all')).status,401);
    assert.equal((await request('/api/admin/login','POST',{password:'incorrect'})).status,401);
    const login=await request('/api/admin/login','POST',{password:'MotDePasseDeTest!2026'});assert.equal(login.status,200);const token=login.value.token;
    assert.equal((await request('/api/admin/adjust','POST',{storeId:store.id,sellerId:s1,serviceId:service,count:3},token)).status,200);
    assert.equal((await request('/api/admin/adjust','POST',{storeId:store.id,sellerId:s1,serviceId:service,count:-1},token)).status,400);
    view=(await request(`/api/bootstrap?storeId=${store.id}&sellerId=${s1}`)).value;assert.equal(view.stats.day.total,3);
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
    console.log('Ventes, isolation des magasins, administration, validation push et persistance : OK');
  } finally {await stop(server);fs.rmSync(temp,{recursive:true,force:true});}
});
