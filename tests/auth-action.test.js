import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ACTION_PROJECT,parseActionLink,inspectAction,applyAction,describeActionError} from '../public/auth-action-v1.js';
import {firebaseConfig} from '../src/firebase-config.js';

const code='CODE-FICTIF-1234567890',key=ACTION_PROJECT.apiKey;
const app=`https://hypernovax31.github.io/FNAC-Pulse/?mode=resetPassword&oobCode=${code}&apiKey=${key}&lang=fr`;
const old=`https://${ACTION_PROJECT.authDomain}/__/auth/action?mode=resetPassword&oobCode=${code}&apiKey=${key}&lang=fr`;
const response=(body,status=200)=>({ok:status>=200&&status<300,status,async json(){return body;}});

test('Action e-mail : configuration publique synchronisée et liens du projet uniquement',()=>{
  assert.equal(ACTION_PROJECT.apiKey,firebaseConfig.apiKey);
  assert.equal(ACTION_PROJECT.authDomain,firebaseConfig.authDomain);
  assert.equal(ACTION_PROJECT.projectId,firebaseConfig.projectId);
  for(const link of [app,old,old.replace(ACTION_PROJECT.authDomain,`${ACTION_PROJECT.projectId}.web.app`),
    app.replace(`&apiKey=${key}`,''),old.replace(`&apiKey=${key}`,'')]) {
    const parsed=parseActionLink(link);assert.equal(parsed.code,code);assert.equal(parsed.mode,'resetPassword');
  }
  const invalid=[app.replace('https:','http:'),old.replace(ACTION_PROJECT.authDomain,'ailleurs.test'),
    app.replace('hypernovax31.github.io','hypernovax31.github.io.attaquant.test'),app.replace('/FNAC-Pulse/','/autre/'),
    app.replace(key,'clé invalide'),app.replace('mode=','mode=verifyEmail&mode='),app.replace('oobCode=','oobCode=DOUBLE&oobCode='),
    app+'&tenantId=autre',app+'&apiKey=seconde-cle',app.replace(key,''),
    app.replace(code,'code%20incorrect'),'x'.repeat(8193)];
  for(const link of invalid)assert.throws(()=>parseActionLink(link),e=>e.code==='INVALID_LINK'&&!e.message.includes(code));
  // Une ancienne clé peut être présente dans l'e-mail : elle n'est jamais
  // utilisée par le client, qui ne contacte que le projet configuré.
  assert.equal(parseActionLink(app.replace(key,'ancienne-cle-publique')).code,code);
  const continuation=parseActionLink(app+'&continueUrl='+encodeURIComponent('https://attaquant.test/vol'));
  assert.equal(continuation.continueUrl,'');
  assert.equal(parseActionLink(app+'&continueUrl='+encodeURIComponent('https://hypernovax31.github.io/FNAC-Pulse/?suite=1')).continueUrl,'https://hypernovax31.github.io/FNAC-Pulse/?suite=1');
});

test('Action e-mail : vérification et changement vont uniquement à Firebase et nécessitent le bon type',async()=>{
  const calls=[];const mock=async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});return response({email:'invite@example.test',requestType:'PASSWORD_RESET'});};
  const action=parseActionLink(app.replace(`&apiKey=${key}`,'')),proof=await inspectAction(action,{fetchImpl:mock});
  assert.deepEqual(proof,{email:'invite@example.test',previousEmail:''});
  assert.equal(new URL(calls[0].url).origin,'https://identitytoolkit.googleapis.com');
  assert.equal(new URL(calls[0].url).pathname,'/v1/accounts:resetPassword');
  assert.equal(new URL(calls[0].url).searchParams.get('key'),firebaseConfig.apiKey);
  assert.deepEqual(calls[0].body,{oobCode:code});assert.equal(calls[0].opts.credentials,'omit');
  await assert.rejects(inspectAction({...action,mode:'verifyEmail'},{fetchImpl:mock}),e=>e.code==='WRONG_ACTION');
  await assert.rejects(applyAction(action,{password:'trop-court'},{fetchImpl:mock}),e=>e.code==='WEAK_PASSWORD');
  const before=calls.length;await applyAction(action,{password:'Mot-de-passe-fictif-2026!'}, {fetchImpl:mock});
  assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1).body,{oobCode:code,newPassword:'Mot-de-passe-fictif-2026!'});
});

test('Action sans apiKey : code invalide ou expiré contrôlé par Firebase, sans fuite dans les erreurs',async()=>{
  const action=parseActionLink(`https://${ACTION_PROJECT.authDomain}/__/auth/action?mode=resetPassword&oobCode=${code}`);
  for(const error of ['INVALID_OOB_CODE','EXPIRED_OOB_CODE']) {
    let calls=0;
    const mock=async(url,options)=>{
      calls++;assert.equal(new URL(url).searchParams.get('key'),ACTION_PROJECT.apiKey);
      assert.deepEqual(JSON.parse(options.body),{oobCode:code});
      return response({error:{message:error}},400);
    };
    await assert.rejects(inspectAction(action,{fetchImpl:mock}),e=>e.code===error&&!e.message.includes(code));
    assert.equal(calls,1);
  }
});

test('Action e-mail : les autres modèles Firebase sont vérifiés et confirmés explicitement',async()=>{
  const cases=[['verifyEmail','VERIFY_EMAIL',{email:'test@example.test'},'test@example.test',''],
    ['recoverEmail','RECOVER_EMAIL',{email:'ancien@example.test',newEmail:'nouveau@example.test'},'ancien@example.test','nouveau@example.test'],
    ['verifyAndChangeEmail','VERIFY_AND_CHANGE_EMAIL',{email:'ancien@example.test',newEmail:'nouveau@example.test'},'nouveau@example.test','ancien@example.test']];
  for(const [mode,requestType,payload,email,previousEmail] of cases){
    const calls=[];const mock=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return response({...payload,requestType});};
    const action={mode,code};assert.deepEqual(await inspectAction(action,{fetchImpl:mock}),{email,previousEmail});
    assert.equal(calls.length,1,'aucune action avant confirmation');
    await applyAction(action,{}, {fetchImpl:mock});
    assert.equal(calls.length,2);assert.equal(new URL(calls[1].url).pathname,'/v1/accounts:update');assert.deepEqual(calls[1].body,{oobCode:code});
  }
});

test('Action e-mail : lien invalide, délai réseau et écriture incertaine sont explicites sans rejeu',async()=>{
  const action={mode:'resetPassword',code};let calls=0;
  const bad=async()=>{calls++;return response({error:{message:'INVALID_OOB_CODE'}},400);};
  await assert.rejects(inspectAction(action,{fetchImpl:bad}),e=>e.code==='INVALID_OOB_CODE');assert.equal(calls,1);
  assert.match(describeActionError({code:'INVALID_OOB_CODE'}),/expiré ou a déjà été utilisé/);
  await assert.rejects(inspectAction(action,{fetchImpl:()=>new Promise(()=>{}),timeout:25}),e=>e.code==='TIMEOUT');
  let writes=0;const failed=async()=>{writes++;throw new Error('réponse perdue');};
  await assert.rejects(applyAction(action,{password:'Mot-de-passe-fictif-2026!'}, {fetchImpl:failed}),e=>e.code==='NETWORK');
  assert.equal(writes,1);assert.match(describeActionError({code:'NETWORK'},{applying:true}),/n’a pas pu être confirmé/);
  assert.doesNotMatch(describeActionError({code}),/CODE-FICTIF/);
});

test('La page supprime le code de l’historique avant le module et ouvre l’administration après validation',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const match=html.match(/<script>\s*\/\/ Les codes reçus par e-mail[\s\S]*?<\/script>/);assert(match);
  const source=match[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
  const run=href=>{
    const added=[],replaced=[],window={location:{href}},document={documentElement:{dataset:{}},head:{appendChild:x=>added.push(x)},createElement:tag=>({tag})};
    vm.runInNewContext(source,{window,document,URL,history:{replaceState:(...args)=>replaced.push(args)}});
    return {window,document,added,replaced};
  };
  const direct=run(app);assert.equal(direct.window.__fnacEmailActionMode,true);assert.equal(direct.window.__fnacEmailActionLink,app);
  assert.equal(direct.replaced[0][2],'/FNAC-Pulse/');assert(direct.added.some(x=>x.src?.includes('auth-action-v1.js')));
  const helper=run('https://hypernovax31.github.io/FNAC-Pulse/?aide-invitation=1');assert.equal(helper.window.__fnacEmailActionLink,'');
  const login=run('https://hypernovax31.github.io/FNAC-Pulse/?administration=invitation&source=mail');
  assert.equal(login.window.__fnacOpenAdminInvitation,true);assert.equal(login.replaced[0][2],'/FNAC-Pulse/?source=mail');
  assert.match(fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),/if \(!window\.__fnacEmailActionMode\)/);
  const cloud=fs.readFileSync(new URL('../src/cloud.js',import.meta.url),'utf8');
  assert.match(cloud,/emailActionMode\?null:initializeApp\(firebaseConfig\)/);
  assert.match(cloud,/emailActionMode\?null:initializeApp\(firebaseConfig,'fnac-pulse-admin'\)/);
});
