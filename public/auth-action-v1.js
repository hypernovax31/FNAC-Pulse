// Gestion indépendante des liens Firebase. Aucun code ou mot de passe n'est
// enregistré, journalisé ou envoyé au Worker : seuls les appels Firebase Auth
// reçoivent ces informations. Les paramètres de lien sont effacés de l'URL
// par index.html avant le chargement de ce module.
export const ACTION_PROJECT = Object.freeze({
  apiKey: 'AIzaSyDizq7PirehdrX_FOzdCL8h2N5e9b7RXfw',
  authDomain: 'fnac-pulse.firebaseapp.com',
  projectId: 'fnac-pulse',
});
const OPERATIONS = Object.freeze({
  resetPassword: 'PASSWORD_RESET',
  verifyEmail: 'VERIFY_EMAIL',
  verifyAndChangeEmail: 'VERIFY_AND_CHANGE_EMAIL',
  recoverEmail: 'RECOVER_EMAIL',
});
const CODE = /^[^\s\u0000-\u001f\u007f]{6,2048}$/;
const DEFAULT_APP = 'https://hypernovax31.github.io/FNAC-Pulse/';

function actionError(code) { return Object.assign(new Error('Action Firebase impossible'), {code}); }

// Le lien est soit notre page, soit le gestionnaire Firebase de ce projet.
// La clé du lien peut être ancienne : le code est toujours vérifié avec la
// clé connue du projet, et jamais avec un service défini par le lien.
export function parseActionLink(input, {appUrl=DEFAULT_APP, project=ACTION_PROJECT}={}) {
  // Un lien Hosting peut envelopper le lien d'action dans « link ». On ne
  // suit jamais un domaine tiers et on limite strictement l'imbrication.
  function parse(input,depth) {
    if(typeof input!=='string'||input.length>8192||depth>2)throw actionError('INVALID_LINK');
    let url,app;
    try {url=new URL(input.trim());app=new URL(appUrl);} catch {throw actionError('INVALID_LINK');}
    if(url.username||url.password)throw actionError('INVALID_LINK');
    const appLink=url.origin===app.origin&&url.pathname===app.pathname;
    const firebaseHost=url.protocol==='https:'&&!url.port&&
      [project.authDomain,`${project.projectId}.web.app`].includes(url.hostname);
    const firebaseLink=firebaseHost&&url.pathname==='/__/auth/action';
    const firebaseWrapper=firebaseHost&&url.pathname==='/__/auth/links';
    const links=url.searchParams.getAll('link');
    if(links.length) {
      if((!appLink&&!firebaseWrapper)||links.length!==1||url.searchParams.has('oobCode')||
        url.searchParams.has('mode')||url.searchParams.has('tenantId'))throw actionError('INVALID_LINK');
      return parse(links[0],depth+1);
    }
    if(!appLink&&!firebaseLink)throw actionError('INVALID_LINK');
    const one=name=>url.searchParams.getAll(name).length===1?url.searchParams.get(name):null;
    const mode=one('mode'),code=one('oobCode'),keys=url.searchParams.getAll('apiKey');
    // apiKey est facultative dans certains e-mails. Elle ne sert jamais à
    // choisir le projet : firebasePost utilise toujours la configuration fixe.
    if(!mode||!/^[A-Za-z]{3,64}$/.test(mode)||!code||!CODE.test(code)||keys.length>1||
      (keys.length===1&&!/^[A-Za-z0-9_-]{6,256}$/.test(keys[0]))||url.searchParams.has('tenantId'))throw actionError('INVALID_LINK');
    // Ne jamais suivre une redirection continueUrl arbitraire. Si une action
    // non gérée doit retourner au gestionnaire Firebase, conserver seulement
    // une continuation située dans l'application elle-même.
    let continueUrl='';
    if(url.searchParams.getAll('continueUrl').length===1)try {
      const next=new URL(url.searchParams.get('continueUrl'));
      if(next.protocol==='https:'&&next.origin===app.origin&&next.pathname.startsWith(app.pathname)&&!next.username&&!next.password)continueUrl=next.href;
    } catch {}
    const lang=one('lang');
    return {mode,code,continueUrl,lang:lang&&/^[A-Za-z-]{2,12}$/.test(lang)?lang:'fr'};
  }
  return parse(input,0);
}

async function firebasePost(operation,body,{fetchImpl=globalThis.fetch,timeout=12000,project=ACTION_PROJECT}={}) {
  if(typeof fetchImpl!=='function')throw actionError('NETWORK');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(actionError('TIMEOUT'));},timeout);});
  const request=(async()=>{
    let response,data;
    try {
      response=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(project.apiKey)}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
        credentials:'omit',cache:'no-store',referrerPolicy:'origin',signal:controller.signal,
      });
      data=await response.json();
    } catch(error) {
      if(error?.code==='TIMEOUT')throw error;
      throw actionError('NETWORK');
    }
    if(!response.ok){
      const detail=typeof data?.error?.message==='string'?data.error.message.split(' :')[0]:'';
      throw actionError(detail||'FIREBASE_ERROR');
    }
    return data;
  })();
  try {return await Promise.race([request,deadline]);} finally {clearTimeout(timer);}
}

export async function inspectAction(action,options={}) {
  const expected=OPERATIONS[action?.mode];
  if(!expected)throw actionError('UNSUPPORTED_ACTION');
  if(!CODE.test(action?.code||''))throw actionError('INVALID_LINK');
  const result=await firebasePost('resetPassword',{oobCode:action.code},options);
  if(result.requestType!==expected)throw actionError('WRONG_ACTION');
  const email=expected==='VERIFY_AND_CHANGE_EMAIL'?result.newEmail:result.email;
  const previousEmail=expected==='VERIFY_AND_CHANGE_EMAIL'?result.email:result.newEmail;
  if(typeof email!=='string'||!email||email.length>254)throw actionError('INVALID_RESPONSE');
  return {email,previousEmail:typeof previousEmail==='string'?previousEmail:''};
}

// L'interface exige une confirmation explicite après inspection. Les échecs
// d'écriture ne sont jamais rejoués automatiquement : une réponse perdue peut
// masquer une action réussie.
export async function applyAction(action,{password}={},options={}) {
  if(!CODE.test(action?.code||'')||!OPERATIONS[action?.mode])throw actionError('INVALID_LINK');
  if(action.mode==='resetPassword') {
    if(typeof password!=='string'||password.length<12||password.length>128)throw actionError('WEAK_PASSWORD');
    return firebasePost('resetPassword',{oobCode:action.code,newPassword:password},options);
  }
  return firebasePost('update',{oobCode:action.code},options);
}

// La page d’activation utilise Firebase directement et conserve les jetons
// uniquement en mémoire. Le Worker ne reçoit ni mot de passe ni code de lien.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export async function signInActivation(action,email,options={}) {
  const address=typeof email==='string'?email.trim().toLowerCase():'';
  if(action?.mode!=='signIn'||!CODE.test(action.code||'')||address.length>254||!EMAIL.test(address))throw actionError('INVALID_LINK');
  const result=await firebasePost('signInWithEmailLink',{email:address,oobCode:action.code},options);
  if(typeof result.idToken!=='string'||typeof result.localId!=='string'||String(result.email||'').toLowerCase()!==address)throw actionError('INVALID_RESPONSE');
  return {email:address,localId:result.localId,idToken:result.idToken,isNewUser:result.isNewUser===true};
}
export async function createActivationPassword(idToken,password,options={}) {
  if(typeof idToken!=='string'||!idToken||typeof password!=='string'||password.length<12||password.length>128)throw actionError('WEAK_PASSWORD');
  const result=await firebasePost('update',{idToken,password,returnSecureToken:true},options);
  if(typeof result.localId!=='string'||typeof result.idToken!=='string')throw actionError('INVALID_RESPONSE');
  return {localId:result.localId,idToken:result.idToken};
}
export async function confirmActivationPassword(email,password,options={}) {
  const address=typeof email==='string'?email.trim().toLowerCase():'';
  if(!EMAIL.test(address)||address.length>254||typeof password!=='string'||!password)throw actionError('INVALID_PASSWORD');
  const result=await firebasePost('signInWithPassword',{email:address,password,returnSecureToken:true},options);
  if(typeof result.idToken!=='string'||typeof result.localId!=='string'||String(result.email||'').toLowerCase()!==address)throw actionError('INVALID_RESPONSE');
  return {email:address,localId:result.localId,idToken:result.idToken};
}
export async function acceptActivation(idToken,workerUrl,{fetchImpl=globalThis.fetch,timeout=12000}={}) {
  let endpoint;try {endpoint=new URL(workerUrl);}catch{throw actionError('WORKER_CONFIG');}
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
    !['','/'].includes(endpoint.pathname)||typeof idToken!=='string'||!idToken)throw actionError('WORKER_CONFIG');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(actionError('TIMEOUT'));},timeout);});
  const request=(async()=>{
    let response;
    try {response=await fetchImpl(new URL('/api/auth/admin-invitations/accept',endpoint).href,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${idToken}`},body:JSON.stringify({confirmed:true}),
      credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'origin',signal:controller.signal,
    });}catch{throw actionError('NETWORK');}
    if(!response.ok)throw actionError(response.status===403?'INVITATION_INACTIVE':response.status===401?'AUTH_EXPIRED':'WORKER_UNAVAILABLE');
    let result;try{result=await response.json();}catch{throw actionError('WORKER_UNAVAILABLE');}
    if(result?.ok!==true)throw actionError('WORKER_UNAVAILABLE');
    return {ok:true};
  })();
  try{return await Promise.race([request,deadline]);}finally{clearTimeout(timer);}
}

export function describeActionError(error,{applying=false}={}) {
  switch(error?.code) {
    case 'INVALID_LINK':case 'WRONG_ACTION':case 'INVALID_RESPONSE':
      return 'Ce lien ne correspond pas à une action Fnac Pulse valide. Ouvrez le dernier e-mail reçu ou demandez un nouveau lien.';
    case 'UNSUPPORTED_ACTION':
      return 'Ce type de lien s’ouvre sur la page sécurisée de Firebase.';
    case 'INVALID_OOB_CODE':case 'EXPIRED_OOB_CODE':
      return 'Ce lien a expiré ou a déjà été utilisé. Si vous venez de valider, essayez de vous connecter ; sinon, demandez un nouveau lien.';
    case 'USER_DISABLED':case 'USER_NOT_FOUND':
      return 'Ce compte n’est pas disponible. Contactez l’administrateur qui vous a invité.';
    case 'INVALID_EMAIL':
      return 'Vérifiez l’adresse e-mail saisie et utilisez celle qui a reçu l’invitation.';
    case 'INVALID_PASSWORD':case 'INVALID_LOGIN_CREDENTIALS':case 'EMAIL_NOT_FOUND':
      return 'Adresse e-mail ou mot de passe incorrect. Réessayez.';
    case 'INVITATION_INACTIVE':
      return 'Cette invitation n’est plus active ou ne peut pas être confirmée. Aucun nouvel accès n’a été accordé. Contactez votre administrateur.';
    case 'AUTH_EXPIRED':
      return 'La connexion a expiré. Reconnectez-vous avec votre adresse et votre mot de passe.';
    case 'WORKER_CONFIG':case 'WORKER_UNAVAILABLE':
      return 'L’activation n’a pas pu être confirmée. Réessayez ou connectez-vous avec votre adresse et votre mot de passe.';
    case 'EMAIL_EXISTS':
      return 'Cette adresse est déjà utilisée. Demandez une nouvelle modification au responsable.';
    case 'WEAK_PASSWORD':
      return 'Choisissez un mot de passe plus robuste, de 12 à 128 caractères.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':case 'TOO_MANY_REQUESTS':
      return 'Trop de tentatives. Patientez avant de réessayer.';
    default:
      return applying?'L’enregistrement n’a pas pu être confirmé. Essayez de vous connecter avant de demander un autre lien.':'Impossible de vérifier le lien. Vérifiez votre connexion puis réessayez.';
  }
}

function element(doc,tag,attributes={},text) {
  const node=doc.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(key==='className')node.className=value;
    else if(key==='htmlFor')node.htmlFor=value;
    else if(key==='readOnly')node.readOnly=value;
    else if(key==='required')node.required=value;
    else node.setAttribute(key,value);
  }
  if(text!==undefined)node.textContent=text;
  return node;
}
function labelInput(doc,label,id,attributes={}) {
  const wrapper=element(doc,'label',{htmlFor:id},label),input=element(doc,'input',{id,...attributes});
  wrapper.append(input);return {wrapper,input};
}

export function mountEmailAction({win=window,doc=document,fetchImpl=globalThis.fetch,timeout=12000}={}) {
  const title=doc.getElementById('email-action-title'),lead=doc.getElementById('email-action-lead'),content=doc.getElementById('email-action-content');
  if(!title||!lead||!content)return;
  const incoming=win.__fnacEmailActionLink||'';delete win.__fnacEmailActionLink;
  win.__fnacEmailActionReady=true;
  const appUrl=new URL(win.location.pathname,win.location.origin).href;
  const loginUrl=new URL('?administration=invitation',appUrl).href;
  let action=null,proof=null,busy=false,activationToken='';
  const view=(heading,description)=>{title.textContent=heading;lead.textContent=description;content.replaceChildren();};
  const message=(text)=>element(doc,'p',{className:'email-action-message',role:'alert'},text);
  const button=(text,secondary=false)=>element(doc,'button',{type:'button',...(secondary?{className:'email-action-secondary'}:{})},text);
  const loginButton=()=>element(doc,'a',{href:loginUrl,className:'email-action-button'},'Ouvrir l’administration');
  const safeOptions={fetchImpl,timeout};

  function showHelper(errorText='') {
    action=null;proof=null;activationToken='';
    view('Votre lien ne s’ouvre pas ?', 'Dans votre messagerie, maintenez le doigt sur le lien reçu, choisissez « Copier », puis collez-le ci-dessous.');
    const form=element(doc,'form'),link=labelInput(doc,'Lien reçu par e-mail','email-action-link',{
      type:'url',inputmode:'url',autocomplete:'off',autocapitalize:'none',spellcheck:'false',maxlength:'8192',required:true,
    });
    const submit=element(doc,'button',{type:'submit'},'Continuer');
    form.append(link.wrapper,submit);if(errorText)form.append(message(errorText));
    form.addEventListener('submit',event=>{
      event.preventDefault();if(busy)return;
      const raw=link.input.value;link.input.value='';
      try {action=parseActionLink(raw,{appUrl});} catch(error) {showHelper(describeActionError(error));return;}
      verify();
    });
    const note=element(doc,'p',{},'Le lien reste sur cet appareil et sert uniquement à vérifier votre demande auprès de Firebase. Ne le transmettez à personne.');
    content.append(form,note);
  }

  function showError(error,{applying=false}={}) {
    view('Nous n’avons pas pu continuer',describeActionError(error,{applying}));
    const transient=['NETWORK','TIMEOUT','FIREBASE_ERROR'].includes(error?.code);
    if(!applying&&transient&&action){const retry=button('Réessayer');retry.addEventListener('click',verify);content.append(retry);}
    if(!applying&&error?.code==='UNSUPPORTED_ACTION'&&action){
      const fallback=new URL(`https://${ACTION_PROJECT.authDomain}/__/auth/action`);
      fallback.searchParams.set('mode',action.mode);fallback.searchParams.set('oobCode',action.code);fallback.searchParams.set('apiKey',ACTION_PROJECT.apiKey);fallback.searchParams.set('lang',action.lang);
      if(action.continueUrl)fallback.searchParams.set('continueUrl',action.continueUrl);
      const link=element(doc,'a',{href:fallback.href,className:'email-action-button',rel:'noreferrer'},'Ouvrir la page sécurisée Firebase');content.append(link);
    }
    if(!applying){
      const another=button('Utiliser un autre lien',true);
      another.addEventListener('click',()=>showHelper());
      content.append(another);
    }
    const help=element(doc,'p',{},'Pour obtenir un nouveau lien, contactez votre administrateur ou utilisez « Mot de passe oublié ou lien bloqué ? » dans l’écran de connexion administrateur.');
    content.append(help,loginButton());
  }

  function showSuccess() {
    const isReset=action.mode==='resetPassword',mode=action.mode,email=proof.email;
    if(isReset) {
      view('Mot de passe enregistré', 'Vous pouvez maintenant vous connecter à Fnac Pulse.');
      const steps=element(doc,'p',{},'Dans l’administration, connectez-vous avec votre e-mail et votre nouveau mot de passe.');
      const shared=element(doc,'p',{},'Si un autre administrateur est déjà connecté sur cet appareil, utilisez votre propre appareil ou une fenêtre privée pour préserver sa session.');
      content.append(steps,shared,loginButton());
    } else {
      const heading=mode==='recoverEmail'?'Adresse rétablie':mode==='verifyAndChangeEmail'?'Nouvelle adresse confirmée':'Adresse confirmée';
      view(heading,mode==='recoverEmail'?`L’adresse ${email} a bien été rétablie.`:`L’adresse ${email} a bien été confirmée.`);
      if(mode==='recoverEmail')content.append(element(doc,'p',{},'Si vous n’êtes pas à l’origine de cette modification, changez également votre mot de passe.'));
      content.append(loginButton());
    }
    action=null;proof=null;
  }

  function showConfirmation() {
    const reset=action.mode==='resetPassword';
    const headings={verifyEmail:'Confirmez votre adresse',verifyAndChangeEmail:'Confirmez votre nouvelle adresse',recoverEmail:'Rétablissez votre adresse'};
    view(reset?'Choisissez votre mot de passe':headings[action.mode],reset?'Créez un mot de passe pour ce compte. Il restera personnel.':'Vérifiez l’adresse avant de confirmer cette demande.');
    const form=element(doc,'form');
    const account=element(doc,'div',{className:'email-action-account'});
    account.append(element(doc,'span',{},reset?'Compte concerné':'Adresse concernée'));
    account.append(element(doc,'strong',{},proof.email));
    // Identifiant non visible pour les gestionnaires de mots de passe ;
    // l'adresse affichée au-dessus reste entièrement lisible sur mobile.
    const username=element(doc,'input',{type:'email',name:'username',autocomplete:'username',className:'email-action-username',tabindex:'-1','aria-hidden':'true',readOnly:true});
    username.value=proof.email;account.append(username);form.append(account);
    if(reset)form.append(element(doc,'p',{},'Si vous avez été invité à l’administration, votre connexion donnera accès à tous les magasins.'));
    if(proof.previousEmail&&(action.mode==='verifyAndChangeEmail'||action.mode==='recoverEmail')) {
      const previous=element(doc,'p',{},`Adresse actuelle : ${proof.previousEmail}`);form.append(previous);
    }
    let password,confirmation;
    if(reset) {
      password=labelInput(doc,'Nouveau mot de passe · 12 caractères minimum','email-action-password',{type:'password',autocomplete:'new-password',minlength:'12',maxlength:'128',required:true});
      confirmation=labelInput(doc,'Confirmez votre mot de passe','email-action-confirm',{type:'password',autocomplete:'new-password',minlength:'12',maxlength:'128',required:true});
      form.append(password.wrapper,confirmation.wrapper);
    }
    const submit=element(doc,'button',{type:'submit'},reset?'Enregistrer mon mot de passe':'Confirmer');form.append(submit);
    const localErrors=element(doc,'div',{'aria-live':'polite'});form.append(localErrors);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;localErrors.replaceChildren();
      if(reset&&password.input.value!==confirmation.input.value){localErrors.append(message('Les deux mots de passe ne correspondent pas.'));return;}
      const chosen=reset?password.input.value:undefined;
      if(reset&&(chosen.length<12||chosen.length>128)){localErrors.append(message('Le mot de passe doit comporter de 12 à 128 caractères.'));return;}
      busy=true;submit.disabled=true;submit.textContent=reset?'Enregistrement…':'Confirmation…';
      try {await applyAction(action,{password:chosen},safeOptions);if(reset){password.input.value='';confirmation.input.value='';}showSuccess();}
      catch(error){if(reset){password.input.value='';confirmation.input.value='';}showError(error,{applying:true});}
      finally {busy=false;}
    });
    content.append(form);
  }

  function activationSuccess() {
    view('Compte activé', 'Bienvenue sur Fnac Pulse. Votre accès administrateur est activé pour tous les magasins.');
    content.append(element(doc,'p',{},'Connectez-vous avec votre adresse e-mail et votre mot de passe.'));
    content.append(element(doc,'p',{},'Si un autre administrateur est connecté sur cet appareil, utilisez votre propre appareil ou une fenêtre privée pour préserver sa session.'));
    content.append(loginButton());action=null;proof=null;activationToken='';
  }

  function activationFailure(error) {
    const retryable=['NETWORK','TIMEOUT','WORKER_UNAVAILABLE'].includes(error?.code);
    view('Activation non confirmée',describeActionError(error,{applying:true}));
    if(retryable&&activationToken){const retry=button('Réessayer');retry.addEventListener('click',activate);content.append(retry);}
    content.append(element(doc,'p',{},'Votre mot de passe a pu être enregistré. Essayez aussi de vous connecter avec votre adresse et ce mot de passe.'));
    content.append(loginButton());
  }

  async function activate() {
    if(busy)return;
    const worker=doc.querySelector('meta[name="fnac-pulse-worker"]')?.getAttribute('content')||'';
    busy=true;view('Activation du compte…','Nous confirmons votre invitation.');
    try{await acceptActivation(activationToken,worker,safeOptions);activationSuccess();}
    catch(error){activationFailure(error);}
    finally{busy=false;}
  }

  function passwordForm({existing=false}={}) {
    view(existing?'Utiliser mon mot de passe':'Créer mon mot de passe',existing?
      'Confirmez le mot de passe de votre compte pour activer votre accès.':
      'Choisissez un mot de passe personnel pour activer votre compte administrateur.');
    const form=element(doc,'form'),account=element(doc,'div',{className:'email-action-account'});
    account.append(element(doc,'span',{},'Adresse e-mail'),element(doc,'strong',{},proof.email));
    const username=element(doc,'input',{type:'email',name:'username',autocomplete:'username',className:'email-action-username',tabindex:'-1','aria-hidden':'true',readOnly:true});
    username.value=proof.email;account.append(username);form.append(account);
    if(!existing&&!proof.isNewUser)form.append(element(doc,'p',{},'Si un mot de passe existe déjà pour ce compte, il sera remplacé et certaines sessions pourront être fermées.'));
    const password=labelInput(doc,existing?'Votre mot de passe':'Mot de passe · 12 caractères minimum','activation-password',{
      type:'password',autocomplete:existing?'current-password':'new-password',...(existing?{}:{minlength:'12',maxlength:'128'}),required:true,
    });form.append(password.wrapper);
    let confirm;
    if(!existing){confirm=labelInput(doc,'Confirmer mon mot de passe','activation-confirm',{
      type:'password',autocomplete:'new-password',minlength:'12',maxlength:'128',required:true,
    });form.append(confirm.wrapper);}
    const submit=element(doc,'button',{type:'submit'},'Activer mon compte'),errors=element(doc,'div',{'aria-live':'polite'});
    form.append(submit,errors);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;errors.replaceChildren();
      const chosen=password.input.value;
      if(!existing&&(chosen.length<12||chosen.length>128)){errors.append(message('Le mot de passe doit comporter de 12 à 128 caractères.'));return;}
      if(!existing&&chosen!==confirm.input.value){errors.append(message('Les deux mots de passe ne correspondent pas.'));return;}
      busy=true;submit.disabled=true;submit.textContent='Activation…';let changed=false;
      try{
        if(!existing){const updated=await createActivationPassword(proof.idToken,chosen,safeOptions);if(updated.localId!==proof.localId)throw actionError('INVALID_RESPONSE');changed=true;proof.idToken=updated.idToken;}
        const signed=await confirmActivationPassword(proof.email,chosen,safeOptions);
        if(signed.localId!==proof.localId)throw actionError('INVALID_RESPONSE');
        password.input.value='';if(confirm)confirm.input.value='';activationToken=signed.idToken;busy=false;await activate();
      } catch(error){
        password.input.value='';if(confirm)confirm.input.value='';
        if((existing&&['INVALID_PASSWORD','INVALID_LOGIN_CREDENTIALS','EMAIL_NOT_FOUND'].includes(error?.code))||(!existing&&!changed&&error?.code==='WEAK_PASSWORD'))errors.append(message(describeActionError(error)));
        else if(changed||!existing){view('Mot de passe non confirmé', 'Il a peut-être été enregistré. Essayez de vous connecter avec ce mot de passe avant de demander un nouveau lien.');content.append(loginButton());}
        else errors.append(message(describeActionError(error)));
      } finally{busy=false;submit.disabled=false;submit.textContent='Activer mon compte';}
    });
    content.append(form);
    if(!proof.isNewUser){const back=button('Retour',true);back.addEventListener('click',existingAccountChoice);content.append(back);}
  }

  function existingAccountChoice() {
    view('Bienvenue', 'Un compte existe déjà pour cette adresse. Choisissez comment continuer.');
    const keep=button('Utiliser mon mot de passe'),create=button('Créer ou remplacer mon mot de passe',true);
    keep.addEventListener('click',()=>passwordForm({existing:true}));create.addEventListener('click',()=>passwordForm());
    content.append(keep,create);
  }

  function activationEmail() {
    view('Bienvenue sur Fnac Pulse', 'Confirmez l’adresse qui a reçu votre invitation pour activer votre compte administrateur.');
    const form=element(doc,'form'),address=labelInput(doc,'Votre adresse e-mail','activation-email',{
      type:'email',autocomplete:'email',autocapitalize:'none',spellcheck:'false',maxlength:'254',required:true,
    });
    const submit=element(doc,'button',{type:'submit'},'Continuer'),errors=element(doc,'div',{'aria-live':'polite'});
    form.append(address.wrapper);
    form.append(element(doc,'p',{},'Utiliser ce lien avec un compte existant peut fermer ses autres sessions. Si ce compte n’est pas vérifié, Firebase peut aussi supprimer son ancien mot de passe.'));
    form.append(submit,errors);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;errors.replaceChildren();const email=address.input.value.trim().toLowerCase();
      if(!EMAIL.test(email)||email.length>254){errors.append(message('Indiquez l’adresse e-mail qui a reçu l’invitation.'));return;}
      busy=true;submit.disabled=true;submit.textContent='Vérification…';
      try {proof=await signInActivation(action,email,safeOptions);action.code='';if(proof.isNewUser)passwordForm();else existingAccountChoice();}
      catch(error){
        if(['INVALID_OOB_CODE','EXPIRED_OOB_CODE','USER_DISABLED','USER_NOT_FOUND','INVALID_LINK'].includes(error?.code))showError(error,{applying:true});
        else if(['NETWORK','TIMEOUT'].includes(error?.code)){view('Lien non confirmé','Le lien a peut-être été utilisé. Demandez une nouvelle invitation à votre administrateur, ou connectez-vous si vous possédez déjà un mot de passe.');content.append(loginButton());}
        else errors.append(message(describeActionError(error)));
      } finally{busy=false;submit.disabled=false;submit.textContent='Continuer';}
    });
    content.append(form);
    content.append(element(doc,'p',{},'Vous avez déjà un compte ? Connectez-vous avec votre mot de passe habituel, de préférence sur votre propre appareil.'));
    const existing=loginButton();existing.textContent='J’ai déjà un compte · Me connecter';existing.className='email-action-button email-action-secondary';content.append(existing);
  }

  async function verify() {
    if(busy)return;
    if(action?.mode==='signIn'){activationEmail();return;}
    if(!OPERATIONS[action?.mode]){showError(actionError('UNSUPPORTED_ACTION'));return;}
    busy=true;view('Vérification du lien…','Nous vérifions votre demande auprès de Firebase.');
    try {proof=await inspectAction(action,safeOptions);showConfirmation();}
    catch(error){showError(error);}
    finally {busy=false;}
  }

  if(!incoming){showHelper();return;}
  try {action=parseActionLink(incoming,{appUrl});verify();} catch(error) {showError(error);}
}

if(typeof window!=='undefined'&&window.__fnacEmailActionMode)mountEmailAction();
