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
  if(typeof input!=='string'||input.length>8192)throw actionError('INVALID_LINK');
  let url,app;
  try {url=new URL(input.trim());app=new URL(appUrl);} catch {throw actionError('INVALID_LINK');}
  if(url.username||url.password)throw actionError('INVALID_LINK');
  const appLink=url.origin===app.origin&&url.pathname===app.pathname;
  const firebaseLink=url.protocol==='https:'&&!url.port&&
    [project.authDomain,`${project.projectId}.web.app`].includes(url.hostname)&&url.pathname==='/__/auth/action';
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
  let action=null,proof=null,busy=false;
  const view=(heading,description)=>{title.textContent=heading;lead.textContent=description;content.replaceChildren();};
  const message=(text)=>element(doc,'p',{className:'email-action-message',role:'alert'},text);
  const button=(text,secondary=false)=>element(doc,'button',{type:'button',...(secondary?{className:'email-action-secondary'}:{})},text);
  const loginButton=()=>element(doc,'a',{href:loginUrl,className:'email-action-button'},'Ouvrir l’administration');
  const safeOptions={fetchImpl,timeout};

  function showHelper(errorText='') {
    action=null;proof=null;
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

  async function verify() {
    if(busy)return;
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
