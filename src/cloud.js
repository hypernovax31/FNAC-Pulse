import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { getFirestore, doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebase-config';
import { pinProof } from './pin';
import { earliestDate, parisToday, summarize } from './cloud-stats';
import { comparePeople, orderServices, sellerStoreId } from './catalog';
import { createSaleAnnouncer } from './live-sales';

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
export async function sellerLogin(api,session,pin) {
  const proof=await pinProof(firebaseConfig.projectId,session.storeId,session.sellerId,pin);
  const result=await api('/api/auth/login',{method:'POST',body:{...session,proof}});
  const user=(await signInWithCustomToken(auth,result.customToken)).user;
  const {claims}=await user.getIdTokenResult();
  if(claims.role!=='seller'||claims.storeId!==session.storeId||claims.sellerId!==session.sellerId||typeof claims.accessVersion!=='string'||!claims.accessVersion){await signOut(auth);throw new Error('Connexion invalide. Réessayez.');}
  return {storeId:claims.storeId,sellerId:claims.sellerId,uid:user.uid,accessVersion:claims.accessVersion};
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
export async function setPin(api,token,storeId,sellerId,pin) {
  const proof=await pinProof(firebaseConfig.projectId,storeId,sellerId,pin);
  return api('/api/admin/pin',{method:'POST',token,body:{storeId,sellerId:Number(sellerId),proof}});
}
function presentation(catalog,storeId) {
  return {
    stores:catalog.stores.filter(x=>x.active).map(({active,...x})=>x),
    sellers:catalog.sellers.filter(x=>x.active).sort(comparePeople).map(x=>({id:x.id,name:x.name,storeId:sellerStoreId(x)})),
    services:orderServices(catalog.services.filter(x=>x.active),catalog.serviceOrders,storeId).map(({id,name,icon})=>({id,name,icon})),
  };
}
export function listenStore(session,day,clientId,onChange,onSale,onError,onGoalsChanged=()=>{}) {
  let catalog=null,sales=[],catalogReady=false,salesReady=false,catalogCache=true,salesCache=true,initial=true;
  const announcer=createSaleAnnouncer(onSale);
  let goalRevision=Symbol('premier chargement');
  const emit=()=>{if(catalogReady&&salesReady){const scoped={...catalog,services:orderServices(catalog.services,catalog.serviceOrders,session.storeId)};onChange({...presentation(scoped,session.storeId),today:day,stats:summarize(scoped,sales,session.sellerId,day)},!(catalogCache||salesCache));}};
  const stopAccess=onSnapshot(doc(db,'pulseStatus',session.uid),snap=>{
    if(snap.metadata.fromCache)return;
    const access=snap.data();
    if(!snap.exists()||!access.active||access.version!==session.accessVersion||access.storeId!==session.storeId||access.sellerId!==session.sellerId){const error=new Error('Accès modifié. Reconnectez-vous.');error.code='permission-denied';onError(error);return;}
    const revision=access.goalsRevision||null;
    if(revision!==goalRevision){goalRevision=revision;onGoalsChanged();}
  },onError);
  const stopCatalog=onSnapshot(doc(db,'pulse','catalog'),{includeMetadataChanges:true},snap=>{
    if(!snap.exists()){onError(new Error('Catalogue indisponible.'));return;}
    catalog=snap.data();catalogCache=snap.metadata.fromCache;catalogReady=true;announcer.setCatalog(catalog);emit();
  },onError);
  const q=query(collection(db,'pulseStores',session.storeId,'sales'),where('businessDate','>=',earliestDate(day)));
  const stopSales=onSnapshot(q,{includeMetadataChanges:true},snap=>{
    if(!initial)for(const change of snap.docChanges())if(change.type==='added') {
      const sale=change.doc.data();if(sale.source==='sale'&&!sale.deletedAt&&sale.clientId!==clientId)announcer.add(sale);
    }
    initial=false;sales=snap.docs.map(x=>x.data());salesCache=snap.metadata.fromCache;salesReady=true;emit();
  },onError);
  return ()=>{stopAccess();stopCatalog();stopSales();};
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
