import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8,jwtVerify} from 'jose';
import {makeCustomToken,googleAccessToken,verifyIdToken,pinMac,verifyPin} from '../worker/firebase.js';
import {sendFcm} from '../worker/index.js';

test('Firebase : signature des jetons, OAuth, PIN et requête FCM',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
  const account={project_id:'demo-pulse-crypto',client_email:'test-service@example.test',private_key:await exportPKCS8(privateKey)};
  const env={FIREBASE_PROJECT_ID:account.project_id,GOOGLE_SERVICE_ACCOUNT:JSON.stringify(account),
    PIN_PEPPER:Buffer.alloc(32,19).toString('base64url'),APP_URL:'https://example.test/FNAC-Pulse/'};
  const claims={role:'seller',storeId:'demo-store',sellerId:1,sellerKey:'s1',accessVersion:'version-a'};
  const custom=await makeCustomToken(env,'seller-123',claims);
  const payload=(await jwtVerify(custom,publicKey,{issuer:account.client_email,subject:account.client_email,
    audience:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',algorithms:['RS256']})).payload;
  assert.equal(payload.uid,'seller-123');assert.deepEqual(payload.claims,claims);
  await assert.rejects(verifyIdToken(env,'not-a-valid-jwt'));
  const mac=await pinMac(env,'seller-123','proof');assert(await verifyPin(env,'seller-123','proof',mac));
  assert.equal(await verifyPin(env,'seller-123','other-proof',mac),false);

  const original=globalThis.fetch;let oauthCalls=0,fcmCalls=0,failFcm=false;
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://oauth2.googleapis.com/token'){
      oauthCalls++;
      const parameters=options.body;
      assert.equal(parameters.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion=parameters.get('assertion');
      const signed=(await jwtVerify(assertion,publicKey,{issuer:account.client_email,subject:account.client_email,audience:'https://oauth2.googleapis.com/token'})).payload;
      assert.equal(signed.scope,'https://www.googleapis.com/auth/cloud-platform');
      return Response.json({access_token:'fake-access-token',expires_in:3600});
    }
    assert.equal(String(url),'https://fcm.googleapis.com/v1/projects/demo-pulse-crypto/messages:send');
    assert.equal(options.headers.Authorization,'Bearer fake-access-token');
    const body=JSON.parse(options.body);assert.equal(body.message.token,'fake-fcm-registration-token');
    assert.equal(body.message.notification.body,'Morgan vient de vendre DMax.');
    assert.equal(body.message.webpush.fcm_options.link,'https://example.test/FNAC-Pulse/');
    assert.equal(body.message.webpush.headers.TTL,'3600');
    fcmCalls++;return failFcm?Response.json({error:{details:[{errorCode:'UNREGISTERED'}]}},{status:404}):Response.json({name:'mock-delivery'});
  };
  try {
    assert.equal(await googleAccessToken(env),'fake-access-token');assert.equal(await googleAccessToken(env),'fake-access-token');
    const sale={sellerName:'Morgan',serviceName:'DMax',saleId:'fake-sale',storeId:'demo-store'};
    await sendFcm(env,'fake-fcm-registration-token',sale);
    failFcm=true;await assert.rejects(sendFcm(env,'fake-fcm-registration-token',sale),e=>e.unregistered===true);
    assert.equal(oauthCalls,1);assert.equal(fcmCalls,2);
  } finally {globalThis.fetch=original;}
});
