import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Info, LogOut, Plus, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, changeAdminPassword, inviteAdministrator, requestAdminEmailChange, inspectAdminEmailChange, confirmAdminEmailChange} from './cloud';

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState('');
  const [add,setAdd]=useState({email:'',current:''});
  const [password,setPassword]=useState({current:'',next:'',confirm:''});
  const [address,setAddress]=useState({current:'',next:''});
  const [emailLink,setEmailLink]=useState(''),[linkProof,setLinkProof]=useState(null),[linkError,setLinkError]=useState(''),[linkNotice,setLinkNotice]=useState(''),[linkWorking,setLinkWorking]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const running=useRef(false);
  useEffect(()=>{
    let cancelled=false;
    const update=async refresh=>{try {const value=await adminAccountEmail({refresh});if(!cancelled)setEmail(value);}catch {}};
    update(false);
    const visible=()=>{if(document.visibilityState==='visible')update(true);};
    document.addEventListener('visibilitychange',visible);
    return ()=>{cancelled=true;document.removeEventListener('visibilitychange',visible);};
  },[]);
  async function run(work,{emailConfirmation=false}={}) {
    if(running.current)return;
    running.current=true;setBusy(true);if(emailConfirmation)setLinkWorking(true);onBusy?.(true);setError('');setNotice('');setLinkError('');setLinkNotice('');
    try {const message=await work();if(emailConfirmation)setLinkNotice(message||'');else setNotice(message);}
    catch(e){if(emailConfirmation)setLinkError(e.message||'Opération impossible. Réessayez.');else setError(e.message||'Opération impossible. Réessayez.');}
    finally{running.current=false;setBusy(false);if(emailConfirmation)setLinkWorking(false);onBusy?.(false);}
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Inviter un administrateur</h3><p>Il aura les mêmes droits sur tous les magasins et pourra inviter d’autres administrateurs.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        const result=await inviteAdministrator(api,{email:add.email,currentPassword:add.current});
        setAdd({email:'',current:''});
        if(result.alreadyAccepted)return 'Cette invitation a déjà été acceptée.';
        return 'Invitation enregistrée et demande de lien transmise à Firebase. Prévenez la personne : elle devrait recevoir un e-mail de réinitialisation pour choisir son mot de passe, puis devra accepter l’invitation dans Fnac Pulse. Vérifiez les courriers indésirables si nécessaire.';
      });}}>
        <label><span className="form-label">E-mail de la personne invitée</span><input className="text-input" type="email" autoComplete="off" required maxLength={254} value={add.email} onChange={e=>setAdd(v=>({...v,email:e.target.value}))}/></label>
        <label><span className="form-label">Votre mot de passe administrateur actuel</span><input className="text-input" type="password" autoComplete="current-password" required value={add.current} onChange={e=>setAdd(v=>({...v,current:e.target.value}))}/></label>
        <p className="admin-account-help"><Info size={14}/><span>La personne choisit son mot de passe grâce au lien Firebase de réinitialisation, puis accepte l’invitation dans Fnac Pulse. L’invitation expire dans 7 jours ; le lien peut expirer avant.</span></p>
        <p className="admin-account-help"><Info size={14}/><span>Prévenez-la séparément. Un compte existant peut garder son mot de passe actuel : aucun changement n’est fait sans elle. Si l’e-mail n’arrive pas, vérifiez les indésirables ou essayez une autre adresse.</span></p>
        <button className="primary-button" disabled={busy}><Plus size={16}/> Envoyer l’invitation</button>
      </form>
    </section>
    <section className="admin-account-section" aria-labelledby="admin-password-title">
      <div className="admin-section-heading"><div><h3 id="admin-password-title">Modifier mon mot de passe</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});return 'Votre mot de passe a été mis à jour.';
      });}}>
        <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required value={password.current} onChange={e=>setPassword(v=>({...v,current:e.target.value}))}/></label>
        <label><span className="form-label">Nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password.next} onChange={e=>setPassword(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer le nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password.confirm} onChange={e=>setPassword(v=>({...v,confirm:e.target.value}))}/></label>
        <button className="primary-button" disabled={busy}>Modifier mon mot de passe <ArrowRight size={16}/></button>
      </form>
    </section>
    <section className="admin-account-section" aria-labelledby="admin-email-title">
      <div className="admin-section-heading"><div><h3 id="admin-email-title">Modifier mon e-mail de connexion</h3><p>L’adresse actuelle reste valable jusqu’à la confirmation de la nouvelle adresse.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        await requestAdminEmailChange(address.current,address.next);setAddress({current:'',next:''});
        return 'Lien envoyé à la nouvelle adresse. Ouvrez-le pour confirmer le changement ; l’ancienne adresse reste valable jusque-là.';
      });}}>
        <label><span className="form-label">Nouvel e-mail</span><input className="text-input" type="email" autoComplete="email" required maxLength={254} value={address.next} onChange={e=>setAddress(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required value={address.current} onChange={e=>setAddress(v=>({...v,current:e.target.value}))}/></label>
        <button className="primary-button" disabled={busy}>Envoyer le lien de confirmation <ArrowRight size={16}/></button>
      </form>
      <details className="admin-email-fallback" onToggle={e=>{if(!e.currentTarget.open){setEmailLink('');setLinkProof(null);setLinkError('');setLinkNotice('');}}}>
        <summary>Le lien reçu ne s’ouvre pas ?</summary>
        <p>Dans votre messagerie, appuyez longuement sur le lien reçu et choisissez « Copier le lien ». Collez-le ici pour confirmer sans ouvrir sa page. Ne partagez ce lien avec personne.</p>
        <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
          const proof=await inspectAdminEmailChange(emailLink);setLinkProof(proof);setEmailLink('');
          return 'Lien vérifié. Vérifiez l’adresse ci-dessous avant de confirmer.';
        },{emailConfirmation:true});}}>
          <label><span className="form-label">Lien de confirmation reçu</span><input className="text-input" aria-label="Lien de confirmation reçu" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={8192} value={emailLink} onChange={e=>{setEmailLink(e.target.value);setLinkProof(null);setLinkError('');setLinkNotice('');}} disabled={busy} required/></label>
          <button className="outline-button" disabled={busy||!emailLink.trim()}>Vérifier le lien</button>
        </form>
        {linkWorking&&<p className="admin-email-working" role="status">Échange avec Firebase en cours…</p>}
        {linkError&&<div className="admin-alert error" role="alert">{linkError}</div>}
        {linkNotice&&<div className="admin-alert success" role="status"><Check size={15}/>{linkNotice}</div>}
        {linkProof&&<div className="admin-email-proof"><p>Nouvelle adresse : <strong>{linkProof.newEmail}</strong></p><button type="button" className="primary-button" disabled={busy} onClick={()=>run(async()=>{
          const proof=linkProof;setLinkProof(null);const result=await confirmAdminEmailChange(proof);setEmail(result.email);
          return `Adresse confirmée : ${result.email}. Si l’administration vous demande de vous reconnecter, utilisez cette adresse avec votre mot de passe habituel.`;
        },{emailConfirmation:true})}>Confirmer mon nouvel e-mail <ArrowRight size={16}/></button></div>}
      </details>
    </section>
    <button type="button" className="logout-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Déconnexion administrateur</button>
  </div>;
}
