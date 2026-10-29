import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEVICE_PROFILE_KEY,readDeviceProfile,saveDeviceProfile,clearDeviceProfile} from '../src/device-profile.js';

test('Profil du téléphone : seul le magasin et le vendeur sont mémorisés, jamais le PIN',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  assert.equal(readDeviceProfile(storage),null);
  assert.deepEqual(readDeviceProfile(storage,{storeId:'store-1',sellerId:3,uid:'token',accessVersion:'secret'}),{storeId:'store-1',sellerId:3});
  assert.deepEqual(saveDeviceProfile({storeId:'store-1',sellerId:'3',pin:'12345678',uid:'secret'},storage),{storeId:'store-1',sellerId:3});
  assert.deepEqual(JSON.parse(values.get(DEVICE_PROFILE_KEY)),{storeId:'store-1',sellerId:3});
  assert.deepEqual(readDeviceProfile(storage),{storeId:'store-1',sellerId:3});
  clearDeviceProfile(storage);assert.equal(readDeviceProfile(storage),null);
});

test('Profil du téléphone : données locales illisibles ou invalides traitées sans erreur',()=>{
  const denied={getItem(){throw Error('refusé')},setItem(){throw Error('refusé')},removeItem(){throw Error('refusé')}};
  assert.deepEqual(readDeviceProfile(denied,{storeId:'store-1',sellerId:2}),{storeId:'store-1',sellerId:2});
  assert.deepEqual(saveDeviceProfile({storeId:'store-1',sellerId:2},denied),{storeId:'store-1',sellerId:2});
  clearDeviceProfile(denied);
  assert.equal(readDeviceProfile({getItem:()=>'{invalid'}),null);
  assert.equal(saveDeviceProfile({storeId:'../../other',sellerId:1},denied),null);
});
