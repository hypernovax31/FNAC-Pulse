import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Clipboard, LogOut, Mail, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, changeAdminPassword, createDirectAdministrator} from './cloud';
import {createInvitationPassword, invitationAddress, invitationMessage} from './admin-invitation.js';

export function AdminAccounts({onLogout,onBusy,onPending}) {
  const [email,setEmail]=useState(''),[recipient,setRecipient]=useState(''),[currentPassword,setCurrentPassword]=useState('');
  const [confirmed,setConfirmed]=useState(false),[draft,setDraft]=useState(null),[pending,setPending]=useState(false);
  const [password,setPassword]=useState({current:'',next:'',confirm:''});
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null);
  const running=useRef(false),attempt=useRef(null);
  useEffect(()=>{
    let cancelled=false;
    const update=async refresh=>{try {const value=await adminAccountEmail({refresh});if(!cancelled)setEmail(value);}catch {}};
    update(false);
    const visible=()=>{if(document.visibilityState==='visible')update(true);};
    document.addEventListener('visibilitychange',visible);
    return ()=>{cancelled=true;document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{
    if(!pending)return;
    const beforeUnload=e=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>window.removeEventListener('beforeunload',beforeUnload);
  },[pending]);
  function hold(value){setPending(value);onPending?.(value);}
  function clearAttempt(){attempt.current=null;setDraft(null);setRecipient('');setCurrentPassword('');setConfirmed(false);hold(false);}
  async function run(section,work) {
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    try {const message=await work();if(message)setFeedback({section,kind:'success',message});}
    catch(e){setFeedback({section,kind:'error',message:e.message||'Opération impossible. Réessayez.'});}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  const message=section=>feedback?.section===section&&<div className={`admin-alert ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.kind==='success'&&<Check size={15}/>}<span>{feedback.message}</span></div>;
  async function prepareInvitation(e){
    e.preventDefault();if(running.current)return;
    if(!confirmed){setFeedback({section:'create',kind:'error',message:'Confirmez les droits accordés avant de continuer.'});return;}
    run('create',async()=>{
      const address=invitationAddress(recipient);
      if(!currentPassword)throw new Error('Indiquez votre mot de passe administrateur actuel.');
      if(attempt.current&&attempt.current.address!==address)throw new Error('Terminez ou abandonnez d’abord la tentative en cours.');
      if(!attempt.current){attempt.current={address,password:createInvitationPassword()};hold(true);}
      const provisional=attempt.current.password;
      await createDirectAdministrator(api,{email:address,password:provisional,currentPassword,confirmed:true});
      // Deuxième geste utilisateur explicite : les navigateurs mobiles peuvent
      // bloquer l’ouverture de la messagerie après une opération réseau longue.
      const base=import.meta.env?.BASE_URL||'/';
      const appUrl=new URL(base,window.location.origin).href;
      setDraft(invitationMessage({email:address,password:provisional,appUrl}));
      setCurrentPassword('');setConfirmed(false);
      return '';
    });
  }
  async function copyMessage(){
    try {
      if(!navigator.clipboard?.writeText)throw new Error();
      await navigator.clipboard.writeText(draft.body);
      setFeedback({section:'create',kind:'success',message:'Message copié. Collez-le dans un courriel adressé au destinataire indiqué.'});
    } catch {setFeedback({section:'create',kind:'error',message:'Copie indisponible. Ouvrez le courriel dans votre messagerie.'});}
  }
  function abandonAttempt(){
    if(!window.confirm('Abandonner cette tentative ? Si la connexion a été interrompue, un compte a peut-être été créé. Le mot de passe provisoire sera perdu sur cet écran.'))return;
    clearAttempt();setFeedback({section:'create',kind:'error',message:'Tentative abandonnée. Si un compte a été créé, son état doit être vérifié avant une nouvelle invitation à cette adresse.'});
  }
  function finishDraft(){
    if(!window.confirm('Avez-vous envoyé le courriel à la bonne adresse ? L’application ne peut pas vérifier son envoi. Le mot de passe provisoire ne sera plus disponible ici.'))return;
    clearAttempt();setFeedback({section:'create',kind:'success',message:'Message préparé. Sa réception dépend de votre messagerie.'});
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Inviter un administrateur</h3><p>Préparez un message d’accueil avec un mot de passe provisoire dans votre messagerie.</p></div></div>
      {!draft?<form className="store-form" onSubmit={prepareInvitation}>
        <label><span className="form-label">Adresse e-mail à inviter</span><input className="text-input" type="email" autoComplete="off" autoCapitalize="none" spellCheck="false" required maxLength={254} disabled={busy||pending} value={recipient} onChange={e=>{setRecipient(e.target.value);setFeedback(null);}}/></label>
        <label><span className="form-label">Votre mot de passe administrateur</span><input className="text-input" type="password" autoComplete="current-password" required disabled={busy} value={currentPassword} onChange={e=>{setCurrentPassword(e.target.value);setFeedback(null);}}/></label>
        <p className="admin-account-help">Utilisez une adresse qui ne possède pas encore de compte Fnac Pulse. Vous enverrez vous-même le courriel depuis votre messagerie.</p>
        <label className="admin-direct-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={e=>{setConfirmed(e.target.checked);setFeedback(null);}}/><span>J’ai vérifié l’adresse et j’accorde les droits sur <strong>tous les magasins</strong>, y compris l’ajout d’administrateurs.</span></label>
        {message('create')}
        <div className="admin-invite-actions"><button className="primary-button" type="submit" disabled={busy}><Mail size={16}/> {busy?'Préparation…':pending?'Réessayer':'Préparer l’invitation'}</button>
          {pending&&<button className="text-button" type="button" disabled={busy} onClick={abandonAttempt}>Abandonner la tentative</button>}</div>
      </form>:<div className="store-form">
        <div className="admin-invite-confirm"><strong>Message prêt pour {draft.address}</strong><p>Ouvrez votre messagerie et envoyez le message. Le destinataire devra remplacer son mot de passe provisoire à sa première connexion.</p></div>
        <div className="admin-invite-actions"><a className="primary-button admin-mail-link" href={draft.href}><Mail size={16}/> Ouvrir le courriel</a>
          <button type="button" className="outline-button admin-copy-message" onClick={copyMessage}><Clipboard size={15}/> Copier le message</button></div>
        <p className="admin-account-help">L’envoi n’est pas automatique. Ne quittez pas cet écran avant d’avoir envoyé le courriel : le mot de passe ne sera plus disponible ici.</p>
        {message('create')}
        <button type="button" className="text-button admin-first-retry" onClick={finishDraft}>J’ai terminé</button>
      </div>}
    </section>
    <section className="admin-account-section" aria-labelledby="admin-password-title">
      <div className="admin-section-heading"><div><h3 id="admin-password-title">Modifier mon mot de passe</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run('password',async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});return 'Votre mot de passe a été mis à jour.';
      });}}>
        <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required disabled={busy||pending} value={password.current} onChange={e=>setPassword(v=>({...v,current:e.target.value}))}/></label>
        <label><span className="form-label">Nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy||pending} value={password.next} onChange={e=>setPassword(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer le nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy||pending} value={password.confirm} onChange={e=>setPassword(v=>({...v,confirm:e.target.value}))}/></label>
        {message('password')}
        <button className="primary-button" disabled={busy||pending}>Modifier mon mot de passe <ArrowRight size={16}/></button>
      </form>
    </section>
    <button type="button" className="logout-button" disabled={busy||pending} onClick={onLogout}><LogOut size={15}/> Déconnexion administrateur</button>
  </div>;
}
