import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const appNames=['initializeApp','deleteApp'];
const authNames=['getAuth','onAuthStateChanged','signInWithCustomToken','signInWithEmailAndPassword','createUserWithEmailAndPassword','deleteUser','signOut','setPersistence','browserSessionPersistence','inMemoryPersistence','EmailAuthProvider','reauthenticateWithCredential','updatePassword','verifyBeforeUpdateEmail','sendEmailVerification','sendPasswordResetEmail','sendSignInLinkToEmail','verifyPasswordResetCode','confirmPasswordReset','checkActionCode','applyActionCode','reload'];
const fireNames=['getFirestore','doc','collection','query','where','onSnapshot'];const messagingNames=['getMessaging','getToken','deleteToken','isSupported'];
const fixtures={
 'firebase/app':`export const initializeApp=(...a)=>globalThis.__inviteFake.initializeApp(...a);export const deleteApp=(...a)=>globalThis.__inviteFake.deleteApp(...a);`,
 'firebase/auth':authNames.map(name=>name==='inMemoryPersistence'||name==='browserSessionPersistence'?`export const ${name}='${name}';`:name==='EmailAuthProvider'?`export const ${name}={credential:()=>({})};`:`export const ${name}=(...a)=>globalThis.__inviteFake.${name}?.(...a);`).join(''),
 'firebase/firestore':fireNames.map(name=>`export const ${name}=(...a)=>globalThis.__inviteFake.${name}?.(...a);`).join(''),
 'firebase/messaging':messagingNames.map(name=>`export const ${name}=(...a)=>globalThis.__inviteFake.${name}?.(...a);`).join(''),
};
const plugin={name:'firebase-fake',setup(b){for(const name of Object.keys(fixtures)){b.onResolve({filter:new RegExp('^'+name.replaceAll('/','\\/')+'$')},()=>({path:name,namespace:'fake'}));}b.onLoad({filter:/.*/,namespace:'fake'},args=>({contents:fixtures[args.path],loader:'js'}));}};
async function cloud(){const output=await build({entryPoints:['src/cloud.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[plugin],logLevel:'silent',define:{'import.meta.env.VITE_BACKEND':'"cloud"','import.meta.env.VITE_WORKER_URL':'"https://worker.test"','import.meta.env.VITE_FIREBASE_VAPID_KEY':'""','import.meta.env.BASE_URL':'"/FNAC-Pulse/"'}});const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);return module.exports;}

test('Nouveaux administrateurs : e-mail de connexion sans création préalable ni changement de session',async()=>{
 const previous={window:globalThis.window,__inviteFake:globalThis.__inviteFake};const events=[];let sendError=null,registered=0;
 globalThis.window={location:{origin:'https://app.test'}};
 globalThis.__inviteFake={
  initializeApp:(_cfg,name)=>{const app={name:name||'default'};events.push(['init',app.name]);return app;},
  deleteApp:async app=>events.push(['delete',app.name]),getAuth:app=>({app}),getFirestore:()=>({}),
  setPersistence:async(auth,persistence)=>events.push(['persistence',auth.app.name,persistence]),
  signOut:async auth=>events.push(['signOut',auth.app.name]),
  createUserWithEmailAndPassword:async()=>{registered++;throw Error('doit rester inutilisé');},
  sendSignInLinkToEmail:async(auth,email,settings)=>{events.push(['send',auth.app.name,email,settings]);if(sendError)throw sendError;},
 };
 try{
  const {inviteAdministrator}=await cloud(),apiCalls=[];const api=async(path,opts)=>{apiCalls.push({path,opts});return {status:'pending',expiresAt:12345};};
  const result=await inviteAdministrator(api,{email:' NOUVEAU@example.test ',requestId:'request-client-001'});
  assert.equal(result.alreadyAccepted,false);assert.equal(registered,0);assert.equal(apiCalls.length,1);
  assert.deepEqual(apiCalls[0].opts.body,{email:'nouveau@example.test',requestId:'request-client-001',showInPanel:true,activation:'email-link-v1'});
  const sent=events.find(e=>e[0]==='send');assert.equal(sent[2],'nouveau@example.test');assert.deepEqual(sent[3],{url:'https://app.test/FNAC-Pulse/?administration=invitation',handleCodeInApp:true});
  assert(sent[1].startsWith('fnac-pulse-invitation-'));assert(events.some(e=>e[0]==='signOut'&&e[1]===sent[1]));
  assert(!events.some(e=>e[0]==='signOut'&&['default','fnac-pulse-admin'].includes(e[1])),'ne déconnecte aucune session actuelle');
  sendError=Object.assign(Error('disabled'),{code:'auth/operation-not-allowed'});
  await assert.rejects(inviteAdministrator(api,{email:'autre@example.test',requestId:'request-client-002'}),e=>/connexion par lien n’est pas activée/.test(e.message));
  const before=events.filter(e=>e[0]==='send').length;await inviteAdministrator(async()=>({status:'accepted'}),{email:'ancien@example.test',requestId:'request-client-003'});assert.equal(events.filter(e=>e[0]==='send').length,before,'pas de second envoi pour un accès déjà accepté');
 }finally{if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;if(previous.__inviteFake===undefined)delete globalThis.__inviteFake;else globalThis.__inviteFake=previous.__inviteFake;}
});

test('Mot de passe oublié : demande Firebase uniquement, réponse discrète et sessions préservées',async()=>{
 const previous={window:globalThis.window,__inviteFake:globalThis.__inviteFake},events=[];let sendError=null;
 globalThis.window={location:{origin:'https://app.test'}};
 globalThis.__inviteFake={
  initializeApp:(_config,name)=>({name:name||'default'}),getAuth:app=>({app}),getFirestore:()=>({}),
  signOut:async auth=>events.push(['signOut',auth.app.name]),
  sendPasswordResetEmail:async(auth,address)=>{events.push(['reset',auth.app.name,auth.languageCode,address]);if(sendError)throw sendError;},
 };
 try {
  const {requestAdminPasswordReset}=await cloud();
  await assert.rejects(requestAdminPasswordReset(''),/adresse e-mail de votre compte administrateur/);
  await assert.rejects(requestAdminPasswordReset('a'.repeat(255)),/adresse e-mail/);
  await requestAdminPasswordReset('  admin@example.test  ');
  assert.deepEqual(events,[['reset','fnac-pulse-admin','fr','admin@example.test']]);
  for(const code of ['auth/user-not-found','auth/user-disabled']){sendError=Object.assign(Error('confidentiel'),{code});await requestAdminPasswordReset('personne@example.test');}
  sendError=Object.assign(Error('mauvais format'),{code:'auth/invalid-email'});await assert.rejects(requestAdminPasswordReset('mauvais'),/adresse e-mail valide/);
  for(const code of ['auth/too-many-requests','auth/quota-exceeded']){sendError=Object.assign(Error('quota'),{code});await assert.rejects(requestAdminPasswordReset('admin@example.test'),/Trop de demandes/);}
  sendError=Object.assign(Error('réponse perdue'),{code:'auth/network-request-failed'});await assert.rejects(requestAdminPasswordReset('admin@example.test'),/pas pu être confirmée.*boîte e-mail avant de réessayer/);
  assert(!events.some(event=>event[0]==='signOut'),'aucune session actuelle n’est déconnectée');
  assert(events.every(event=>event[0]==='reset'),'aucune création, révocation ou modification de compte');
 }finally{if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;if(previous.__inviteFake===undefined)delete globalThis.__inviteFake;else globalThis.__inviteFake=previous.__inviteFake;}
});
