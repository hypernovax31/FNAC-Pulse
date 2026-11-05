import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, inMemoryPersistence, EmailAuthProvider, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail, sendEmailVerification, sendPasswordResetEmail, verifyPasswordResetCode, confirmPasswordReset, checkActionCode, applyActionCode, reload } from 'firebase/auth';
import { getFirestore, doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebase-config';
import { extractAdminEmailChangeCode, extractAdminPasswordResetCode, extractAdminVerificationCode } from './admin-email-link.js';
import { createPinSalt, pinProof } from './pin';
import { earliestDate, parisToday, summarize } from './cloud-stats';
import { comparePeople, orderServices, sellerStoreId, serviceRemovedForStore, servicesForStore } from './catalog';
import { createSaleAnnouncer, createSaleSnapshotFilter, isFreshSale, isOtherSellerSale } from './live-sales';
import { rememberPushOrigin, clearPushOrigin } from './push-origin.js';
import { sellerDepartmentId, saleDepartmentId } from './departments';
import { derivedAdminCodePassword, normalizeAdminCode } from './admin-code.js';
import { salesGeneration, saleInGeneration } from './sales-reset.js';

export const CLOUD=import.meta.env.VITE_BACKEND==='cloud';
export const WORKER_URL=(import.meta.env.VITE_WORKER_URL||'').replace(/\/$/,'');
const VAPID=import.meta.env.VITE_FIREBASE_VAPID_KEY||'';
// La page d'action e-mail est autonome, même si le navigateur télécharge
// aussi le module principal : ne pas initialiser Auth ni lire les sessions.
const emailActionMode=typeof window!=='undefined'&&window.__fnacEmailActionMode===true;
const app=emailActionMode?null:initializeApp(firebaseConfig);
const auth=app?getAuth(app):null, db=app?getFirestore(app):null;
const adminApp=emailActionMode?null:initializeApp(firebaseConfig,'fnac-pulse-admin');
const adminAuth=adminApp?getAuth(adminApp):null;
export const ADMIN_SESSION='firebase-admin-session';
export async function vendorToken() {await auth.authStateReady();return auth.currentUser?.getIdToken()||'';}
export async function adminToken() {await adminAuth.authStateReady();return adminAuth.currentUser?.getIdToken()||'';}
export function observeVendor(callback) {
  return onAuthStateChanged(auth,async user=>{
    if(!user){callback(null);return;}
    try {
      const {claims}=await user.getIdTokenResult();
      callback(claims.role==='seller'&&claims.storeId&&Number.isInteger(claims.sellerId)?{storeId:claims.storeId,sellerId:claims.sellerId,uid:user.uid,accessVersion:claims.accessVersion}:null);
    } catch {callback(null);}
  });
}
async function completeSellerLogin(result,session,pinJustSaved=false) {
  if(typeof result?.customToken!=='string'||!result.customToken)throw new Error('Connexion invalide. Réessayez.');
  let user;
  try {user=(await signInWithCustomToken(auth,result.customToken)).user;}
  catch {throw new Error(pinJustSaved?'Votre PIN a été enregistré. Reconnectez-vous avec votre nouveau code.':'Connexion impossible. Réessayez.');}
  const {claims}=await user.getIdTokenResult();
  if(claims.role!=='seller'||claims.storeId!==session.storeId||claims.sellerId!==session.sellerId||typeof claims.accessVersion!=='string'||!claims.accessVersion){await signOut(auth);throw new Error('Connexion invalide. Réessayez.');}
  return {storeId:claims.storeId,sellerId:claims.sellerId,uid:user.uid,accessVersion:claims.accessVersion};
}
export async function sellerLogin(api,session,pin,pinSalt='') {
  const proof=await pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,pin,pinSalt);
  const result=await api('/api/auth/login',{method:'POST',body:{...session,openPinFlow:true,pinFlowVersion:2,proof}});
  return completeSellerLogin(result,session);
}
export async function sellerChoosePin(api,session,pin) {
  const newProof=await pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,pin);let result;
  try {result=await api('/api/auth/claim',{method:'POST',body:{...session,newProof,pinLength:4}});}
  catch(error) {
    if(error.status&&error.status<500&&error.status!==409)throw error;
    // Une réponse perdue peut masquer une revendication réussie ; ne jamais
    // réécrire le PIN, seulement tenter de se connecter avec ce même dérivé.
    try {result=await api('/api/auth/login',{method:'POST',body:{...session,proof:newProof,openPinFlow:true,pinFlowVersion:2}});}
    catch {if(error.status===409)throw error;throw new Error('Votre PIN a peut-être été enregistré. Recherchez votre profil et connectez-vous avec ce code.');}
  }
  return completeSellerLogin(result,session,true);
}
export async function sellerMigratePin(api,session,oldPin,newPin,pinSalt='') {
  const [oldProof,newProof]=await Promise.all([
    pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,oldPin,pinSalt),
    pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,newPin,pinSalt),
  ]);
  const body={...session,oldProof,newProof};let result;
  try {result=await api('/api/auth/pin/change',{method:'POST',body});}
  catch(error){
    if(error.status&&error.status<500)throw error;
    try {result=await api('/api/auth/pin/change',{method:'POST',body});}
    catch {throw new Error('Le nouveau PIN a peut-être été enregistré. Vérifiez votre profil et connectez-vous avec le code à 4 chiffres.');}
  }
  return completeSellerLogin(result,session,true);
}
export async function sellerRegister(api,selection,name,pin,{regionalConsent=false}={}) {
  const pinSalt=createPinSalt(),registrationId=createPinSalt();
  const newProof=await pinProof(firebaseConfig.projectId,selection.storeId,null,pin,pinSalt);
  const body={storeId:selection.storeId,departmentId:selection.departmentId,name,pinSalt,registrationId,newProof,...(regionalConsent===true?{regionalConsent:true}:{})};let result;
  try {result=await api('/api/auth/register',{method:'POST',body});}
  catch(error){
    if(error.status&&error.status<500)throw error;
    try {result=await api('/api/auth/register',{method:'POST',body});}
    catch {throw new Error('Votre profil a peut-être été créé. Recherchez votre prénom et connectez-vous avec votre PIN à 4 chiffres.');}
  }
  if(!Number.isSafeInteger(result?.sellerId)||result.sellerId<=0)throw new Error('Votre profil a peut-être été créé. Recherchez votre prénom et connectez-vous.');
  return completeSellerLogin(result,{...selection,sellerId:result.sellerId},true);
}
export async function sellerLogout() {await signOut(auth);}
export async function adminLogin(email,password) {
  try {await setPersistence(adminAuth,browserSessionPersistence);await signInWithEmailAndPassword(adminAuth,email,password);}
  catch {throw new Error('E-mail ou mot de passe administrateur incorrect.');}
  return ADMIN_SESSION;
}
export async function adminLogout() {await signOut(adminAuth);}
async function adminUser() {
  await adminAuth.authStateReady();const user=adminAuth.currentUser;
  if(!user?.email)throw new Error('Session administrateur expirée.');
  return user;
}
async function reauthenticateAdmin(currentPassword) {
  const user=await adminUser();
  try {
    await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,currentPassword));
    // Le serveur exige auth_time récent pour attribuer des droits.
    await user.getIdToken(true);
  } catch {throw new Error('Mot de passe administrateur actuel incorrect ou connexion impossible.');}
  return user;
}
export async function adminAccountEmail({refresh=false}={}) {
  const user=await adminUser();if(refresh)await reload(user);
  return user.email||'';
}
export async function changeAdminPassword(currentPassword,newPassword) {
  if(newPassword.length<12||newPassword.length>128)throw new Error('Le mot de passe doit comporter de 12 à 128 caractères.');
  const user=await reauthenticateAdmin(currentPassword);
  try {await updatePassword(user,newPassword);}
  catch {throw new Error('Modification du mot de passe impossible. Réessayez.');}
}
export async function requestAdminEmailChange(currentPassword,newEmail) {
  const email=String(newEmail||'').trim();
  if(!email||email.length>254)throw new Error('Indiquez une nouvelle adresse e-mail valide.');
  const user=await reauthenticateAdmin(currentPassword);
  if(user.email.toLowerCase()===email.toLowerCase())throw new Error('Cette adresse est déjà utilisée pour votre compte.');
  try {await verifyBeforeUpdateEmail(user,email);}
  catch(e) {
    if(e?.code==='auth/invalid-email')throw new Error('Indiquez une nouvelle adresse e-mail valide.');
    if(e?.code==='auth/too-many-requests')throw new Error('Trop de demandes. Réessayez plus tard.');
    throw new Error('Envoi du lien de confirmation impossible. Vérifiez votre connexion et réessayez.');
  }
}
// Fallback pour un lien Firebase dont la page externe reste bloquée. Le code
// est vérifié et appliqué directement auprès de Firebase, jamais au Worker.
function firebaseDeadline(promise,ms=15000) {
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Délai dépassé'),{code:'pulse/timeout'})),ms);});
  return Promise.race([promise,deadline]).finally(()=>clearTimeout(timer));
}
function emailChangeFailure(error,{applying=false}={}) {
  if(['auth/expired-action-code','auth/invalid-action-code'].includes(error?.code))return new Error('Lien expiré ou déjà utilisé. Vérifiez l’adresse de votre compte ou demandez un nouveau lien.');
  if(error?.code==='auth/email-already-in-use')return new Error('Cette nouvelle adresse est déjà utilisée. Demandez un autre changement.');
  if(applying)return new Error('La confirmation n’est pas certaine. Vérifiez l’adresse de votre compte et reconnectez-vous avant de demander un nouveau lien.');
  if(['auth/user-token-expired','auth/user-disabled','auth/user-not-found'].includes(error?.code))return new Error('Session administrateur expirée. Reconnectez-vous avant de vérifier le lien.');
  return new Error('Impossible de vérifier le lien auprès de Firebase. Vérifiez votre connexion et réessayez.');
}
async function checkedEmailChange(user,code,expectedEmail) {
  let info;
  try {info=await firebaseDeadline(checkActionCode(adminAuth,code));}catch(error){throw emailChangeFailure(error);}
  if(adminAuth.currentUser?.uid!==user.uid)throw new Error('Votre session administrateur a changé. Reconnectez-vous avant de continuer.');
  if(info?.operation!=='VERIFY_AND_CHANGE_EMAIL'||typeof info.data?.email!=='string'||!info.data.email||typeof info.data?.previousEmail!=='string'||!info.data.previousEmail)throw new Error('Ce lien ne correspond pas à une demande de changement d’e-mail.');
  if(info.data.previousEmail.toLowerCase()!==user.email.toLowerCase())throw new Error('Ce lien ne correspond pas au compte administrateur connecté.');
  if(expectedEmail&&info.data.email.toLowerCase()!==expectedEmail.toLowerCase())throw new Error('La nouvelle adresse ne correspond plus au lien vérifié. Recommencez.');
  return info.data.email;
}
export async function inspectAdminEmailChange(link) {
  const code=extractAdminEmailChangeCode(link,firebaseConfig),user=await adminUser();
  const newEmail=await checkedEmailChange(user,code);
  return {code,newEmail};
}
export async function confirmAdminEmailChange({code,newEmail}={}) {
  if(typeof code!=='string'||!/^[^\s\u0000-\u001f\u007f]{6,2048}$/.test(code)||typeof newEmail!=='string'||!newEmail)throw new Error('Vérifiez à nouveau le lien de confirmation.');
  const user=await adminUser(),verifiedEmail=await checkedEmailChange(user,code,newEmail);
  try {await firebaseDeadline(applyActionCode(adminAuth,code));}
  catch(error){throw emailChangeFailure(error,{applying:true});}
  // La confirmation a réussi même si la session doit ensuite être renouvelée.
  let refreshed=false;
  try {await firebaseDeadline(reload(user),8000);refreshed=user.email?.toLowerCase()===verifiedEmail.toLowerCase();}catch{}
  return {email:verifiedEmail,refreshed};
}
// L'administrateur ne choisit et ne reçoit jamais le mot de passe du destinataire.
// Un secret aléatoire, utilisé uniquement pour créer un compte Firebase neuf,
// devient inutilisable dès que le titulaire choisit son propre mot de passe.
function secureRandomText() {
  if(!globalThis.crypto?.getRandomValues)throw new Error('Générateur sécurisé indisponible sur cet appareil.');
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function inviteAdministrator(api,{email,currentPassword}) {
  const address=String(email||'').trim();
  if(!address||address.length>254)throw new Error('Indiquez une adresse e-mail valide.');
  await reauthenticateAdmin(currentPassword);
  const requestId=secureRandomText(),body={email:address,requestId};let invitation;
  try {invitation=await api('/api/admin/invitations',{method:'POST',token:ADMIN_SESSION,body});}
  catch(error) {
    if(error?.status&&error.status<500)throw error;
    try {invitation=await api('/api/admin/invitations',{method:'POST',token:ADMIN_SESSION,body});}
    catch {throw new Error('L’invitation n’a pas pu être confirmée. Réessayez ; aucun droit n’est attribué sans l’accord du destinataire.');}
  }
  if(invitation?.status==='accepted')return {alreadyAccepted:true};
  if(invitation?.status!=='pending')throw new Error('L’invitation a expiré. Envoyez une nouvelle invitation.');
  const appName=`fnac-pulse-invitation-${secureRandomText()}`,temporary=initializeApp(firebaseConfig,appName),temporaryAuth=getAuth(temporary);
  let accountCreated=false;
  try {
    await setPersistence(temporaryAuth,inMemoryPersistence);temporaryAuth.languageCode='fr';
    try {
      await createUserWithEmailAndPassword(temporaryAuth,address,`${secureRandomText()}aA1!`);accountCreated=true;
    } catch(error) {
      if(error?.code!=='auth/email-already-in-use') {
        const detail=error?.code==='auth/invalid-email'?'Vérifiez l’adresse e-mail.':error?.code==='auth/too-many-requests'?'Trop de demandes ; réessayez plus tard.':'Vérifiez votre connexion et réessayez.';
        throw new Error(`Invitation enregistrée, mais création du compte non confirmée. ${detail} Aucun droit n’a été attribué.`);
      }
    }
    try {await sendPasswordResetEmail(temporaryAuth,address);}
    catch(error) {
      const detail=error?.code==='auth/too-many-requests'?'Quota d’e-mails atteint. Réessayez plus tard.':'Vérifiez la connexion et réessayez.';
      throw new Error(`Invitation enregistrée, mais envoi non confirmé. ${detail} Aucun droit n’a été attribué.`);
    }
    return {alreadyAccepted:false,accountCreated,expiresAt:invitation.expiresAt};
  } finally {await signOut(temporaryAuth).catch(()=>{});await deleteApp(temporary).catch(()=>{});}
}
export async function requestAdminPasswordReset(email) {
  const address=String(email||'').trim();
  if(!address||address.length>254)throw new Error('Indiquez l’adresse e-mail du compte invité.');
  try {adminAuth.languageCode='fr';await firebaseDeadline(sendPasswordResetEmail(adminAuth,address));}
  catch(error){
    if(error?.code==='auth/invalid-email')throw new Error('Indiquez une adresse e-mail valide.');
    if(error?.code==='auth/too-many-requests')throw new Error('Trop de demandes. Réessayez plus tard.');
    throw new Error('La demande n’a pas pu être confirmée. Vérifiez votre connexion et réessayez.');
  }
}
function resetLinkFailure(error,{applying=false}={}) {
  if(['auth/expired-action-code','auth/invalid-action-code'].includes(error?.code))return new Error('Lien expiré ou déjà utilisé. Demandez un nouveau lien.');
  if(error?.code==='auth/weak-password')return new Error('Choisissez un mot de passe plus robuste.');
  return new Error(applying?'Le changement n’est pas certain. Essayez de vous connecter avec le nouveau mot de passe avant de demander un autre lien.':'Impossible de vérifier le lien. Vérifiez votre connexion et réessayez.');
}
export async function inspectAdminPasswordReset(link) {
  const code=extractAdminPasswordResetCode(link,firebaseConfig);let email;
  try {email=await firebaseDeadline(verifyPasswordResetCode(adminAuth,code));}catch(error){throw resetLinkFailure(error);}
  if(typeof email!=='string'||!email)throw new Error('Ce lien ne correspond pas à un compte valide.');
  return {code,email};
}
export async function confirmAdminPasswordReset({code,email}={},password) {
  if(typeof code!=='string'||!/^[^\s\u0000-\u001f\u007f]{6,2048}$/.test(code)||typeof email!=='string'||!email)throw new Error('Vérifiez à nouveau le lien.');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Le mot de passe doit comporter de 12 à 128 caractères.');
  let checked;try{checked=await firebaseDeadline(verifyPasswordResetCode(adminAuth,code));}catch(error){throw resetLinkFailure(error);}
  if(checked.toLowerCase()!==email.toLowerCase())throw new Error('L’adresse ne correspond plus au lien vérifié. Recommencez.');
  try {await firebaseDeadline(confirmPasswordReset(adminAuth,code,password));}catch(error){throw resetLinkFailure(error,{applying:true});}
  return {email:checked};
}
async function checkedAdminVerification(code,expectedEmail) {
  let info;try{info=await firebaseDeadline(checkActionCode(adminAuth,code));}catch(error){throw resetLinkFailure(error);}
  const email=info?.data?.email;
  if(info?.operation!=='VERIFY_EMAIL'||typeof email!=='string'||!email)throw new Error('Ce lien ne correspond pas à une confirmation d’adresse.');
  if(expectedEmail&&email.toLowerCase()!==expectedEmail.toLowerCase())throw new Error('L’adresse ne correspond plus au lien vérifié. Recommencez.');
  return email;
}
export async function inspectAdminVerification(link) {
  const code=extractAdminVerificationCode(link,firebaseConfig),email=await checkedAdminVerification(code);
  return {code,email};
}
export async function confirmAdminVerification({code,email}={}) {
  if(typeof code!=='string'||!/^[^\s\u0000-\u001f\u007f]{6,2048}$/.test(code)||typeof email!=='string'||!email)throw new Error('Vérifiez à nouveau le lien.');
  const checked=await checkedAdminVerification(code,email);
  try{await firebaseDeadline(applyActionCode(adminAuth,code));}catch(error){
    if(['auth/expired-action-code','auth/invalid-action-code'].includes(error?.code))throw resetLinkFailure(error);
    throw new Error('La confirmation n’est pas certaine. Essayez de vous connecter avant de demander un autre lien.');
  }
  return {email:checked};
}
function provisioningMessage(error,existing) {
  switch(error?.code) {
    case 'auth/email-already-in-use':return 'Cette adresse possède déjà un compte. Si vous avez son accord et son mot de passe, choisissez « Compte existant ». Aucun droit n’a été ajouté.';
    case 'auth/invalid-email':return 'Indiquez une adresse e-mail valide.';
    case 'auth/weak-password':return 'Choisissez un mot de passe plus robuste, de 12 caractères minimum.';
    case 'auth/invalid-credential':case 'auth/wrong-password':case 'auth/user-not-found':return existing?'E-mail ou mot de passe du compte à ajouter incorrect.':'Création du compte impossible.';
    case 'auth/too-many-requests':return 'Trop de demandes. Réessayez plus tard.';
    case 'auth/operation-not-allowed':return 'La création de comptes par e-mail n’est pas autorisée dans Firebase.';
    default:return 'Création ou connexion du compte impossible. Vérifiez votre connexion et réessayez.';
  }
}
// Un administrateur déjà connecté peut créer un code sans ressaisir son mot de
// passe. La confirmation des droits reste explicite dans l'interface.
export async function createAdminEnrollmentCode(api) {
  await adminUser();
  return api('/api/admin/enrollment-code',{method:'POST',body:{confirmed:true},token:ADMIN_SESSION});
}
export async function cancelAdminEnrollmentCode(api,code) {
  await adminUser();
  return api('/api/admin/enrollment-code/cancel',{method:'POST',body:{code},token:ADMIN_SESSION});
}
export async function registerAdminWithCode(api,{code,email,password}) {
  const normalizedCode=normalizeAdminCode(code),address=String(email||'').trim().toLowerCase();
  if(!normalizedCode)throw new Error('Vérifiez le code administrateur reçu.');
  if(!address||address.length>254)throw new Error('Indiquez votre adresse e-mail.');
  if(typeof password!=='string'||Array.from(password).length<1||Array.from(password).length>6)throw new Error('Le mot de passe provisoire doit contenir de 1 à 6 caractères maximum.');
  // Cette clé n'est envoyée qu'à Firebase, jamais au Worker. Le code est
  // nécessaire en plus des 6 caractères pour retrouver la clé provisoire.
  const temporaryPassword=await derivedAdminCodePassword({code:normalizedCode,email:address,password});
  let reservation;
  try {reservation=await api('/api/auth/admin-code/prepare',{method:'POST',body:{code:normalizedCode,email:address,confirmed:true}});}
  catch(error){if(error?.status&&error.status<500)throw error;throw new Error('Préparation non confirmée. Réessayez avec le même code, la même adresse et le même mot de passe provisoire.');}
  if(!reservation?.ok)throw new Error('Préparation non confirmée. Réessayez avec les mêmes informations.');
  const temporary=initializeApp(firebaseConfig,`fnac-pulse-code-admin-${secureRandomText()}`),temporaryAuth=getAuth(temporary);
  let completed;
  try {
    await setPersistence(temporaryAuth,inMemoryPersistence);
    let user;
    try {user=(await createUserWithEmailAndPassword(temporaryAuth,address,temporaryPassword)).user;}
    catch(error) {
      if(error?.code==='auth/email-already-in-use'&&reservation.resume===true) {
        try {user=(await signInWithEmailAndPassword(temporaryAuth,address,temporaryPassword)).user;}
        catch {throw new Error('Impossible de reprendre : vérifiez le code, l’adresse et le mot de passe provisoire. Aucun ancien compte ne reçoit de nouveaux droits.');}
      } else if(error?.code==='auth/email-already-in-use') {
        throw new Error('Cette adresse possède déjà un compte. Aucun ancien compte ne sera promu : demandez un nouveau code et utilisez une nouvelle adresse.');
      } else if(error?.code==='auth/invalid-email') {
        throw new Error('Indiquez une adresse e-mail valide.');
      } else if(error?.code==='auth/weak-password') {
        throw new Error('La politique Firebase a refusé la création sécurisée. Aucun droit n’a été attribué ; contactez le responsable de l’application.');
      } else {
        throw new Error('Création Firebase non confirmée. Si la connexion a été interrompue, reprenez avec le même code, la même adresse et le même mot de passe provisoire.');
      }
    }
    let userToken;
    try{userToken=await user.getIdToken(true);}catch{throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Reprenez avec les mêmes informations.');}
    try {completed=await api('/api/auth/admin-code/complete',{method:'POST',body:{code:normalizedCode},token:userToken});}
    catch(error){if(error?.status&&error.status<500)throw error;throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Reprenez avec le même code, la même adresse et le même mot de passe provisoire.');}
    if(!completed?.ok)throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Reprenez avec les mêmes informations.');
  } finally {await signOut(temporaryAuth).catch(()=>{});await deleteApp(temporary).catch(()=>{});}
  try {await adminLogin(address,temporaryPassword);}
  catch {throw new Error('Le compte est peut-être prêt mais sa connexion n’a pas été confirmée. Reprenez avec le même code, la même adresse et le même mot de passe provisoire.');}
  return completed;
}
// La session vient d'être créée avec le code et le mot de passe provisoire : pas besoin
// de redemander la clé Firebase calculée ni le mot de passe provisoire à l'écran.
export async function changeFirstCodeAdminPassword(nextPassword) {
  if(typeof nextPassword!=='string'||nextPassword.length<12||nextPassword.length>128)throw new Error('Le mot de passe doit comporter de 12 à 128 caractères.');
  const user=await adminUser();
  try {await updatePassword(user,nextPassword);}
  catch(e) {
    if(e?.code==='auth/requires-recent-login')throw new Error('La session a expiré. Déconnectez-vous puis reprenez avec le code et les mêmes informations.');
    throw new Error('Modification non confirmée. Si nécessaire, reconnectez-vous avec le nouveau mot de passe ; sinon reprenez avec le code et les mêmes informations.');
  }
}
// Création directe explicitement demandée : ni invitation, ni e-mail. La
// réservation serveur permet de reprendre une réponse perdue sans transformer
// un ancien compte en administrateur. Le mot de passe ne va qu'à Firebase Auth.
export async function createDirectAdministrator(api,{email,password,currentPassword,confirmed=false}) {
  const address=String(email||'').trim();
  if(!address||address.length>254)throw new Error('Indiquez une adresse e-mail valide.');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Le mot de passe provisoire doit comporter de 12 à 128 caractères.');
  if(password===currentPassword)throw new Error('Choisissez un mot de passe provisoire différent du vôtre.');
  if(!confirmed)throw new Error('Confirmez que vous avez vérifié l’adresse et les droits accordés.');
  await reauthenticateAdmin(currentPassword);
  const startBody={email:address,confirmed:true};let reservation;
  try {reservation=await api('/api/admin/direct-account/start',{method:'POST',token:ADMIN_SESSION,body:startBody});}
  catch(error) {
    if(error?.status&&error.status<500)throw error;
    try {reservation=await api('/api/admin/direct-account/start',{method:'POST',token:ADMIN_SESSION,body:startBody});}
    catch {throw new Error('La création n’a pas pu être préparée. Aucun compte n’a été créé par cette tentative.');}
  }
  if(!reservation?.ok||!reservation.requestId)throw new Error('La création n’a pas pu être préparée. Aucun compte n’a été créé par cette tentative.');
  const temporary=initializeApp(firebaseConfig,`fnac-pulse-direct-admin-${secureRandomText()}`),temporaryAuth=getAuth(temporary);
  let accountCreated=false;
  try {
    await setPersistence(temporaryAuth,inMemoryPersistence);
    let user;
    try {
      user=(await createUserWithEmailAndPassword(temporaryAuth,address,password)).user;accountCreated=true;
    } catch(error) {
      if(error?.code==='auth/email-already-in-use'&&reservation.resume) {
        // Ce n'est qu'une reprise possible : le serveur vérifie ensuite auprès
        // de Firebase que le compte est né après la réservation initiale.
        try {user=(await signInWithEmailAndPassword(temporaryAuth,address,password)).user;}
        catch {throw new Error('Cette adresse est déjà utilisée ou le mot de passe provisoire ne correspond pas. Aucun nouveau droit n’a été attribué.');}
      } else if(error?.code==='auth/email-already-in-use') {
        throw new Error('Cette adresse possède déjà un compte Firebase. Aucun droit n’a été modifié ; la création directe est réservée aux nouveaux comptes.');
      } else if(error?.code==='auth/network-request-failed') {
        throw new Error('La création du compte n’est pas confirmée. Réessayez avec la même adresse et le même mot de passe provisoire.');
      } else {throw new Error(provisioningMessage(error,false));}
    }
    let userToken;
    try {userToken=await user.getIdToken(true);}
    catch {throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Réessayez avec les mêmes identifiants.');}
    const body={email:address,requestId:reservation.requestId,userToken};let result;
    try {result=await api('/api/admin/direct-account/complete',{method:'POST',token:ADMIN_SESSION,body});}
    catch(error) {
      if(error?.status&&error.status<500)throw error;
      try {result=await api('/api/admin/direct-account/complete',{method:'POST',token:ADMIN_SESSION,body});}
      catch {throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Réessayez avec les mêmes identifiants.');}
    }
    if(!result?.ok)throw new Error('Le compte est peut-être créé, mais ses droits ne sont pas confirmés. Réessayez avec les mêmes identifiants.');
    return {already:!!result.already,accountCreated};
  } finally {await signOut(temporaryAuth).catch(()=>{});await deleteApp(temporary).catch(()=>{});}
}
// Ancien parcours conservé pour la compatibilité : il exige toujours la
// confirmation e-mail et n'est pas utilisé par la nouvelle interface.
export async function createAdministrator(api,{email,password,currentPassword,existing=false}) {
  const address=String(email||'').trim();
  if(!address||address.length>254)throw new Error('Indiquez une adresse e-mail valide.');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('Le mot de passe doit comporter de 12 à 128 caractères.');
  await reauthenticateAdmin(currentPassword);
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const provisioningApp=initializeApp(firebaseConfig,`fnac-pulse-new-admin-${suffix}`),provisioningAuth=getAuth(provisioningApp);
  let accountCreated=false,accountAuthenticated=false;
  try {
    await setPersistence(provisioningAuth,inMemoryPersistence);
    let user;
    try {
      user=(existing?await signInWithEmailAndPassword(provisioningAuth,address,password):await createUserWithEmailAndPassword(provisioningAuth,address,password)).user;
      accountCreated=!existing;accountAuthenticated=true;
    } catch(error) {throw new Error(provisioningMessage(error,existing));}
    // Le droit reste inutilisable jusqu'à confirmation de l'adresse. Une
    // erreur d'envoi ne donne jamais un accès non vérifié.
    if(!user.emailVerified)try {await sendEmailVerification(user);}
    catch(error) {
      const text=error?.code==='auth/too-many-requests'?'Quota d’e-mails atteint. Réessayez plus tard.':'Envoi de l’e-mail de confirmation impossible. Vérifiez votre connexion.';
      throw new Error(`${accountCreated?'Le compte a été créé, mais aucun droit n’a encore été attribué. ':'Les droits de ce compte n’ont pas été vérifiés par cette tentative. '}${text} Pour reprendre, utilisez « Compte existant ».`);
    }
    const userToken=await user.getIdToken(true);let result;
    try {result=await api('/api/admin/administrators',{method:'POST',token:ADMIN_SESSION,body:{userToken}});}
    catch(error) {
      if(!error?.status||error.status>=500)try {result=await api('/api/admin/administrators',{method:'POST',token:ADMIN_SESSION,body:{userToken}});}catch{}
      if(!result?.ok)throw new Error(`${accountCreated?'Le compte a été créé, mais ses droits ne sont pas confirmés. ':'L’attribution des droits n’est pas confirmée. '}Réessayez avec « Compte existant ».`);
    }
    return {already:!!result.already,verificationRequired:!user.emailVerified};
  } catch(error) {
    if(accountAuthenticated&&accountCreated&&error?.code)throw new Error('Le compte a été créé, mais ses droits ne sont pas confirmés. Réessayez avec « Compte existant ».');
    throw error;
  } finally {
    await signOut(provisioningAuth).catch(()=>{});
    await deleteApp(provisioningApp).catch(()=>{});
  }
}
export async function resendAdminVerification(email,password) {
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temp=initializeApp(firebaseConfig,`fnac-pulse-admin-verify-${suffix}`),tempAuth=getAuth(temp);
  try {
    await setPersistence(tempAuth,inMemoryPersistence);
    const {user}=await signInWithEmailAndPassword(tempAuth,String(email||'').trim(),password);
    if(user.emailVerified)return {verified:true};
    await sendEmailVerification(user);return {verified:false};
  } catch(error) {throw new Error(provisioningMessage(error,true));}
  finally {await signOut(tempAuth).catch(()=>{});await deleteApp(temp).catch(()=>{});}
}
function presentation(catalog,storeId) {
  return {
    stores:catalog.stores.filter(x=>x.active&&x.directoryStatus!=='region').map(({active,...x})=>x),
    sellers:catalog.sellers.filter(x=>x.active).sort(comparePeople).map(x=>({id:x.id,name:x.name,storeId:sellerStoreId(x),departmentId:sellerDepartmentId(x)})),
    departmentsByStore:catalog.departmentsByStore||{}, directoryRegions:catalog.directoryRegions||[],
    services:servicesForStore(catalog,storeId).map(({id,name,icon})=>({id,name,icon})),
  };
}
export function listenStore(session,day,clientId,onChange,onSale,onError,onGoalsChanged=()=>{},onSummaryChanged=()=>{}) {
  let catalog=null,sales=[],generation='',catalogReady=false,salesReady=false,resetReady=false,catalogCache=true,salesCache=true,resetCache=true;
  const freshSales=createSaleSnapshotFilter({day,clientId}),pendingFresh=new Map();
  const announcer=createSaleAnnouncer(sale=>{
    const self=catalog?.sellers.find(s=>Number(s.id)===Number(session.sellerId)&&sellerStoreId(s)===session.storeId);
    if(self&&!serviceRemovedForStore(catalog,session.storeId,sale.serviceId)&&isOtherSellerSale(sale,session.sellerId)&&isFreshSale(sale,day,clientId)&&saleDepartmentId(sale)===sellerDepartmentId(self))onSale(sale);
  });
  const flushFresh=()=>{
    if(!resetReady)return;
    for(const [id,sale] of pendingFresh) {
      if(!isFreshSale(sale,day,clientId))pendingFresh.delete(id);
      else if(saleInGeneration(sale,generation)){pendingFresh.delete(id);announcer.add(sale);}
    }
  };
  let goalRevision=Symbol('premier chargement'),summaryRevision=Symbol('premier chargement'),catalogSignature='';
  const emit=()=>{if(catalogReady&&salesReady&&resetReady){const scoped={...catalog,services:orderServices(catalog.services,catalog.serviceOrders,session.storeId)};const current=sales.filter(sale=>saleInGeneration(sale,generation));onChange({...presentation(scoped,session.storeId),today:day,stats:summarize(scoped,current,session.sellerId,day,session.storeId)},!(catalogCache||salesCache||resetCache));}};
  const stopAccess=onSnapshot(doc(db,'pulseStatus',session.uid),{includeMetadataChanges:true},snap=>{
    if(snap.metadata.fromCache)return;
    const access=snap.data();
    if(!snap.exists()||!access.active||access.version!==session.accessVersion||access.storeId!==session.storeId||access.sellerId!==session.sellerId){const error=new Error('Accès modifié. Reconnectez-vous.');error.code='permission-denied';onError(error);return;}
    const revision=access.goalsRevision||null;
    if(revision!==goalRevision){goalRevision=revision;onGoalsChanged();}
  },onError);
  const stopCatalog=onSnapshot(doc(db,'pulse','catalog'),{includeMetadataChanges:true},snap=>{
    if(!snap.exists()){onError(new Error('Catalogue indisponible.'));return;}
    catalog=snap.data();catalogCache=snap.metadata.fromCache;catalogReady=true;
    const signature=JSON.stringify({sellers:catalog.sellers.filter(s=>sellerStoreId(s)===session.storeId).map(s=>[s.id,s.active,sellerDepartmentId(s)]),services:catalog.services.map(s=>[s.id,s.active,serviceRemovedForStore(catalog,session.storeId,s.id)]),departments:catalog.departmentsByStore?.[session.storeId]||null});
    if(!snap.metadata.fromCache&&signature!==catalogSignature){catalogSignature=signature;onSummaryChanged();}
    announcer.setCatalog(catalog);emit();
  },onError);
  const stopSummary=onSnapshot(doc(db,'pulseStores',session.storeId,'sales','~summary-goals~'),{includeMetadataChanges:true},snap=>{
    if(snap.metadata.fromCache)return;
    const revision=snap.data()?.revision||null;
    if(revision!==summaryRevision){summaryRevision=revision;onSummaryChanged();}
  },onError);
  const stopReset=onSnapshot(doc(db,'pulseStores',session.storeId,'sales','~sales-reset~'),{includeMetadataChanges:true},snap=>{
    generation=salesGeneration(snap.data());resetCache=snap.metadata.fromCache;resetReady=true;flushFresh();emit();
  },onError);
  const q=query(collection(db,'pulseStores',session.storeId,'sales'),where('businessDate','>=',earliestDate(day)));
  const stopSales=onSnapshot(q,{includeMetadataChanges:true},snap=>{
    // Le premier état serveur est une base historique, jamais une nouvelle
    // vente : même après un premier instantané vide fourni par le cache.
    // Si une nouvelle vente arrive avant le marqueur, l'annonce attend celui-ci.
    for(const sale of freshSales(snap))pendingFresh.set(sale.id,sale);
    flushFresh();sales=snap.docs.map(x=>x.data());salesCache=snap.metadata.fromCache;salesReady=true;emit();
  },onError);
  return ()=>{stopAccess();stopCatalog();stopSummary();stopReset();stopSales();};
}
async function messaging() {
  if(!VAPID||VAPID==='cle-publique-web-push-firebase')throw new Error('La clé publique Web Push Firebase reste à configurer.');
  if(!(await isSupported()))throw new Error('Notifications non prises en charge sur cet appareil.');
  return getMessaging(app);
}
function requireNotificationPermission() {
  // Firebase peut appeler requestPermission tout seul si l'état est « default ».
  // Seul le bouton explicite de l'interface doit pouvoir lancer cette demande.
  if(typeof Notification==='undefined'||Notification.permission!=='granted')throw new Error('Autorisation de notification non accordée.');
}
function requireActiveCheck(signal) {
  if(signal?.aborted){const error=new Error('Vérification des notifications annulée.');error.name='AbortError';throw error;}
}
// Peut préparer l'abonnement du navigateur dès le geste d'activation, même si
// le vendeur n'a pas encore choisi son profil. Aucun jeton n'est transmis au
// serveur Fnac Pulse et aucune préférence n'est validée avant la connexion.
export async function prepareFcm({signal}={}) {
  requireActiveCheck(signal);
  const m=await messaging();requireActiveCheck(signal);
  const registration=await navigator.serviceWorker.ready;requireActiveCheck(signal);
  requireNotificationPermission();
  const token=await getToken(m,{vapidKey:VAPID,serviceWorkerRegistration:registration});
  requireActiveCheck(signal);
  if(!token)throw new Error('Impossible de créer l’abonnement aux notifications.');
  return token;
}
export async function subscribeFcm(api,{signal}={}) {
  const token=await prepareFcm({signal});requireActiveCheck(signal);
  await api('/api/push/subscribe',{method:'POST',body:{token},signal});
  requireActiveCheck(signal);
  await rememberPushOrigin(token,undefined,undefined,signal);
  requireActiveCheck(signal);
  localStorage.setItem('fnac-pulse-fcm-enabled','1');
}
export async function unsubscribeFcm(api) {
  // Ne pas réactiver automatiquement une préférence explicitement coupée,
  // même si la suppression côté serveur échoue (l'interface avertit alors).
  try {localStorage.removeItem('fnac-pulse-fcm-enabled');} catch {}
  const m=await messaging(),registration=await navigator.serviceWorker.ready;
  requireNotificationPermission();
  const token=await getToken(m,{vapidKey:VAPID,serviceWorkerRegistration:registration});
  let failure=null;
  try {if(token)await api('/api/push/subscribe',{method:'DELETE',body:{token}});} catch(e) {failure=e;}
  try {await deleteToken(m);} finally {clearPushOrigin();localStorage.removeItem('fnac-pulse-fcm-enabled');}
  if(failure)throw failure;
}
export function notificationsWanted() {try{return localStorage.getItem('fnac-pulse-fcm-enabled')==='1';}catch{return false;}}
