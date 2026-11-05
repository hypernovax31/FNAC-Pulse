import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,LogOut,Plus,RefreshCw,ShieldCheck} from 'lucide-react';
import {api} from './api';
import {ADMIN_SESSION,adminAccountEmail,changeAdminPassword} from './cloud';
import {invitationAddress} from './admin-invitation.js';
import {AdminTestCleanup} from './AdminTestCleanup';

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState(''),[recipient,setRecipient]=useState(''),[requests,setRequests]=useState([]),[loading,setLoading]=useState(true);
  const [next,setNext]=useState(''),[loadingMore,setLoadingMore]=useState(false);
  const [review,setReview]=useState(null),[verified,setVerified]=useState(false);
  const [password,setPassword]=useState({current:'',next:'',confirm:''}),[showPassword,setShowPassword]=useState(false);
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null);
  const running=useRef(false),alive=useRef(true),loadSequence=useRef(0),browsingPages=useRef(false);
  async function loadRequests({silent=false,after=''}={}) {
    if(silent&&browsingPages.current)return;
    const append=!!after,sequence=++loadSequence.current;
    if(append){browsingPages.current=true;setLoadingMore(true);}else if(!silent){browsingPages.current=false;setLoadingMore(false);}
    try {
      const path=`/api/admin/access-requests${append?`?after=${encodeURIComponent(after)}`:''}`;
      const value=await api(path,{token:ADMIN_SESSION});
      if(alive.current&&sequence===loadSequence.current){
        const page=Array.isArray(value.requests)?value.requests:[];
        setRequests(old=>append?[...old,...page.filter(item=>!old.some(previous=>previous.requestId===item.requestId))]:page);
        setNext(typeof value.next==='string'?value.next:'');
      }
    } catch(e){if(alive.current&&sequence===loadSequence.current&&!silent)setFeedback({kind:'error',message:e.message||'Impossible de charger les demandes.'});}
    finally {if(alive.current&&sequence===loadSequence.current){setLoading(false);setLoadingMore(false);}}
  }
  useEffect(()=>{
    alive.current=true;
    adminAccountEmail().then(value=>{if(alive.current)setEmail(value);}).catch(()=>{});
    loadRequests();
    const visible=()=>{if(document.visibilityState==='visible')loadRequests({silent:true});};
    document.addEventListener('visibilitychange',visible);
    const timer=setInterval(()=>loadRequests({silent:true}),15000);
    return ()=>{alive.current=false;document.removeEventListener('visibilitychange',visible);clearInterval(timer);};
  },[]);
  async function run(work) {
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    try {const message=await work();if(message&&alive.current)setFeedback({kind:'success',message});}
    catch(e){if(alive.current)setFeedback({kind:'error',message:e.message||'Opération impossible. Réessayez.'});}
    finally {running.current=false;if(alive.current)setBusy(false);onBusy?.(false);}
  }
  function submitAddress(e) {
    e.preventDefault();run(async()=>{
      const address=invitationAddress(recipient),body={email:address};let result;
      try {result=await api('/api/admin/access-requests',{method:'POST',token:ADMIN_SESSION,body});}
      catch(error){if(error?.status&&error.status<500&&error.status!==408&&error.status!==429)throw error;result=await api('/api/admin/access-requests',{method:'POST',token:ADMIN_SESSION,body});}
      setRecipient('');await loadRequests();
      return result.already?'Cette adresse figure déjà dans les demandes ou possède déjà un accès validé.':'Adresse ajoutée. La personne peut créer son compte depuis « Première connexion ».';
    });
  }
  function decide(item,approve) {
    if(!approve&&!window.confirm(`Annuler la demande pour ${item.email} ? Aucun compte Firebase ne sera supprimé.`))return;
    if(approve&&!verified){setFeedback({kind:'error',message:'Confirmez la vérification de l’identité avant de valider.'});return;}
    run(async()=>{
      const body={email:item.email,requestId:item.requestId,claimantUid:item.claimantUid||'',confirmed:true,...(approve?{identityVerified:true}:{})};
      const path=approve?'/api/admin/access-requests/approve':'/api/admin/access-requests/cancel';
      try {await api(path,{method:'POST',token:ADMIN_SESSION,body});}
      catch(error){if(error?.status&&error.status<500&&error.status!==408&&error.status!==429)throw error;await api(path,{method:'POST',token:ADMIN_SESSION,body});}
      setReview(null);setVerified(false);await loadRequests();
      return approve?'Accès validé. La personne peut maintenant se connecter.':'Demande annulée. Aucun compte Firebase n’a été supprimé.';
    });
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    {feedback&&<div className={`admin-alert ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.kind==='success'&&<Check size={15}/>}<span>{feedback.message}</span></div>}
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Ajouter un administrateur</h3><p>Ajoutez son adresse. La personne choisira son mot de passe à sa première connexion ; aucun e-mail n’est envoyé.</p></div></div>
      <form className="admin-add-address" onSubmit={submitAddress}>
        <label><span className="form-label">Adresse e-mail</span><input className="text-input" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={busy} value={recipient} onChange={e=>{setRecipient(e.target.value);setFeedback(null);}}/></label>
        <button className="primary-button" type="submit" disabled={busy}><Plus size={16}/> Ajouter</button>
      </form>
      <div className="admin-requests-heading"><div><h4>Demandes d’accès</h4><p>Les droits ne sont accordés qu’après votre validation.</p></div><button type="button" className="admin-requests-refresh" aria-label="Actualiser les demandes" disabled={busy} onClick={()=>loadRequests()}><RefreshCw size={15}/></button></div>
      {loading?<p className="admin-account-help">Chargement des demandes…</p>:requests.length===0?<div className="admin-request-empty">Aucune demande en attente.</div>:<div className="admin-request-list">{requests.map(item=><div className="admin-request" key={item.requestId}>
        <div className="admin-request-copy"><strong>{item.email}</strong><span>{item.status==='pending'?'Identité à vérifier':'En attente de la première connexion'}</span></div>
        <div className="admin-request-actions">{item.status==='pending'&&item.claimantUid&&<button type="button" className="admin-request-review" disabled={busy} onClick={()=>{setReview(item);setVerified(false);setFeedback(null);}}>Vérifier</button>}
          <button type="button" className="admin-request-cancel" disabled={busy} onClick={()=>decide(item,false)}>Annuler</button></div>
        {review?.requestId===item.requestId&&<div className="admin-approval" role="group" aria-label={`Vérifier ${item.email}`}>
          <strong>Vérifiez la personne avant de valider</strong>
          <p>Vérifiez son identité par un autre moyen et demandez-lui de vous montrer son écran « Demande en attente ». L’adresse n’est pas vérifiée automatiquement.</p>
          <label className="admin-direct-check"><input type="checkbox" checked={verified} disabled={busy} onChange={e=>setVerified(e.target.checked)}/><span>J’ai vérifié son identité et vu son écran. Je lui accorde les droits sur <b>tous les magasins</b>, y compris l’ajout d’administrateurs.</span></label>
          <div><button type="button" className="outline-button" disabled={busy} onClick={()=>{setReview(null);setVerified(false);}}>Retour</button><button type="button" className="primary-button" disabled={busy||!verified} onClick={()=>decide(item,true)}>Valider l’accès</button></div>
        </div>}
      </div>)}</div>}
      {next&&<button type="button" className="outline-button admin-requests-more" disabled={busy||loadingMore} onClick={()=>loadRequests({after:next})}>{loadingMore?'Chargement…':'Charger la suite'}</button>}
    </section>
    <section className="admin-account-section admin-password-section" aria-labelledby="admin-password-title">
      <button type="button" className="admin-account-toggle" aria-expanded={showPassword} onClick={()=>setShowPassword(x=>!x)}><span id="admin-password-title">Modifier mon mot de passe</span><span aria-hidden="true">{showPassword?'−':'+'}</span></button>
      {showPassword&&<form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});setShowPassword(false);return 'Votre mot de passe a été mis à jour.';
      });}}>
        <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required disabled={busy} value={password.current} onChange={e=>setPassword(v=>({...v,current:e.target.value}))}/></label>
        <label><span className="form-label">Nouveau mot de passe · 12 caractères minimum</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password.next} onChange={e=>setPassword(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer le nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password.confirm} onChange={e=>setPassword(v=>({...v,confirm:e.target.value}))}/></label>
        <button className="primary-button" disabled={busy}>Modifier mon mot de passe <ArrowRight size={16}/></button>
      </form>}
    </section>
    <AdminTestCleanup disabled={busy} onBusy={value=>{setBusy(value);onBusy?.(value);}}/>
    <button type="button" className="logout-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Déconnexion administrateur</button>
  </div>;
}
