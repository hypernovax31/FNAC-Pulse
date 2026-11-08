import React,{useEffect,useRef,useState} from 'react';
import {LockKeyhole,LogOut,RefreshCw,Send,ShieldCheck,UserRoundPlus} from 'lucide-react';
import {api,uid} from './api';
import {ADMIN_SESSION,adminAccountEmail,changeAdminPassword,inviteAdministrator} from './cloud';

const normalEmail=value=>String(value||'').trim().toLowerCase();
const validEmail=value=>value.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
const dateLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):'';};

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState(''),[draft,setDraft]=useState(null),[needsPassword,setNeedsPassword]=useState(false),[password,setPassword]=useState('');
  const [invitations,setInvitations]=useState([]),[next,setNext]=useState(''),[loadingMore,setLoadingMore]=useState(false),[listError,setListError]=useState('');
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null),[passwordOpen,setPasswordOpen]=useState(false),[accountEmail,setAccountEmail]=useState(''),[current,setCurrent]=useState(''),[nextPassword,setNextPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const mounted=useRef(true),running=useRef(false),listSequence=useRef(0),browsingPages=useRef(false),confirmation=useRef(null);
  useEffect(()=>{if(draft)confirmation.current?.focus();},[draft]);

  async function loadInvitations(after='',silent=false) {
    if(silent&&browsingPages.current)return;
    if(after){browsingPages.current=true;setLoadingMore(true);}else if(!silent)browsingPages.current=false;
    const sequence=++listSequence.current;
    try {
      const value=await api(`/api/admin/invitations${after?`?after=${encodeURIComponent(after)}`:''}`,{token:ADMIN_SESSION});
      if(mounted.current&&sequence===listSequence.current) {
        const page=Array.isArray(value.invitations)?value.invitations:[];
        setInvitations(old=>after?[...old,...page.filter(item=>!old.some(previous=>previous.requestId===item.requestId))]:page);
        setNext(typeof value.next==='string'?value.next:'');setListError('');
      }
    } catch(e){if(mounted.current&&sequence===listSequence.current)setListError(e.message||'Impossible de charger les invitations.');}
    finally{if(mounted.current&&sequence===listSequence.current)setLoadingMore(false);}
  }
  useEffect(()=>{
    mounted.current=true;loadInvitations();adminAccountEmail().then(value=>{if(mounted.current)setAccountEmail(value);}).catch(()=>{});
    const refresh=()=>{if(document.visibilityState==='visible')loadInvitations('',true);};
    document.addEventListener('visibilitychange',refresh);const timer=setInterval(refresh,30000);
    return()=>{mounted.current=false;document.removeEventListener('visibilitychange',refresh);clearInterval(timer);};
  },[]);
  function prepare(event,address=email) {
    event?.preventDefault();if(busy)return;
    const recipient=normalEmail(address);
    if(!validEmail(recipient)){setFeedback({error:true,text:'Indiquez une adresse e-mail valide.'});return;}
    setEmail(recipient);setDraft({email:recipient,requestId:uid()});setNeedsPassword(false);setPassword('');setFeedback(null);
  }
  async function send(event) {
    event?.preventDefault();if(!draft||running.current)return;
    if(needsPassword&&!password){setFeedback({error:true,text:'Confirmez votre mot de passe administrateur.'});return;}
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    try {
      const result=await inviteAdministrator(api,{email:draft.email,requestId:draft.requestId,...(needsPassword?{currentPassword:password}:{})});
      if(mounted.current){
        setFeedback({error:false,text:result.alreadyAccepted?'Cette adresse dispose déjà de l’accès administrateur.':'Demande d’e-mail envoyée. La personne peut vérifier sa boîte de réception et ses indésirables.'});
        setDraft(null);setEmail('');setPassword('');setNeedsPassword(false);await loadInvitations();
      }
    } catch(e){
      if(mounted.current){
        if(e?.status===401&&/Confirmez à nouveau/.test(e.message||'')){setNeedsPassword(true);setPassword('');setFeedback({error:false,text:'Pour sécuriser l’envoi, confirmez votre mot de passe administrateur.'});}
        else setFeedback({error:true,text:e.message||'Envoi non confirmé. Réessayez.'});
      }
    } finally{running.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
  }
  async function cancel(item) {
    if(running.current||!window.confirm(`Annuler l’invitation de ${item.email} ? Elle ne donnera plus de nouveaux droits. Un lien Firebase déjà envoyé peut rester utilisable ; aucun compte ne sera supprimé.`))return;
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    const body={email:item.email,requestId:item.requestId,confirmed:true};
    try {
      try{await api('/api/admin/invitations/cancel',{method:'POST',token:ADMIN_SESSION,body});}
      catch(e){if(e?.status&&e.status<500&&e.status!==408&&e.status!==429)throw e;await api('/api/admin/invitations/cancel',{method:'POST',token:ADMIN_SESSION,body});}
      if(mounted.current){setFeedback({error:false,text:'Invitation annulée.'});await loadInvitations();}
    } catch(e){if(mounted.current)setFeedback({error:true,text:e.message||'Annulation non confirmée. Actualisez et réessayez.'});}
    finally{running.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
  }
  async function changePassword(event) {
    event.preventDefault();if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    try{if(nextPassword!==confirmPassword)throw new Error('Les nouveaux mots de passe ne correspondent pas.');await changeAdminPassword(current,nextPassword);if(mounted.current){setCurrent('');setNextPassword('');setConfirmPassword('');setPasswordOpen(false);setFeedback({error:false,text:'Mot de passe mis à jour.'});}}
    catch(e){if(mounted.current)setFeedback({error:true,text:e.message||'Impossible de modifier le mot de passe.'});}
    finally{running.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{accountEmail||'Chargement de votre adresse…'}</p></div></div>
    <section className="admin-account-section admin-invite-section" aria-labelledby="admin-invite-title">
      <div className="admin-account-heading"><UserRoundPlus size={19}/><div><h3 id="admin-invite-title">Inviter un administrateur</h3><p>La personne recevra un lien de connexion pour activer son compte.</p></div></div>
      {feedback&&<div className={`admin-alert ${feedback.error?'error':'success'}`} role={feedback.error?'alert':'status'}>{feedback.text}</div>}
      {!draft?<form className="admin-invite-form" onSubmit={prepare}>
        <label htmlFor="admin-invite-email">Adresse e-mail</label>
        <div className="admin-invite-entry"><input className="text-input" id="admin-invite-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nom@exemple.fr" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} disabled={busy} required/><button className="primary-button" disabled={busy} type="submit"><Send size={16}/> Continuer</button></div>
      </form>:<form ref={confirmation} tabIndex={-1} className="admin-invite-confirm" onSubmit={send}>
        <strong>Inviter {draft.email} ?</strong>
        <p>Après confirmation de son adresse et création ou confirmation de son mot de passe, cette personne aura les droits administrateur sur <b>tous les magasins</b> et pourra inviter d’autres administrateurs, sans autre validation.</p>
        {needsPassword&&<label className="admin-invite-password">Votre mot de passe administrateur<input className="text-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" disabled={busy} required/></label>}
        <div className="admin-invite-confirm-actions"><button className="outline-button" type="button" disabled={busy} onClick={()=>{setDraft(null);setPassword('');setNeedsPassword(false);setFeedback(null);}}>Retour</button><button className="primary-button" type="submit" disabled={busy}><Send size={16}/> {busy?'Envoi…':'Envoyer l’invitation'}</button></div>
      </form>}
      <p className="admin-account-help">Firebase envoie un e-mail standard de connexion ; sa réception n’est pas garantie. Si la personne a déjà un compte, elle peut utiliser son mot de passe habituel. Sur l’offre gratuite, la limite est de cinq e-mails de connexion par jour.</p>
    </section>
    {(invitations.length>0||next||listError)&&<section className="admin-account-section admin-pending-invitations" aria-labelledby="admin-pending-title">
      <div className="admin-requests-heading"><div><h3 id="admin-pending-title">Invitations en cours</h3><p>L’invitation expire après sept jours.</p></div><button type="button" className="admin-requests-refresh" aria-label="Actualiser les invitations" disabled={busy} onClick={()=>loadInvitations()}><RefreshCw size={15}/></button></div>
      {listError&&<div className="admin-alert error" role="alert">{listError}</div>}
      <div className="admin-request-list">{invitations.map(item=><div className="admin-request" key={item.requestId}><div className="admin-request-copy"><strong>{item.email}</strong><span>En attente{dateLabel(item.expiresAt)?` · jusqu’au ${dateLabel(item.expiresAt)}`:''}</span></div><div className="admin-request-actions"><button type="button" className="admin-request-review" disabled={busy} onClick={()=>prepare(null,item.email)}>Renvoyer</button><button type="button" className="admin-request-cancel" disabled={busy} onClick={()=>cancel(item)}>Annuler</button></div></div>)}</div>
      {next&&<button type="button" className="outline-button admin-requests-more" disabled={busy||loadingMore} onClick={()=>loadInvitations(next)}>{loadingMore?'Chargement…':'Charger la suite'}</button>}
    </section>}
    <section className="admin-account-section admin-account-security">
      <div className="admin-account-heading"><LockKeyhole size={19}/><div><h3>Mon mot de passe</h3><p>Modifiez votre mot de passe personnel.</p></div></div>
      {!passwordOpen?<button type="button" className="outline-button" disabled={busy} onClick={()=>setPasswordOpen(true)}>Modifier mon mot de passe</button>:<form onSubmit={changePassword} className="admin-account-password-form">
        <label>Mot de passe actuel<input className="text-input" type="password" value={current} onChange={e=>setCurrent(e.target.value)} autoComplete="current-password" disabled={busy} required/></label>
        <label>Nouveau mot de passe · 12 caractères minimum<input className="text-input" type="password" value={nextPassword} onChange={e=>setNextPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} disabled={busy} required/></label>
        <label>Confirmer le nouveau mot de passe<input className="text-input" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} disabled={busy} required/></label>
        <div><button type="button" className="outline-button" disabled={busy} onClick={()=>{setPasswordOpen(false);setCurrent('');setNextPassword('');setConfirmPassword('');}}>Annuler</button><button type="submit" className="primary-button" disabled={busy}>Enregistrer</button></div>
      </form>}
    </section>
    <button type="button" className="outline-button admin-account-logout" disabled={busy} onClick={onLogout}><LogOut size={16}/> Se déconnecter</button>
  </div>;
}
