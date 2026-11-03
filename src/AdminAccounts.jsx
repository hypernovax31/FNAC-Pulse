import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Info, LogOut, Plus, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, changeAdminPassword, inviteAdministrator} from './cloud';

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState('');
  const [inviteEmail,setInviteEmail]=useState(''),[invitePassword,setInvitePassword]=useState(''),[confirmInvite,setConfirmInvite]=useState(false);
  const [password,setPassword]=useState({current:'',next:'',confirm:''});
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(null);
  const running=useRef(false);
  useEffect(()=>{
    let cancelled=false;
    const update=async refresh=>{try {const value=await adminAccountEmail({refresh});if(!cancelled)setEmail(value);}catch {}};
    update(false);
    const visible=()=>{if(document.visibilityState==='visible')update(true);};
    document.addEventListener('visibilitychange',visible);
    return ()=>{cancelled=true;document.removeEventListener('visibilitychange',visible);};
  },[]);
  async function run(section,work) {
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setFeedback(null);
    try {setFeedback({section,kind:'success',message:await work()});}
    catch(e){setFeedback({section,kind:'error',message:e.message||'Opération impossible. Réessayez.'});}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  const message=section=>feedback?.section===section&&<div className={`admin-alert ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.kind==='success'&&<Check size={15}/>}<span>{feedback.message}</span></div>;
  function reviseInvitation(){setConfirmInvite(false);setInvitePassword('');setFeedback(null);}
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Ajouter un administrateur</h3><p>Invitez une personne avec son adresse e-mail.</p></div></div>
      <form className="store-form" onSubmit={e=>{
        e.preventDefault();
        if(!confirmInvite){setFeedback(null);setConfirmInvite(true);return;}
        run('invite',async()=>{
          try {
            const result=await inviteAdministrator(api,{email:inviteEmail,currentPassword:invitePassword});
            setInviteEmail('');setConfirmInvite(false);
            if(result.alreadyAccepted)return 'Cette invitation a déjà été acceptée.';
            return 'Invitation enregistrée. Prévenez la personne : elle peut choisir son mot de passe grâce au lien reçu ou conserver celui de son compte, puis accepter l’invitation dans Fnac Pulse. Si l’e-mail n’arrive pas, vérifiez aussi les indésirables.';
          } finally {setInvitePassword('');}
        });
      }}>
        <label><span className="form-label">Adresse e-mail de la personne</span><input className="text-input" type="email" autoComplete="off" required maxLength={254} value={inviteEmail} readOnly={confirmInvite} disabled={busy} onChange={e=>{setInviteEmail(e.target.value);setFeedback(null);}}/></label>
        <p className="admin-account-help"><Info size={14}/><span>La personne choisit son mot de passe ou conserve celui de son compte, puis accepte l’invitation. Tous les administrateurs ont les mêmes droits sur tous les magasins.</span></p>
        {!confirmInvite&&<>{message('invite')}<button className="primary-button" type="submit" disabled={busy}><Plus size={16}/> Continuer</button></>}
        {confirmInvite&&<div className="admin-invite-confirm">
          <div><strong>Confirmer l’invitation</strong><p>Pour sécuriser l’envoi, confirmez votre mot de passe administrateur.</p></div>
          <label><span className="form-label">Votre mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required autoFocus disabled={busy} value={invitePassword} onChange={e=>setInvitePassword(e.target.value)}/></label>
          {message('invite')}
          <div className="admin-invite-actions"><button className="primary-button" type="submit" disabled={busy}>Envoyer l’invitation <ArrowRight size={16}/></button><button className="text-button" type="button" disabled={busy} onClick={reviseInvitation}>Modifier l’adresse</button></div>
        </div>}
      </form>
    </section>
    <section className="admin-account-section" aria-labelledby="admin-password-title">
      <div className="admin-section-heading"><div><h3 id="admin-password-title">Modifier mon mot de passe</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run('password',async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});setInvitePassword('');return 'Votre mot de passe a été mis à jour.';
      });}}>
        <label><span className="form-label">Mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required disabled={busy} value={password.current} onChange={e=>setPassword(v=>({...v,current:e.target.value}))}/></label>
        <label><span className="form-label">Nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password.next} onChange={e=>setPassword(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer le nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password.confirm} onChange={e=>setPassword(v=>({...v,confirm:e.target.value}))}/></label>
        {message('password')}
        <button className="primary-button" disabled={busy}>Modifier mon mot de passe <ArrowRight size={16}/></button>
      </form>
    </section>
    <button type="button" className="logout-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Déconnexion administrateur</button>
  </div>;
}
