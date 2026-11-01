import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {createPinSalt,pinProof} from '../src/pin.js';
import {cleanSellerName,validSellerName,sameSellerName} from '../src/seller-registration.js';

test('PIN : compatibilité du dérivé historique et sel aléatoire pour un nouveau profil',async()=>{
  const project='demo-fnac',store='magasin-test',seller=7,legacy='46198372';
  const expected=pbkdf2Sync(legacy,`fnac-pulse-pin-v1|${project}|${store}|${seller}`,210000,32,'sha256').toString('base64url');
  assert.equal(await pinProof(project,store,seller,legacy),expected);
  const salt=createPinSalt(),otherSalt=createPinSalt();assert.match(salt,/^[A-Za-z0-9_-]{16,80}$/);assert.notEqual(salt,otherSalt);
  const proof=await pinProof(project,store,null,'0934',salt),expectedV2=pbkdf2Sync('0934',`fnac-pulse-pin-v2|${project}|${store}|${salt}`,210000,32,'sha256').toString('base64url');
  assert.equal(proof,expectedV2);assert.equal(await pinProof(project,store,seller,'0934',salt),proof);
  assert.notEqual(await pinProof(project,store,seller,'0934',otherSalt),proof);
  assert.notEqual(await pinProof(project,store,seller,'0934'),proof);
  await assert.rejects(pinProof(project,store,seller,'123'),/4 ou 8 chiffres/);
  await assert.rejects(pinProof(project,store,null,'1234'),/Profil vendeur/);
  await assert.rejects(pinProof(project,store,null,'1234','short'),/profil invalides/);
});

test('Prénoms : espaces, accents et casse sans doublon ; saisie vide ou invalide refusée',()=>{
  assert.equal(cleanSellerName('  E\u0301lodie   Marie  '),'Élodie Marie');
  assert(sameSellerName('Élodie Marie',' elodie   marie '));assert(sameSellerName('Zoé','ZOE'));
  assert(!sameSellerName('Zoé','Zoé B'));assert(validSellerName("Anne-Marie D’Azur"));assert(validSellerName('محمد'));
  assert(!validSellerName(''));assert(!validSellerName('1234'));assert(!validSellerName('Jean@exemple'));
});
