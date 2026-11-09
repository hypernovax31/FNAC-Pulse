import React, { useEffect, useRef, useState } from 'react';
import { VisibleFeedback, VisibleFeedbackProvider, useFeedbackState } from './VisibleFeedback';
import { ModalToastOutlet } from './AppToasts';
import { X, LockKeyhole, ArrowRight, Plus, Check, Pencil, Archive, RotateCcw, LogOut, ShieldCheck, Store, Info, ArrowUp, ArrowDown, Trash2, ChevronDown } from 'lucide-react';
import { api } from './api';
import { CLOUD, ADMIN_SESSION, adminLogin, adminLogout, claimAdminAccess, resendAdminVerification } from './cloud';
import { AdminAccounts } from './AdminAccounts';
import { AdminRegistration } from './AdminRegistration';
import { AdminFirstPassword } from './AdminFirstPassword';
import { AdminCodeRegistration } from './AdminCodeRegistration';
import { sellersForStore, orderServices, serviceRemovedForStore } from './catalog';
import { departmentsForStore, sellerDepartmentId } from './departments';
import { GoalForm } from './Goals';
import { SellerCard } from './SellerCard';
import { SalesResetPanel } from './SalesReset';
import { SalesHistoryPanel } from './SalesHistory';
import { GoalsResetPanel } from './GoalsReset';
import { SellerDeletePanel } from './SellerDelete';
import { ServiceDeletePanel } from './ServiceDelete';
import { AdminTabs } from './AdminTabs';
import { normalizeWorkdays, validWorkdays, WORKDAY_NAMES, WORKDAY_ORDER } from './goals.js';
import { displayStoreName, isSelectableStore, storeSelectionGroups } from './store-directory.js';
import { StoreSearch } from './StoreSearch';
import { AdminInvitationHelp } from './AdminInvitationHelp';

const MANAGED_STORE_KEY='pulse-admin-managed-store-v1';
function rememberedStore() {try{return sessionStorage.getItem(MANAGED_STORE_KEY)||'';}catch{return '';}}
function rememberStore(id) {try{if(id)sessionStorage.setItem(MANAGED_STORE_KEY,id);else sessionStorage.removeItem(MANAGED_STORE_KEY);}catch{}}

function Modal({title,subtitle,onClose,children,wide=false,fixedTabs=false}) {
  const dialog=useRef(null),close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const previous=document.body.style.overflow,previousFocus=document.activeElement;
    document.body.style.overflow='hidden';
    if(!dialog.current?.contains(document.activeElement))dialog.current?.querySelector('.close-button')?.focus();
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();close.current();return;}
      if(event.key!=='Tab'||!dialog.current)return;
      const items=[...dialog.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href], [tabindex]:not([tabindex="-1"])')].filter(x=>x.getClientRects().length);
      if(!items.length)return;
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
    };
    document.addEventListener('keydown',onKeyDown);
    return ()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',onKeyDown);previousFocus?.focus?.();};
  },[]);
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget) onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'modal-wide':''} ${fixedTabs?'admin-modal':''}`}>
      <VisibleFeedbackProvider>
        <div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button close-button" aria-label="Fermer" onClick={onClose}><X size={19}/></button></div>
        <div className={`modal-content ${fixedTabs?'modal-content-fixed-tabs':''}`}>{children}</div>
        <ModalToastOutlet/>
      </VisibleFeedbackProvider>
    </div>
  </div>;
}

export default function Admin({onClose,data,session,onChanged}) {
  const [token,setToken]=useState(()=>sessionStorage.getItem('pulse-admin-token')||'');
  const [password,setPassword]=useState('');
  const [email,setEmail]=useState('');
  const [firstPassword,setFirstPassword]=useState(false),[firstTemporary,setFirstTemporary]=useState(''),[firstBusy,setFirstBusy]=useState(false),[codeRegistration,setCodeRegistration]=useState(false);
  const [manualRegistration,setManualRegistration]=useState(false),[approvalWaiting,setApprovalWaiting]=useState(false);
  const [error,setError,errorRevision]=useFeedbackState('');
  const [notice,setNotice,noticeRevision]=useFeedbackState('');
  const [busy,setBusy]=useState(false);
  const [all,setAll]=useState({sellers:[],services:[],serviceOrders:{},serviceRemovalsByStore:{},departmentsByStore:{}});
  const [adminStore,setAdminStore]=useState(()=>{
    const saved=token&&rememberedStore(),fallback=session?.storeId||'';
    return [saved,fallback].find(id=>id&&isSelectableStore(data.stores.find(s=>s.id===id)))||'';
  });
  const [storeDraft,setStoreDraft]=useState(adminStore),[storeDraftUnselected,setStoreDraftUnselected]=useState(false);
  const [tab,setTab]=useState(()=>adminStore?'sales':'stores');
  const [adminSeller,setAdminSeller]=useState(session?.sellerId&&session.storeId===adminStore?String(session.sellerId):'');
  const [allLoaded,setAllLoaded]=useState(false);
  const [adminGoals,setAdminGoals]=useState(null);
  const [adminWorkdays,setAdminWorkdays]=useState(null);
  const [goalsFor,setGoalsFor]=useState('');
  const [goalsLoading,setGoalsLoading]=useState(false);
  const goalScope=useRef('');goalScope.current=`${adminStore}:${adminSeller}:${tab}`;
  const [name,setName]=useState('');
  const [newSellerDepartment,setNewSellerDepartment]=useState('');
  // Aucun planning précoché : chaque création exige un choix explicite.
  const [newSellerWorkdays,setNewSellerWorkdays]=useState([]);
  const [expandedSeller,setExpandedSeller]=useState(null);
  const [serviceDeleteRequest,setServiceDeleteRequest]=useState(null);
  const [serviceDeleteReady,setServiceDeleteReady]=useState(false);
  const [editing,setEditing]=useState(null);
  const [editName,setEditName]=useState('');
  const [newStore,setNewStore]=useState({name:'',lat:'',lon:''});
  const [oldPass,setOldPass]=useState('');
  const [newPass,setNewPass]=useState('');

  async function loadAll(auth=token) {
    try { const result=await api('/api/admin/all',{token:auth}); setAll(result);setAllLoaded(true); }
    catch(e) { if (e.status===401||/expirée/.test(e.message)) {setToken('');sessionStorage.removeItem('pulse-admin-token');rememberStore('');setAdminStore('');setStoreDraft('');setAdminSeller('');} setError(e.message); }
  }
  useEffect(()=>{if(token) loadAll(token);},[token]);
  useEffect(()=>{if(token&&adminStore)rememberStore(adminStore);},[token,adminStore]);
  useEffect(()=>{
    if(token){const saved=rememberedStore();if(saved&&!isSelectableStore(data.stores.find(s=>s.id===saved)))rememberStore('');}
    if(adminStore&&!isSelectableStore(data.stores.find(s=>s.id===adminStore))){setAdminStore('');setStoreDraft('');setAdminSeller('');rememberStore('');}
  },[token,adminStore,data.stores]);
  useEffect(()=>{
    if(allLoaded&&adminSeller&&!sellersForStore(all.sellers,adminStore).some(s=>String(s.id)===String(adminSeller)))setAdminSeller('');
  },[all,allLoaded,adminStore,adminSeller]);

  function applyAdminGoals(result) {
    setAdminGoals(result.goals);setAdminWorkdays(normalizeWorkdays(result.workdays));
  }
  useEffect(()=>{
    if(!token||!adminStore||!adminSeller||tab!=='goals')return;
    let cancelled=false;setGoalsFor('');setAdminGoals(null);setAdminWorkdays(null);setGoalsLoading(true);
    api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token}).then(result=>{
      if(!cancelled){applyAdminGoals(result);setGoalsFor(`${adminStore}:${adminSeller}`);}
    }).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setGoalsLoading(false)});
    return ()=>{cancelled=true};
  },[token,adminStore,adminSeller,tab]);
  async function saveAdminGoals(body) {
    const scope=`${adminStore}:${adminSeller}:${tab}`;setBusy(true);setError('');setNotice('');
    try {
      const result=await api('/api/admin/goals',{method:'POST',token,body:{...body,storeId:adminStore,sellerId:Number(adminSeller)}});
      if(goalScope.current===scope)applyAdminGoals(result);
      onChanged();return result;
    } catch(e) {
      if(e.status===409&&goalScope.current===scope) {
        try{const latest=await api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token});if(goalScope.current===scope)applyAdminGoals(latest);}catch{}
      }
      throw e;
    } finally {setBusy(false);}
  }
  async function refreshAfterGoalsReset() {
    const scope=`${adminStore}:${adminSeller}:${tab}`;
    if(adminStore&&adminSeller&&tab==='goals') {
      try {
        const latest=await api(`/api/admin/goals?storeId=${encodeURIComponent(adminStore)}&sellerId=${encodeURIComponent(adminSeller)}`,{token});
        if(goalScope.current===scope)applyAdminGoals(latest);
      } catch { /* La prochaine sélection rechargera les données. */ }
    }
    onChanged();
  }
  async function login(e,acceptInvitation=false) {
    e?.preventDefault();if(busy)return;
    if(acceptInvitation&&(!email.trim()||!password)){setError('Renseignez l’e-mail invité et votre mot de passe.');return;}
    setBusy(true);setError('');setNotice('');
    try {
      let auth;
      if(CLOUD){
        auth=await adminLogin(email,password);
        try {
          if(acceptInvitation)await api('/api/auth/admin-invitations/accept',{method:'POST',token:auth,body:{confirmed:true}});
          let status;
          try {status=await api('/api/auth/admin-account-status',{method:'POST',token:auth,body:{}});}
          catch(statusError) {
            if(acceptInvitation||statusError.status!==403||/Confirmez/.test(statusError.message))throw statusError;
            // Une connexion après le lien Firebase accepte l’invitation : le
            // Worker exige l’adresse vérifiée avant toute attribution. Les
            // anciennes demandes sans e-mail gardent leur validation manuelle.
            let accepted=false,inviteError;
            const accept=()=>api('/api/auth/admin-invitations/accept',{method:'POST',token:auth,body:{confirmed:true}});
            try {
              try {await accept();}catch(e){if(e?.status&&e.status<500&&e.status!==408)throw e;await accept();}
              accepted=true;
            } catch(e){
              // Une invitation e-mail valide doit être confirmée, même si une
              // ancienne demande manuelle existe pour la même adresse.
              if(e?.status===403&&/Confirmez d’abord l’adresse e-mail du compte invité/.test(e.message))throw e;
              if(e?.status===403)inviteError=e;
              else if(!e?.status||e.status>=500)throw new Error('Accès non confirmé. Reconnectez-vous avec les mêmes identifiants.');
              else throw e;
            }
            if(!accepted) {
              let claim;
              try {claim=await claimAdminAccess(api);}catch(e){if(e.status===403&&inviteError)throw inviteError;throw e;}
              if(claim.status==='pending'){setEmail(email.trim().toLowerCase());setPassword('');setApprovalWaiting(true);return;}
            }
            status=await api('/api/auth/admin-account-status',{method:'POST',token:auth,body:{}});
          }
          if(status.passwordChangeRequired){setFirstTemporary(status.method==='code'?'':password);setFirstPassword(status.method==='code'?'code':'direct');setPassword('');return;}
          if(status.reauthenticate) {
            // Les jetons Firebase ont une précision d'une seconde. Attendre un
            // instant avant de se reconnecter avec le nouveau mot de passe.
            await new Promise(resolve=>setTimeout(resolve,1100));
            await adminLogin(email,password);
            status=await api('/api/auth/admin-account-status',{method:'POST',token:auth,body:{}});
            if(status.reauthenticate)throw new Error('Patientez un instant puis reconnectez-vous avec votre nouveau mot de passe.');
          }
          await api('/api/admin/all',{token:auth});
        }catch(e){
          await adminLogout();
          throw e;
        }
      } else {const result=await api('/api/admin/login',{method:'POST',body:{password}});auth=result.token;}
      sessionStorage.setItem('pulse-admin-token',auth);setToken(auth);setPassword('');
      if(acceptInvitation)setNotice('Invitation acceptée. Vous disposez maintenant des droits administrateur.');
    }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function manualRegistered(address) {
    setEmail(address);setPassword('');setError('');setNotice('');setManualRegistration(false);setApprovalWaiting(true);
  }
  async function verifyApproval() {
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const status=await api('/api/auth/admin-access/status',{method:'POST',token:ADMIN_SESSION,body:{}});
      if(status.status==='pending'){setNotice('Votre demande attend toujours la validation d’un administrateur.');return;}
      if(status.status!=='approved')throw new Error('La validation ne peut pas encore être confirmée.');
      await api('/api/admin/all',{token:ADMIN_SESSION});
      sessionStorage.setItem('pulse-admin-token',ADMIN_SESSION);setApprovalWaiting(false);setToken(ADMIN_SESSION);
      setNotice('Votre accès administrateur est validé.');
    } catch(e){setError(e.message||'Impossible de vérifier la validation. Réessayez.');}
    finally{setBusy(false);}
  }
  async function leaveApproval(close=false) {
    try{await adminLogout();}catch{}
    setApprovalWaiting(false);setError('');setNotice('');setPassword('');
    if(close)onClose();
  }
  async function codeRegistered(address) {
    const status=await api('/api/auth/admin-account-status',{method:'POST',token:ADMIN_SESSION,body:{}});
    if(!status.passwordChangeRequired||status.method!=='code')throw new Error('La première connexion n’a pas pu être confirmée. Reprenez avec le même code et les mêmes informations.');
    setEmail(address);setPassword('');setFirstTemporary('');setCodeRegistration(false);setFirstPassword('code');
  }
  async function cancelCodeRegistration() {
    if(firstBusy)return;
    try{await adminLogout();}catch{}
    setCodeRegistration(false);setError('');
  }
  async function finishFirstPassword(newPassword) {
    let status=await api('/api/auth/admin-account-status',{method:'POST',token:ADMIN_SESSION,body:{}});
    if(status.passwordChangeRequired)throw new Error('Le changement de mot de passe n’a pas encore été confirmé.');
    if(status.reauthenticate&&newPassword) {
      // Une nouvelle connexion rend inutilisable l'ancien jeton associé au
      // mot de passe provisoire ; la session vendeur reste indépendante.
      await new Promise(resolve=>setTimeout(resolve,1100));
      await adminLogin(email,newPassword);
      status=await api('/api/auth/admin-account-status',{method:'POST',token:ADMIN_SESSION,body:{}});
    }
    if(status.reauthenticate) {
      await adminLogout();setFirstPassword(false);setFirstTemporary('');setPassword('');
      setNotice('Votre mot de passe est enregistré. Reconnectez-vous avec votre nouveau mot de passe.');return;
    }
    if(status.passwordChangeRequired)throw new Error('Le changement de mot de passe n’a pas encore été confirmé.');
    await api('/api/admin/all',{token:ADMIN_SESSION});
    sessionStorage.setItem('pulse-admin-token',ADMIN_SESSION);setFirstPassword(false);setFirstTemporary('');setToken(ADMIN_SESSION);
    setNotice('Votre mot de passe personnel est enregistré.');
  }
  async function cancelFirstPassword() {
    if(firstBusy)return;
    try{await adminLogout();}catch{}
    setFirstPassword(false);setFirstTemporary('');setPassword('');setError('');
  }
  async function logout() {
    try {if(CLOUD)await adminLogout();else await api('/api/admin/logout',{method:'POST',token,body:{}})} catch {}
    sessionStorage.removeItem('pulse-admin-token');rememberStore('');setAdminStore('');setStoreDraft('');setAdminSeller('');setName('');setNewSellerDepartment('');setNewSellerWorkdays([]);setToken('');setNotice('');
  }
  async function run(work, success) {
    setBusy(true);setError('');setNotice('');
    try {await work();if(success)setNotice(success);await loadAll();onChanged();}
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  function closeAdministration(){onClose();}
  function switchTab(next){if(next!==tab)setServiceDeleteReady(false);if(next==='stores')setStoreDraft(adminStore);setTab(next);setError('');setNotice('');setEditing(null);setName('');setNewSellerDepartment('');setNewSellerWorkdays([]);setExpandedSeller(null);setServiceDeleteRequest(null);}
  function changeStore(value){
    if(!isSelectableStore(data.stores.find(s=>s.id===value)))return;
    setAdminStore(value);setStoreDraft(value);rememberStore(value);setAdminSeller('');setEditing(null);setName('');setNewSellerDepartment('');setNewSellerWorkdays([]);setExpandedSeller(null);setServiceDeleteRequest(null);setServiceDeleteReady(false);setError('');setNotice('');
  }
  function toggleNewSellerWorkday(day) {
    setNewSellerWorkdays(current=>WORKDAY_ORDER.filter(value=>value===day?!current.includes(value):current.includes(value)));
  }
  const activeSellers=sellersForStore(all.sellers,adminStore);
  const storeSellers=sellersForStore(all.sellers,adminStore,{activeOnly:false});
  const storeDepartments=adminStore?departmentsForStore(all,adminStore,{activeOnly:false}):[];
  const activeDepartments=storeDepartments.filter(d=>d.active);
  const departmentForNewSeller=activeDepartments.some(d=>d.id===newSellerDepartment)?newSellerDepartment:'';
  const allOrderedServices=orderServices(all.services,all.serviceOrders,adminStore);
  const orderedServices=allOrderedServices.filter(s=>!serviceRemovedForStore(all,adminStore,s.id));
  const removedServices=allOrderedServices.filter(s=>serviceRemovedForStore(all,adminStore,s.id));
  const activeServices=orderedServices.filter(s=>s.active);
  const adminStoreRecord=data.stores.find(s=>s.id===adminStore),adminStoreName=adminStoreRecord?.name||'';
  const adminStoreDisplay=adminStoreRecord?displayStoreName(adminStoreRecord):'';
  const needsStore=['sales','goals','departments','sellers','services'].includes(tab);
  function moveService(index,offset) {
    const ids=orderedServices.map(s=>s.id),target=index+offset;
    if(target<0||target>=ids.length)return;
    [ids[index],ids[target]]=[ids[target],ids[index]];
    // L'API conserve la liste commune complète ; les services retirés de ce
    // magasin sont placés à la fin sans revenir dans sa liste visible.
    const complete=[...ids,...removedServices.map(s=>s.id)];
    run(()=>api('/api/admin/services/order',{method:'POST',token,body:{storeId:adminStore,serviceIds:complete}}),'Ordre enregistré pour ce magasin.');
  }

  if(firstPassword) return <Modal title="Créez votre mot de passe" subtitle="Une seule étape avant votre première connexion." onClose={()=>{if(!firstBusy){cancelFirstPassword();onClose();}}}>
    <AdminFirstPassword email={email} method={firstPassword} temporaryPassword={firstTemporary} onFinish={finishFirstPassword} onCancel={cancelFirstPassword} onBusy={setFirstBusy}/>
  </Modal>;

  if(codeRegistration&&!token) return <Modal title="Créer mon accès administrateur" subtitle="Avec un code transmis en privé." onClose={()=>{if(!firstBusy){cancelCodeRegistration();onClose();}}}>
    <AdminCodeRegistration onRegistered={codeRegistered} onCancel={cancelCodeRegistration} onBusy={setFirstBusy}/>
  </Modal>;

  if(manualRegistration&&!token) return <Modal title="Première connexion" subtitle="Créez votre compte administrateur." onClose={()=>{if(!firstBusy){setManualRegistration(false);onClose();}}}>
    <AdminRegistration initialEmail={email} onRegistered={manualRegistered} onCancel={()=>{setManualRegistration(false);setError('');setNotice('');}} onBusy={setFirstBusy}/>
  </Modal>;

  if(approvalWaiting&&!token) return <Modal title="Demande en attente" subtitle="Votre accès doit être validé." onClose={()=>leaveApproval(true)}>
    <div className="admin-waiting">
      <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Demande en attente</strong><p>{email}</p></div></div>
      <p>Montrez cet écran à un administrateur, qui vérifiera votre identité par un autre moyen avant de valider votre accès. Votre adresse n’est pas vérifiée automatiquement.</p>
      <p>Vous n’avez pas encore accès à l’administration. Aucun e-mail ne sera envoyé.</p>
      <VisibleFeedback message={notice} revision={noticeRevision}/><VisibleFeedback message={error} tone="error" revision={errorRevision}/>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {notice&&<div className="admin-alert success" role="status">{notice}</div>}
      <button type="button" className="primary-button full-button" disabled={busy} onClick={verifyApproval}>{busy?'Vérification…':'Vérifier la validation'} <ArrowRight size={16}/></button>
      <button type="button" className="text-button admin-first-retry" disabled={busy} onClick={()=>leaveApproval(false)}>Retour à la connexion</button>
    </div>
  </Modal>;

  if(!token) return <Modal title="Espace administrateur" subtitle="Un accès réservé pour gérer votre espace." onClose={onClose}>
    <div className="admin-login-illustration"><div className="admin-lock"><LockKeyhole size={24}/></div><div><strong>Gardez la main sur votre équipe.</strong><p>Gérez les vendeurs, les services et les ventes du jour.</p></div></div>
    <form onSubmit={login} className="admin-login-form">
      {CLOUD&&<><label className="form-label" htmlFor="admin-email">E-mail administrateur</label><input id="admin-email" className="text-input" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus/></>}
      <label className="form-label" htmlFor="admin-password">Mot de passe administrateur</label>
      <input id="admin-password" className="text-input" type="password" placeholder="Votre mot de passe" value={password} onChange={e=>setPassword(e.target.value)} required autoFocus={!CLOUD} autoComplete="current-password" />
      <VisibleFeedback message={notice} revision={noticeRevision}/><VisibleFeedback message={error} tone="error" revision={errorRevision}/>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
      {CLOUD&&/Confirmez (votre adresse|d’abord l’adresse) e-mail/.test(error)&&<button type="button" className="outline-button full-button" disabled={busy} onClick={async()=>{
        setBusy(true);setNotice('');
        try {const result=await resendAdminVerification(email,password);setError('');setNotice(result.verified?'Adresse déjà confirmée. Vous pouvez vous connecter.':'Nouveau lien envoyé. Vérifiez votre boîte e-mail.');}
        catch(e){setError(e.message);}finally{setBusy(false);}
      }}>Renvoyer le lien de confirmation</button>}
      <button className="primary-button full-button" type="submit" disabled={busy}>{busy?'Connexion…':'Se connecter'} <ArrowRight size={16}/></button>
      {CLOUD&&<p className="admin-login-hint">Vous avez reçu une invitation ? Créez votre mot de passe depuis le lien ou connectez-vous ici avec votre mot de passe habituel.</p>}
      {CLOUD&&<details className="admin-legacy-invitations"><summary>Anciennes demandes</summary>
        <div className="admin-invitation-accept"><strong>Demande sans e-mail</strong><p>Pour une adresse ajoutée avant cette mise à jour.</p><button type="button" className="outline-button full-button" disabled={busy} onClick={()=>{setError('');setNotice('');setManualRegistration(true);}}>Première connexion · Créer mon compte</button></div>
        <div className="admin-invitation-accept"><strong>Invitation avec un code</strong><p>Utilisez cette option uniquement pour un code reçu précédemment.</p><button type="button" className="outline-button full-button" disabled={busy} onClick={()=>{setError('');setNotice('');setCodeRegistration(true);}}>Créer mon accès avec un code</button></div>
      </details>}
      <p className="form-footnote"><ShieldCheck size={14}/> L’accès administrateur est protégé par mot de passe.</p>
    </form>
    {CLOUD&&<AdminInvitationHelp email={email} busy={busy} onBusy={setBusy} onCompleted={address=>{setEmail(address);setPassword('');}} onVerified={setEmail}/>}
  </Modal>;

  return <Modal title="Administration" subtitle={adminStoreDisplay?`Magasin sélectionné : ${adminStoreDisplay}`:'Choisissez un magasin dans l’onglet Magasins.'} onClose={closeAdministration} wide fixedTabs>
    <AdminTabs tab={tab} onSelect={switchTab} disabled={busy}/>
    <div key={tab} className="admin-scroll-content">
    <VisibleFeedback message={notice} revision={noticeRevision}/><VisibleFeedback message={error} tone="error" revision={errorRevision}/>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
    <div className="admin-body">
      {needsStore&&!adminStore&&<div className="empty-admin">Choisissez d’abord le magasin dans l’onglet <button type="button" className="admin-inline-link" onClick={()=>switchTab('stores')}>Magasins</button>.</div>}
      {tab==='sales'&&adminStore&&<>
        <SalesHistoryPanel key={`history:${adminStore}`} storeId={adminStore} storeName={adminStoreName} sellers={storeSellers} services={all.services} additionServices={orderedServices} departments={storeDepartments} today={data.today} token={token} disabled={busy||!allLoaded} onBusy={setBusy} onReload={()=>{loadAll();onChanged();}} onUpdate={onChanged}/>
        <SalesResetPanel key={`reset:${adminStore}`} storeId={adminStore} storeName={adminStoreName} token={token} disabled={busy} onUpdate={onChanged}/>
      </>}
      {tab==='goals'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Objectifs par vendeur</h3><p>Définissez les objectifs par service. Les jours travaillés se règlent dans chaque fiche de l’onglet Vendeurs.</p></div></div>
        <div className="admin-selects admin-selects-single"><label><span className="form-label">Vendeur</span><select aria-label="Vendeur pour les objectifs" className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>setAdminSeller(e.target.value)}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label></div>
        {adminSeller ? goalsFor===`${adminStore}:${adminSeller}`&&adminGoals&&adminWorkdays ? <React.Fragment key={`${adminStore}:${adminSeller}`}>
          <section className="admin-goals-services" aria-labelledby="admin-goals-services-title"><div className="workdays-heading"><div><h4 id="admin-goals-services-title">Services</h4><p>Définissez un minimum et sa période de référence pour chaque service.</p></div></div><GoalForm services={activeServices} goals={adminGoals} workdays={adminWorkdays} date={data.today} onSave={saveAdminGoals} disabled={busy} showPlanning admin/></section>
        </React.Fragment> : <div className="empty-admin">{goalsLoading?'Chargement des objectifs…':'Objectifs indisponibles. Réessayez en changeant de sélection.'}</div> : <div className="empty-admin">Sélectionnez un vendeur pour gérer ses objectifs.</div>}
        <div className="admin-note"><Info size={15}/> Les objectifs se répètent et toute modification s’applique aux périodes suivantes.</div>
        <GoalsResetPanel key={adminStore} storeId={adminStore} storeName={adminStoreName} departments={storeDepartments} token={token} disabled={busy||!allLoaded} onUpdate={refreshAfterGoalsReset}/>
      </>}
      {tab==='departments'&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>Départements du magasin</h3><p>Renommez, ajoutez ou archivez les départements de ce magasin. Archivez les vendeurs actifs avant d’archiver leur département.</p></div></div>
        <form className="add-entity" onSubmit={e=>{e.preventDefault();if(!name.trim())return;run(async()=>{await api('/api/admin/departments',{method:'POST',token,body:{storeId:adminStore,name}});setName('');},'Département ajouté.');}}>
          <input className="text-input" aria-label="Nom du département" placeholder="Nom du département" value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
          <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter</button>
        </form>
        <div className="entity-list">{storeDepartments.map(item=><div className={`entity-row ${!item.active?'is-archived':''}`} key={item.id}>
          {editing===item.id?<form className="edit-entity" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/api/admin/departments/${item.id}`,{method:'PATCH',token,body:{storeId:adminStore,name:editName}});setEditing(null);},'Département renommé.');}}><input className="text-input" aria-label={`Nouveau nom de ${item.name}`} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus maxLength={60} required/><button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" onClick={()=>setEditing(null)}><X size={17}/></button></form>:<><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Archivé</span>}</div><div className="entity-actions"><button className="icon-button" aria-label={`Modifier ${item.name}`} title="Modifier" disabled={busy} onClick={()=>{setEditing(item.id);setEditName(item.name)}}><Pencil size={15}/></button><button className="icon-button" aria-label={`${item.active?'Archiver':'Restaurer'} ${item.name}`} title={item.active?'Archiver':'Restaurer'} disabled={busy} onClick={()=>{if(item.active&&!window.confirm(`Archiver « ${item.name} » ? Son historique sera conservé.`))return;run(()=>api(`/api/admin/departments/${item.id}`,{method:'PATCH',token,body:{storeId:adminStore,active:!item.active}}),item.active?'Département archivé.':'Département restauré.');}}>{item.active?<Archive size={15}/>:<RotateCcw size={15}/>}</button></div></>}
        </div>)}</div>
        <div className="admin-note"><Info size={15}/> Les ventes déjà enregistrées restent attachées à leur département d’origine.</div>
      </>}
      {(tab==='sellers'||tab==='services')&&adminStore&&<>
        <div className="admin-section-heading"><div><h3>{tab==='sellers'?'Vendeurs':'Vos services'}</h3><p>{tab==='sellers'?'Ajoutez et gérez les vendeurs de ce magasin. L’archivage conserve leur historique.':'L’ordre et la suppression concernent ce magasin. Les noms des services restent communs à tous les magasins.'}</p></div></div>
        {!adminStore?<div className="empty-admin">Choisissez d’abord le magasin à gérer.</div>:<>
          {tab==='sellers'?<form className="add-seller" onSubmit={e=>{
            e.preventDefault();if(busy||!allLoaded||!name.trim()||!departmentForNewSeller||!validWorkdays(newSellerWorkdays))return;
            run(async()=>{
              await api('/api/admin/entities/sellers',{method:'POST',token,body:{name,storeId:adminStore,departmentId:departmentForNewSeller,workdays:newSellerWorkdays}});
              setName('');setNewSellerDepartment('');setNewSellerWorkdays([]);
            },'Vendeur ajouté dans ce magasin.');
          }}>
            <div className="add-seller-fields">
              <label><span className="form-label">PRÉNOM</span><input className="text-input" aria-label="Nom du vendeur" placeholder="Prénom du vendeur" value={name} onChange={e=>setName(e.target.value)} disabled={busy} required maxLength={60}/></label>
              <label><span className="form-label">DÉPARTEMENT</span><select className={`text-input ${departmentForNewSeller?'':'is-placeholder'}`} aria-label="Département du nouveau vendeur" value={departmentForNewSeller} onChange={e=>setNewSellerDepartment(e.target.value)} disabled={busy||!activeDepartments.length} required><option value="">Choisir un département</option>{activeDepartments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
            </div>
            <fieldset className="add-seller-workdays" aria-describedby="new-seller-workdays-hint" disabled={busy}>
              <legend>JOURS TRAVAILLÉS</legend>
              <div className="workdays-list">{WORKDAY_ORDER.map(day=><label key={day} className={`workday-option ${newSellerWorkdays.includes(day)?'is-selected':''}`}>
                <input type="checkbox" checked={newSellerWorkdays.includes(day)} onChange={()=>toggleNewSellerWorkday(day)}/><span>{WORKDAY_NAMES[day][0].toUpperCase()+WORKDAY_NAMES[day].slice(1)}</span>
              </label>)}</div>
              <p id="new-seller-workdays-hint">Sélectionnez au moins un jour habituel de travail.</p>
            </fieldset>
            <p className="seller-department-hint">Vérifiez le département : il ne pourra plus être modifié après la création du vendeur.</p>
            <button className="primary-button" disabled={busy||!allLoaded||!name.trim()||!departmentForNewSeller||!validWorkdays(newSellerWorkdays)}><Plus size={16}/> Ajouter le vendeur</button>
          </form>:<form className="add-entity" onSubmit={e=>{e.preventDefault();if(!name.trim())return;run(async()=>{await api('/api/admin/entities/services',{method:'POST',token,body:{name}});setName('');},'Service ajouté dans tous les magasins.');}}>
            <input className="text-input" aria-label="Nom du service" placeholder="Intitulé du service" value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/>
            <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter</button>
          </form>}
          {tab==='sellers' ? (storeSellers.length===0?<div className="empty-admin">Aucun vendeur dans ce magasin. Ajoutez le premier prénom ci-dessus.</div>:<div className="seller-card-list">{storeSellers.map(item=><SellerCard key={item.id}
            seller={item} departments={storeDepartments} storeId={adminStore} token={token} busy={busy}
            editing={editing===item.id} editName={editName} onEditName={setEditName}
            onEdit={()=>{setEditing(item.id);setEditName(item.name);}} onCancelEdit={()=>setEditing(null)}
            onRename={()=>run(async()=>{await api(`/api/admin/entities/sellers/${item.id}`,{method:'PATCH',token,body:{name:editName,storeId:adminStore}});setEditing(null);},'Nom modifié.')}
            onArchive={()=>{if(item.active&&!window.confirm(`Archiver « ${item.name} » ? Son historique sera conservé.`))return;run(()=>api(`/api/admin/entities/sellers/${item.id}`,{method:'PATCH',token,body:{active:!item.active,storeId:adminStore}}),item.active?'Élément archivé.':'Élément restauré.');}}
            workdaysOpen={expandedSeller===item.id} onToggleWorkdays={()=>setExpandedSeller(old=>old===item.id?null:item.id)} onBusy={setBusy} onChanged={onChanged}/>)}</div>)
          : (orderedServices.length===0?<div className="empty-admin">Aucun service dans ce magasin.</div>:<div className="entity-list">{orderedServices.map((item,index)=><div className={`entity-row service-entity-row ${!item.active?'is-archived':''}`} key={item.id}>
            {editing===item.id?<form className="edit-entity" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/api/admin/entities/services/${item.id}`,{method:'PATCH',token,body:{name:editName}});setEditing(null);},'Nom modifié.')}}><input className="text-input" aria-label={`Nouveau nom de ${item.name}`} value={editName} onChange={e=>setEditName(e.target.value)} autoFocus maxLength={60} required/><button className="icon-button" aria-label="Enregistrer le nom" title="Enregistrer" disabled={busy}><Check size={17}/></button><button className="icon-button" type="button" aria-label="Annuler la modification" title="Annuler" onClick={()=>setEditing(null)}><X size={17}/></button></form>
            :<><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Inactif</span>}</div><div className="entity-actions">
              <button className="icon-button order-button" aria-label={`Monter ${item.name}`} title="Monter" disabled={busy||index===0} onClick={()=>moveService(index,-1)}><ArrowUp size={16}/></button><button className="icon-button order-button" aria-label={`Descendre ${item.name}`} title="Descendre" disabled={busy||index===orderedServices.length-1} onClick={()=>moveService(index,1)}><ArrowDown size={16}/></button>
              <button className="icon-button" aria-label={`Modifier ${item.name}`} title="Modifier" disabled={busy} onClick={()=>{setEditing(item.id);setEditName(item.name);}}><Pencil size={15}/></button>
              {!item.active&&<button type="button" className="icon-button" aria-label={`Réactiver ${item.name} pour tous les magasins`} title="Réactiver pour tous les magasins" disabled={busy} onClick={()=>{if(!window.confirm(`Réactiver « ${item.name} » pour tous les magasins ? Ses données existantes seront conservées.`))return;run(()=>api(`/api/admin/entities/services/${item.id}`,{method:'PATCH',token,body:{active:true}}),'Service réactivé pour tous les magasins.');}}><RotateCcw size={15}/></button>}
              <button type="button" className="icon-button service-delete-icon" aria-label={`Supprimer ${item.name} de ${adminStoreName}`} title={`Supprimer ce service de ${adminStoreName}`} disabled={busy||!allLoaded||!serviceDeleteReady} onClick={()=>setServiceDeleteRequest({id:Number(item.id),name:item.name,storeName:adminStoreName})}><Trash2 size={16}/></button>
            </div></>}
          </div>)}</div>)}
          {tab==='services'&&<>
            <ServiceDeletePanel key={adminStore} storeId={adminStore} storeName={adminStoreName} token={token} disabled={busy||!allLoaded} requested={serviceDeleteRequest} onRequestHandled={()=>setServiceDeleteRequest(null)} onAvailabilityChange={setServiceDeleteReady} onUpdate={()=>{loadAll();onChanged();}}/>
            {removedServices.length>0&&<details className="removed-services"><summary>Services retirés de ce magasin ({removedServices.length})</summary><p>Vous pouvez réactiver un service pour ce magasin. Les ventes et objectifs effacés ne seront pas récupérés.</p><div className="entity-list">{removedServices.map(item=><div className="entity-row" key={item.id}><div className="entity-name"><strong>{item.name}</strong>{!item.active&&<span className="archived-label">Inactif partout</span>}</div><button type="button" className="small-outline-button" disabled={busy||!serviceDeleteReady} onClick={()=>{
              if(!window.confirm(`${item.active?'Réactiver':'Réintégrer'} « ${item.name} » dans ${adminStoreName} ? Les ventes et objectifs effacés ne seront pas restaurés.${!item.active?' Ce service restera inactif dans tous les magasins jusqu’à sa réactivation globale.':''}`))return;
              run(()=>api('/api/admin/services/restore',{method:'POST',token,body:{storeId:adminStore,serviceId:item.id,expectedName:item.name,expectedStoreName:adminStoreName}}),item.active?'Service réactivé pour ce magasin, sans récupérer les anciennes données.':'Service réintégré sans anciennes données ; il reste inactif dans tous les magasins.');
            }}>{item.active?'Réactiver':'Réintégrer'}</button></div>)}</div></details>}
          </>}
        </>}
      </>}
      {tab==='stores'&&<>
        <div className="admin-store-scope">
          <label htmlFor="admin-store-search" className="form-label">MAGASIN À GÉRER</label>
          <StoreSearch id="admin-store-search" label="Magasin à gérer" stores={storeSelectionGroups(data.stores).all} value={storeDraft} disabled={busy} onUnselectedChange={setStoreDraftUnselected} onChange={value=>{setStoreDraft(value);if(value)changeStore(value);}}/>
          <p id="admin-store-search-hint">{storeDraftUnselected?(adminStoreName?`Magasin toujours géré : ${adminStoreDisplay}. Choisissez un résultat pour changer.`:'Choisissez un magasin dans les résultats.'):'Dans cet onglet, ce choix reste mémorisé jusqu’à votre déconnexion administrateur et s’applique aux ventes, objectifs, vendeurs, services et codes PIN.'}</p>
          {data.stores.find(s=>s.id===adminStore)?.directoryStatus==='regional-choice'&&<p className="regional-choice-notice">Mention régionale sans magasin précis : les bilans sont communs et les notifications partagées entre vendeurs d’un même département. Ajoutez des magasins distincts si nécessaire.</p>}
        </div>
        <details className="admin-add-store">
          <summary><span className="admin-add-store-copy"><strong>Ajouter un magasin</strong><small>Un magasin absent de la liste ? Ajoutez-le à votre espace.</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
          <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/api/admin/stores',{method:'POST',token,body:newStore});setNewStore({name:'',lat:'',lon:''});},'Magasin ajouté.')}}>
            <label><span className="form-label">Nom du magasin</span><input className="text-input" required maxLength={60} placeholder="Ex. Fnac Bordeaux" value={newStore.name} onChange={e=>setNewStore(v=>({...v,name:e.target.value}))}/></label>
            <div className="admin-selects"><label><span className="form-label">Latitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="44.8399" value={newStore.lat} onChange={e=>setNewStore(v=>({...v,lat:e.target.value}))}/></label><label><span className="form-label">Longitude <span className="optional">(facultatif)</span></span><input className="text-input" type="number" step="any" placeholder="−0.5740" value={newStore.lon} onChange={e=>setNewStore(v=>({...v,lon:e.target.value}))}/></label></div>
            <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter le magasin</button>
          </form>
        </details>
        <div className="admin-note"><Store size={15}/> Vous pouvez sélectionner un magasin à gérer ou en ajouter un s’il manque.</div>

      </>}
      {CLOUD&&tab==='sellers'&&adminStore&&<div className="seller-access">
        <div className="admin-section-heading"><div><h3>Réinitialisation codes PIN</h3><p>Chaque vendeur choisit son propre PIN lors de sa première connexion. Aucun code préalable n’est nécessaire.</p></div></div>
        <div className="admin-selects admin-selects-single">
          <label><span className="form-label">Vendeur</span><select aria-label="Vendeur à réinitialiser" className="text-input" disabled={!adminStore||!activeSellers.length||busy} value={adminSeller} onChange={e=>{setAdminSeller(e.target.value);setNotice('');}}><option value="">Choisir un vendeur</option>{activeSellers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        </div>
        <div className="activation-admin"><p>Si un vendeur oublie son PIN, réinitialisez son accès, puis prévenez-le immédiatement pour qu’il choisisse un nouveau code sur son téléphone.</p>
          <button type="button" className="primary-button" disabled={busy||!adminSeller} onClick={()=>{
            const person=activeSellers.find(s=>String(s.id)===String(adminSeller));
            if(!window.confirm(`Réinitialiser l’accès de ${person?.name||'ce vendeur'} ? Son PIN et ses sessions seront immédiatement désactivés. La première personne à choisir ce profil pourra créer un nouveau PIN.`))return;
            run(()=>api('/api/admin/pin-reset',{method:'POST',token,body:{storeId:adminStore,sellerId:Number(adminSeller)}}),'Accès réinitialisé. Prévenez le vendeur pour qu’il choisisse son nouveau PIN.');
          }}>Réinitialiser l’accès <ArrowRight size={15}/></button>
        </div>
        <div className="admin-note"><ShieldCheck size={15}/> Tant qu’aucun PIN n’a été créé après une réinitialisation, la première personne à sélectionner ce profil peut le définir. L’administrateur ne voit pas le PIN.</div>
      </div>}
      {tab==='sellers'&&adminStore&&<SellerDeletePanel key={adminStore} storeId={adminStore} storeName={adminStoreName} sellers={storeSellers} departments={storeDepartments} token={token} disabled={busy||!allLoaded} onUpdate={()=>{loadAll();onChanged();}}/>}
      {tab==='security'&&(CLOUD?<AdminAccounts onLogout={logout} onBusy={setBusy}/>:<>
        <div className="admin-section-heading"><div><h3>Mot de passe administrateur</h3><p>La gestion de plusieurs comptes est disponible dans la version en ligne. Choisissez un mot de passe d’au moins 12 caractères.</p></div></div>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/api/admin/password',{method:'POST',token,body:{currentPassword:oldPass,newPassword:newPass}});setOldPass('');setNewPass('');},'Mot de passe mis à jour.')}}>
          <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" required value={oldPass} onChange={e=>setOldPass(e.target.value)}/></label>
          <label><span className="form-label">Nouveau mot de passe</span><input className="text-input" type="password" minLength={12} required value={newPass} onChange={e=>setNewPass(e.target.value)}/></label>
          <button className="primary-button" disabled={busy}>Mettre à jour <ArrowRight size={16}/></button>
        </form>
        <button className="logout-button" onClick={logout}><LogOut size={15}/> Déconnexion administrateur</button>
      </>)}
    </div>
    </div>
  </Modal>;
}
export { Modal };
