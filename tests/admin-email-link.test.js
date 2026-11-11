import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractAdminEmailChangeCode,extractAdminPasswordResetCode,extractAdminVerificationCode} from '../src/admin-email-link.js';
import {firebaseConfig} from '../src/firebase-config.js';

const code='EXEMPLE-CODE_NON_REEL-1234567890';
const link=(origin=`https://${firebaseConfig.authDomain}`)=>`${origin}/__/auth/action?mode=verifyAndChangeEmail&oobCode=${code}&apiKey=${firebaseConfig.apiKey}&lang=fr`;

test('Lien de changement d’e-mail : seules les origines Firebase du projet et la bonne action sont acceptées',()=>{
  assert.equal(extractAdminEmailChangeCode(link(),firebaseConfig),code);
  assert.equal(extractAdminEmailChangeCode(link().replace(`&apiKey=${firebaseConfig.apiKey}`,''),firebaseConfig),code);
  assert.equal(extractAdminEmailChangeCode(`  ${link(`https://${firebaseConfig.projectId}.web.app`)}  `,firebaseConfig),code);
  assert.equal(extractAdminEmailChangeCode(link('https://hypernovax31.github.io').replace('/__/auth/action','/FNAC-Pulse/'),firebaseConfig),code);
  assert.equal(extractAdminEmailChangeCode(link('https://pulse.ayme.cc').replace('/__/auth/action','/'),firebaseConfig),code);
  const wrong=[
    link().replace('https:','http:'),
    link('https://attaquant.example'),
    link(`https://${firebaseConfig.authDomain}.attaquant.example`),
    link('https://pulse.ayme.cc.attaquant.example').replace('/__/auth/action','/'),
    link('https://pulse.ayme.cc').replace('/__/auth/action','/autre/'),
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

test('Lien de choix du mot de passe : action, projet et paramètres stricts, aucun secret dans les erreurs',()=>{
  const reset=link().replace('verifyAndChangeEmail','resetPassword');
  assert.equal(extractAdminPasswordResetCode(reset,firebaseConfig),code);
  assert.equal(extractAdminPasswordResetCode(reset.replace(`&apiKey=${firebaseConfig.apiKey}`,''),firebaseConfig),code);
  const appLink=reset.replace(`https://${firebaseConfig.authDomain}/__/auth/action`,'https://hypernovax31.github.io/FNAC-Pulse/');
  assert.equal(extractAdminPasswordResetCode(appLink,firebaseConfig),code);
  assert.equal(extractAdminPasswordResetCode(appLink.replace(`&apiKey=${firebaseConfig.apiKey}`,''),firebaseConfig),code);
  assert.throws(()=>extractAdminPasswordResetCode(appLink.replace('/FNAC-Pulse/','/autre/'),firebaseConfig));
  const customLink=reset.replace(`https://${firebaseConfig.authDomain}/__/auth/action`,'https://pulse.ayme.cc/');
  assert.equal(extractAdminPasswordResetCode(customLink,firebaseConfig),code);
  assert.throws(()=>extractAdminPasswordResetCode(customLink.replace('pulse.ayme.cc/','pulse.ayme.cc/api/'),firebaseConfig));
  const wrong=[link(),reset.replace('https:','http:'),reset.replace(firebaseConfig.authDomain,'ailleurs.test'),
    reset.replace(firebaseConfig.apiKey,'autre-cle'),reset.replace(firebaseConfig.apiKey,''),
    reset.replace('mode=','mode=verifyEmail&mode='),reset.replace('oobCode=','oobCode=DOUBLE&oobCode='),
    reset.replace('/__/auth/action','/ailleurs'),reset+'&tenantId=autre',reset+'&apiKey=seconde-cle',reset.replace(code,'code%20non%20valide')];
  for(const candidate of wrong)assert.throws(()=>extractAdminPasswordResetCode(candidate,firebaseConfig),e=>!e.message.includes(code));
});

test('Lien de vérification : seuls le projet et l’action attendue sont acceptés',()=>{
  const verification=link().replace('verifyAndChangeEmail','verifyEmail');
  assert.equal(extractAdminVerificationCode(verification,firebaseConfig),code);
  assert.equal(extractAdminVerificationCode(verification.replace(`&apiKey=${firebaseConfig.apiKey}`,''),firebaseConfig),code);
  for(const candidate of [link(),verification.replace('verifyEmail','resetPassword'),verification.replace(firebaseConfig.authDomain,'autre.test'),verification+'&tenantId=autre'])
    assert.throws(()=>extractAdminVerificationCode(candidate,firebaseConfig),e=>!e.message.includes(code));
});
