// Test d'intégration local avec le véritable runtime workerd de Cloudflare.
// Il n'utilise que des comptes/jetons fictifs : toutes les requêtes sortantes
// sont interceptées par une fonction Node et aucune ne touche Firebase.
// Exécuter avec Node >=22 et FNAC_MINIFLARE_PATH pointant vers le paquet
// miniflare de Wrangler (voir GUIDE_DEPLOIEMENT.md).
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const miniflare=process.env.FNAC_MINIFLARE_PATH;
if(!miniflare)throw new Error('Définir FNAC_MINIFLARE_PATH vers le paquet miniflare local.');
const {Miniflare}=await import(pathToFileURL(path.join(miniflare,'dist/src/index.js')).href);
const wrapper=`
import {lookupFirebaseAccount} from './worker/firebase.js';
const env={FIREBASE_PROJECT_ID:'fnac-pulse',APP_URL:'https://example.test/FNAC-Pulse/'};
export default {
  async fetch(request) {
    const part=new URL(request.url).pathname;
    if(part==='/runtime') {
      let unsupported=false;
      try {new Request('https://identitytoolkit.googleapis.com/',{redirect:'error'});}catch(e){unsupported=e instanceof TypeError;}
      let manual=false;
      try {manual=new Request('https://identitytoolkit.googleapis.com/',{redirect:'manual'}).redirect==='manual';}catch{}
      return Response.json({unsupported,manual});
    }
    const fixture=part.slice(1);
    try {
      const result=await lookupFirebaseAccount(env,'fake-'+fixture);
      return Response.json({ok:true,result});
    } catch(error) {
      const unsupported=error instanceof TypeError&&/redirect/i.test(error.message||'');
      return Response.json({ok:false,kind:unsupported?'unsupported-redirect':'refused'});
    }
  }
};`;
const bundled=await build({stdin:{contents:wrapper,resolveDir:process.cwd(),sourcefile:'workerd-activation-probe.js'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
let calls=0,redirectTargetCalls=0;
const fakeReferer='https://example.test/FNAC-Pulse/';
const runtime=new Miniflare({
  modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2025-09-19',
  outboundService:async request=>{
    calls++;
    const url=new URL(request.url);
    if(url.hostname==='redirect-target.invalid'){redirectTargetCalls++;return new Response('ne doit pas être appelé');}
    assert.equal(url.origin,'https://identitytoolkit.googleapis.com');
    assert.equal(url.pathname,'/v1/accounts:lookup');
    assert.equal(request.method,'POST');assert.equal(request.headers.get('referer'),fakeReferer);
    const {idToken}=await request.json();
    if(idToken==='fake-ok')return Response.json({users:[{localId:'uid-fictif',email:'fictif@example.test',disabled:false,createdAt:'1793000000000',passwordUpdatedAt:1793000000001,passwordHash:'non-retourné'}]});
    const match=/^fake-redirect-(301|302|303|304|307|308)$/.exec(idToken);
    if(match)return new Response(null,{status:Number(match[1]),headers:{location:'https://redirect-target.invalid/ne-pas-suivre'}});
    return Response.json({error:{message:'fictif'}},{status:400});
  },
});
try {
  const ask=async part=>await (await runtime.dispatchFetch('https://test.invalid/'+part)).json();
  const capabilities=await ask('runtime');
  assert.deepEqual(capabilities,{unsupported:true,manual:true});
  console.log('workerd : mode error refusé, mode manual accepté.');
  const success=await ask('ok');
  assert.deepEqual(success,{ok:true,result:{localId:'uid-fictif',email:'fictif@example.test',disabled:false,createdAt:1793000000000,passwordUpdatedAt:1793000000001}},'La lecture Firebase fictive doit fonctionner dans workerd.');
  assert.equal(calls,1,'Une seule requête fictive pour la lecture réussie.');
  for(const status of [301,302,303,304,307,308]) {
    const before=calls,result=await ask(`redirect-${status}`);
    assert.deepEqual(result,{ok:false,kind:'refused'},`Une redirection ${status} doit être rejetée.`);
    assert.equal(calls,before+1,'La redirection ne doit pas provoquer une seconde requête.');
  }
  assert.equal(redirectTargetCalls,0,'Aucun jeton ne doit partir vers la cible de redirection.');
  console.log('Lecture fictive réussie ; six redirections refusées sans transmission à une autre adresse.');
} finally {await runtime.dispose();}
