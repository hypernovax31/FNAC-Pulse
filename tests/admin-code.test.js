import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ADMIN_CODE_ALPHABET, ADMIN_CODE_LENGTH, createAdminCode, derivedAdminCodePassword, formatAdminCode, normalizeAdminCode} from '../src/admin-code.js';

test('Codes administrateur : secrets aléatoires 80 bits et format tolérant sans ambiguïté',()=>{
  assert.equal(ADMIN_CODE_ALPHABET.length,32);assert.equal(ADMIN_CODE_LENGTH,16);
  const generated=Array.from({length:256},createAdminCode);
  assert.equal(new Set(generated).size,generated.length);
  for(const code of generated){assert.equal(normalizeAdminCode(code),code);assert.match(formatAdminCode(code),/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);}
  const code=generated[0],formatted=formatAdminCode(code);
  assert.equal(normalizeAdminCode(`  ${formatted.toLowerCase()} \n`),code);
  assert.equal(normalizeAdminCode('A'.repeat(15)+'0'),'');assert.equal(normalizeAdminCode('A'.repeat(15)+'O'),'');
  assert.equal(normalizeAdminCode('A'.repeat(15)), '');assert.equal(normalizeAdminCode('A'.repeat(81)),'');
});

test('Clé Firebase provisoire : ne dépend pas du seul mot de passe court',async()=>{
  const input={code:'ABCD-EFGH-JKLM-NPQR',email:'  Personne@Example.test  ',password:'abc123'};
  const password=await derivedAdminCodePassword(input);
  assert.equal(password.length,47);assert.match(password,/^aA0!/);assert(!password.includes('abc123'));
  assert.equal(await derivedAdminCodePassword({...input,code:'abcd efgh jklm npqr',email:'personne@example.test'}),password);
  assert.notEqual(await derivedAdminCodePassword({...input,code:'ABCD-EFGH-JKLM-NPQT'}),password);
  assert.notEqual(await derivedAdminCodePassword({...input,email:'autre@example.test'}),password);
  assert.notEqual(await derivedAdminCodePassword({...input,password:'abc124'}),password);
  assert.equal((await derivedAdminCodePassword({...input,password:'x'})).length,47);
  assert.equal((await derivedAdminCodePassword({...input,password:'😀😀😀😀😀😀'})).length,47);
  await assert.rejects(derivedAdminCodePassword({...input,password:''}));
  await assert.rejects(derivedAdminCodePassword({...input,password:'1234567'}));
  await assert.rejects(derivedAdminCodePassword({...input,password:'😀😀😀😀😀😀😀'}));
  await assert.rejects(derivedAdminCodePassword({...input,code:'incorrect'}));
});
