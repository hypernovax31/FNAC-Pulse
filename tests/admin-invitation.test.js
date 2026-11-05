import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInvitationPassword, invitationAddress, invitationMessage} from '../src/admin-invitation.js';

test('Invitation : mot de passe aléatoire fort, sans générateur non sécurisé',()=>{
  assert.throws(()=>createInvitationPassword({}),/Générateur sécurisé/);
  let length=0;
  const predictable={getRandomValues(bytes){length=bytes.length;bytes.fill(42);return bytes;}};
  const password=createInvitationPassword(predictable);
  assert.equal(length,18);assert.match(password,/^[A-Za-z0-9_-]{24}aA1!$/);
  const generated=new Set(Array.from({length:128},()=>createInvitationPassword()));
  assert.equal(generated.size,128);
});

test('Invitation : une seule adresse, encodée sans injecter de destinataire ni d’en-tête',()=>{
  assert.equal(invitationAddress('  Test+Fnac@Example.test '),'test+fnac@example.test');
  for(const address of ['', 'a', 'a@example.test,b@example.test', 'a@example.test;b@example.test',
    'a@example.test\r\nBcc:b@example.test','a@example.test?body=hello\nb@example.test',`a@${'b'.repeat(255)}.test`])
    assert.throws(()=>invitationAddress(address),/adresse e-mail valide/);
  const mail=invitationMessage({email:'Test+Fnac@Example.test',password:'Mot-de-passe-temporaire-123!',appUrl:'https://example.test/FNAC-Pulse/?secret=absent#ancre'});
  const url=new URL(mail.href);
  assert.equal(url.protocol,'mailto:');assert.equal(decodeURIComponent(url.pathname),'test+fnac@example.test');
  assert.equal(url.searchParams.get('subject'),'Bienvenue sur Fnac Pulse');
  assert.equal(url.searchParams.get('body'),mail.body);
  assert.match(mail.body,/application des services.*vendeurs.*objectifs personnels/);
  assert.match(mail.body,/Mot de passe provisoire : Mot-de-passe-temporaire-123!/);
  assert.match(mail.body,/https:\/\/example\.test\/FNAC-Pulse\//);
  assert.doesNotMatch(mail.body,/secret=absent|#ancre/);
  assert.match(mail.body,/votre mot de passe personnel dès votre première connexion/);
  assert.match(mail.href,/%0D%0A/,'les sauts de ligne sont encodés pour la messagerie');
});

test('Invitation : URL et mot de passe invalides refusés avant ouverture de la messagerie',()=>{
  const values={email:'test@example.test',password:'Mot-de-passe-temporaire-123!',appUrl:'https://example.test/'};
  for(const appUrl of ['javascript:alert(1)','http://example.test/','not a url','file:///etc/passwd'])
    assert.throws(()=>invitationMessage({...values,appUrl}),/Adresse de l’application/);
  assert.throws(()=>invitationMessage({...values,password:'court'}),/Mot de passe provisoire invalide/);
  assert.throws(()=>invitationMessage({...values,password:'Mot-de-passe\nBcc:evil@example.test'}),/Mot de passe provisoire invalide/);
  assert.match(invitationMessage({...values,appUrl:'http://localhost:3000/'}).href,/^mailto:/);
});
