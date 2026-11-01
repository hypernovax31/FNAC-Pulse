import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digestBase64} from '../worker/firebase.js';
import {rememberPushOrigin,readPushOrigin,clearPushOrigin,PUSH_ORIGIN_KEY} from '../src/push-origin.js';

function memory() {const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}

test('Abonnement émetteur : empreinte compatible Worker, jamais le jeton en clair',async()=>{
  const storage=memory(),token='a-valid-firebase-device-token-123456';
  const id=await rememberPushOrigin(token,storage);
  assert.equal(id,await digestBase64(token));assert.equal(readPushOrigin(storage),id);
  assert.notEqual(storage.getItem(PUSH_ORIGIN_KEY),token);
  clearPushOrigin(storage);assert.equal(readPushOrigin(storage),'');
  storage.setItem(PUSH_ORIGIN_KEY,'invalide');assert.equal(readPushOrigin(storage),'');
});

test('Abonnement émetteur : stockage inaccessible ou vérification annulée',async()=>{
  const denied={setItem(){throw Error('blocked');},getItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  assert.equal(await rememberPushOrigin('a-token',denied),'');assert.equal(readPushOrigin(denied),'');assert.doesNotThrow(()=>clearPushOrigin(denied));
  const storage=memory(),controller=new AbortController();controller.abort();
  assert.equal(await rememberPushOrigin('a-token',storage,crypto,controller.signal),'');assert.equal(readPushOrigin(storage),'');
});
