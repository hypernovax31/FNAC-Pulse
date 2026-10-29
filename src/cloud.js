import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { getFirestore, doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebase-config';
import { pinProof } from './pin';
import { earliestDate, parisToday, summarize } from './cloud-stats';
import { comparePeople, orderServices, sellerStoreId } from './catalog';
import { createSaleAnnouncer } from './live-sales';
import { sellerDepartmentId, saleDepartmentId } from './departments';

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
export async function sellerLogin(api,session,pin) {
  const proof=await pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,pin);
  const result=await api('/api/auth/login',{method:'POST',body:{...session,openPinFlow:true,proof}});
  return completeSellerLogin(result,session);
}
export async function sellerChoosePin(api,session,pin) {
  const newProof=await pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,pin);
  const result=await api('/api/auth/claim',{method:'POST',body:{...session,newProof}});
  return completeSellerLogin(result,session,true);
}
export async function sellerLogout() {await signOut(auth);}
export async function adminLogin(email,password) {
  try {await setPersistence(adminAuth,browserSessionPersistence);await signInWithEmailAndPassword(adminAuth,email,password);}
  catch {throw new Error('E-mail ou mot de passe administrateur incorrect.');}
  return ADMIN_SESSION;
}
export async function adminLogout() {await signOut(adminAuth);}
export async function changeAdminPassword(currentPassword,newPassword) {
  await adminAuth.authStateReady();const user=adminAuth.currentUser;
  if(!user?.email)throw new Error('Session administrateur expirée.');
  if(newPassword.length<12)throw new Error('Le mot de passe doit comporter au moins 12 caractères.');
  try {await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,currentPassword));await updatePassword(user,newPassword);}
  catch {throw new Error('Mot de passe actuel incorrect ou modification impossible.');}
}
function presentation(catalog,storeId) {
  return {
    stores:catalog.stores.filter(x=>x.active).map(({active,...x})=>x),
    sellers:catalog.sellers.filter(x=>x.active).sort(comparePeople).map(x=>({id:x.id,name:x.name,storeId:sellerStoreId(x),departmentId:sellerDepartmentId(x)})),
    departmentsByStore:catalog.departmentsByStore||{},
    services:orderServices(catalog.services.filter(x=>x.active),catalog.serviceOrders,storeId).map(({id,name,icon})=>({id,name,icon})),
  };
}
export function listenStore(session,day,clientId,onChange,onSale,onError,onGoalsChanged=()=>{},onSummaryChanged=()=>{}) {
  let catalog=null,sales=[],catalogReady=false,salesReady=false,catalogCache=true,salesCache=true,initial=true;
  const announcer=createSaleAnnouncer(sale=>{
    const self=catalog?.sellers.find(s=>Number(s.id)===Number(session.sellerId)&&sellerStoreId(s)===session.storeId);
    if(self&&saleDepartmentId(sale)===sellerDepartmentId(self))onSale(sale);
  });
  let goalRevision=Symbol('premier chargement'),summaryRevision=Symbol('premier chargement'),catalogSignature='';
  const emit=()=>{if(catalogReady&&salesReady){const scoped={...catalog,services:orderServices(catalog.services,catalog.serviceOrders,session.storeId)};onChange({...presentation(scoped,session.storeId),today:day,stats:summarize(scoped,sales,session.sellerId,day)},!(catalogCache||salesCache));}};
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
    const signature=JSON.stringify({sellers:catalog.sellers.filter(s=>sellerStoreId(s)===session.storeId).map(s=>[s.id,s.active,sellerDepartmentId(s)]),services:catalog.services.map(s=>[s.id,s.active]),departments:catalog.departmentsByStore?.[session.storeId]||null});
    if(!snap.metadata.fromCache&&signature!==catalogSignature){catalogSignature=signature;onSummaryChanged();}
    announcer.setCatalog(catalog);emit();
  },onError);
  const stopSummary=onSnapshot(doc(db,'pulseStores',session.storeId,'sales','~summary-goals~'),{includeMetadataChanges:true},snap=>{
    if(snap.metadata.fromCache)return;
    const revision=snap.data()?.revision||null;
    if(revision!==summaryRevision){summaryRevision=revision;onSummaryChanged();}
  },onError);
  const q=query(collection(db,'pulseStores',session.storeId,'sales'),where('businessDate','>=',earliestDate(day)));
  const stopSales=onSnapshot(q,{includeMetadataChanges:true},snap=>{
    if(!initial)for(const change of snap.docChanges())if(change.type==='added') {
      const sale=change.doc.data();if(sale.source==='sale'&&!sale.deletedAt&&sale.clientId!==clientId)announcer.add(sale);
    }
    initial=false;sales=snap.docs.map(x=>x.data());salesCache=snap.metadata.fromCache;salesReady=true;emit();
  },onError);
  return ()=>{stopAccess();stopCatalog();stopSummary();stopSales();};
}
async function messaging() {
  if(!VAPID||VAPID==='cle-publique-web-push-firebase')throw new Error('La clé publique Web Push Firebase reste à configurer.');
  if(!(await isSupported()))throw new Error('Notifications non prises en charge sur cet appareil.');
  return getMessaging(app);
}
export async function subscribeFcm(api) {
  const m=await messaging(),registration=await navigator.serviceWorker.ready;
  const token=await getToken(m,{vapidKey:VAPID,serviceWorkerRegistration:registration});
  if(!token)throw new Error('Impossible de créer l’abonnement aux notifications.');
  await api('/api/push/subscribe',{method:'POST',body:{token}});
  localStorage.setItem('fnac-pulse-fcm-enabled','1');
}
export async function unsubscribeFcm(api) {
  const m=await messaging(),registration=await navigator.serviceWorker.ready;
  const token=await getToken(m,{vapidKey:VAPID,serviceWorkerRegistration:registration});
  let failure=null;
  try {if(token)await api('/api/push/subscribe',{method:'DELETE',body:{token}});} catch(e) {failure=e;}
  try {await deleteToken(m);} finally {localStorage.removeItem('fnac-pulse-fcm-enabled');}
  if(failure)throw failure;
}
export function notificationsWanted() {return localStorage.getItem('fnac-pulse-fcm-enabled')==='1';}
