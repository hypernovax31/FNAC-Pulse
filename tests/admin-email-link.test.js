import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractAdminEmailChangeCode} from '../src/admin-email-link.js';
import {firebaseConfig} from '../src/firebase-config.js';

const code='EXEMPLE-CODE_NON_REEL-1234567890';
const link=(origin=`https://${firebaseConfig.authDomain}`)=>`${origin}/__/auth/action?mode=verifyAndChangeEmail&oobCode=${code}&apiKey=${firebaseConfig.apiKey}&lang=fr`;

test('Lien de changement d’e-mail : seules les origines Firebase du projet et la bonne action sont acceptées',()=>{
  assert.equal(extractAdminEmailChangeCode(link(),firebaseConfig),code);
  assert.equal(extractAdminEmailChangeCode(`  ${link(`https://${firebaseConfig.projectId}.web.app`)}  `,firebaseConfig),code);
  const wrong=[
    link().replace('https:','http:'),
    link('https://attaquant.example'),
    link(`https://${firebaseConfig.authDomain}.attaquant.example`),
    link().replace('verifyAndChangeEmail','recoverEmail'),
    link().replace(firebaseConfig.apiKey,'cle-autre-projet'),
    link().replace('oobCode=', 'oobCode=AAA&oobCode='),
    link().replace('/__/auth/action','/autre'),
    link()+'&tenantId=ailleurs',
    link().replace(code,'code%20avec%20espaces'),
    'x'.repeat(8193),
  ];
  for(const candidate of wrong)assert.throws(()=>extractAdminEmailChangeCode(candidate,firebaseConfig),e=>!e.message.includes(code)&&/lien/.test(e.message));
});
