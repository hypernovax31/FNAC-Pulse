import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, inMemoryPersistence, EmailAuthProvider, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail, sendEmailVerification, reload } from 'firebase/auth';
import { getFirestore, doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebase-config';
import { createPinSalt, pinProof } from './pin';
import { earliestDate, parisToday, summarize } from './cloud-stats';
import { comparePeople, orderServices, sellerStoreId, serviceRemovedForStore, servicesForStore } from './catalog';
import { createSaleAnnouncer, createSaleSnapshotFilter, isFreshSale, isOtherSellerSale } from './live-sales';
import { rememberPushOrigin, clearPushOrigin } from './push-origin.js';
import { sellerDepartmentId, saleDepartmentId } from './departments';
import { salesGeneration, saleInGeneration } from './sales-reset.js';

export const CLOUD=import.meta.env.VITE_BACKEND==='cloud';
export const WORKER_URL=(import.meta.env.VITE_WORKER_URL||'').replace(/\/$/,'');
const VAPID=import.meta.env.VITE_FIREBASE_VAPID_KEY||'';
const app=initializeApp(firebaseConfig);
const auth=getAuth(app), db=getFirestore(app);
const adminApp=initializeApp(firebaseConfig,'fnac-pulse-admin');
const adminAuth=getAuth(adminApp);
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
export async function sellerRegister(api,selection,name,pin) {
  const pinSalt=createPinSalt(),registrationId=createPinSalt();
  const newProof=await pinProof(firebaseConfig.projectId,selection.storeId,null,pin,pinSalt);
  const body={storeId:selection.storeId,departmentId:selection.departmentId,name,pinSalt,registrationId,newProof};let result;
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
// Un deuxième FirebaseApp en mémoire évite de déconnecter le vendeur ou
// l’administrateur courant. Le mot de passe va directement à Firebase Auth ;
// le Worker reçoit seulement le jeton signé du compte à autoriser.
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
