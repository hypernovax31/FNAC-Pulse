import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Clipboard, Info, LogOut, Plus, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, cancelAdminEnrollmentCode, changeAdminPassword, createAdminEnrollmentCode} from './cloud';

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState(''),[confirmed,setConfirmed]=useState(false),[issued,setIssued]=useState(null);
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
    try {const message=await work();if(message)setFeedback({section,kind:'success',message});}
    catch(e){setFeedback({section,kind:'error',message:e.message||'Opération impossible. Réessayez.'});}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  const message=section=>feedback?.section===section&&<div className={`admin-alert ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.kind==='success'&&<Check size={15}/>}<span>{feedback.message}</span></div>;
  async function copyCode(){
    try {if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(issued.code);setFeedback({section:'create',kind:'success',message:'Code copié. Transmettez-le uniquement par un moyen privé.'});}
    catch {setFeedback({section:'create',kind:'error',message:'Copie automatique indisponible. Sélectionnez et copiez le code affiché.'});}
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Ajouter un administrateur</h3><p>Générez un code d’autorisation à transmettre en privé. La personne créera elle-même son compte sur son appareil.</p></div></div>
      {!issued?<form className="store-form" onSubmit={e=>{e.preventDefault();if(!confirmed){setFeedback({section:'create',kind:'error',message:'Confirmez les droits accordés avant de créer le code.'});return;}
        run('create',async()=>{const result=await createAdminEnrollmentCode(api);if(!result?.code)throw new Error('Code non confirmé. Réessayez.');setIssued(result);setConfirmed(false);return '';});
      }}>
        <div className="admin-direct-note"><Info size={16}/><div><strong>Aucun e-mail ne sera envoyé.</strong><p>La personne saisira une nouvelle adresse qu’elle contrôle et un mot de passe provisoire de 6 caractères maximum, puis choisira son mot de passe personnel. Firebase ne vérifiera pas son adresse : une personne contrôlant cette boîte pourrait récupérer le compte.</p></div></div>
        <label className="admin-direct-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={e=>{setConfirmed(e.target.checked);setFeedback(null);}}/><span>J’accorde à la personne qui utilisera ce code les droits sur <strong>tous les magasins</strong> et la possibilité d’ajouter d’autres administrateurs.</span></label>
        {message('create')}
        <button className="primary-button" type="submit" disabled={busy}><Plus size={16}/> {busy?'Création…':'Générer le code'}</button>
      </form>:<div className="store-form">
        <div className="admin-code-display"><strong>Code à transmettre en privé</strong><output aria-label="Code administrateur à transmettre" className="admin-code-value">{issued.code}</output>
          <p>Utilisable une seule fois pour démarrer la création, pendant 24 heures. Conservez-le pour le transmettre à la bonne personne. Il ne sera plus affiché après fermeture de cet écran.</p>
          <p>Si la création est interrompue, la même personne peut la reprendre pendant 7 jours avec le même code, la même adresse et le même mot de passe provisoire.</p>
        </div>
        <div className="admin-invite-actions"><button type="button" className="outline-button" disabled={busy} onClick={copyCode}><Clipboard size={15}/> Copier le code</button>
          <button type="button" className="text-button" disabled={busy} onClick={()=>{setIssued(null);setFeedback(null);}}>Masquer le code</button></div>
        <p className="admin-account-help">Masquer le code ne l’annule pas. Toute personne qui le possède peut l’utiliser : partagez-le uniquement avec le destinataire prévu.</p>
        <button type="button" className="text-button admin-code-cancel" disabled={busy} onClick={()=>{
          if(!window.confirm('Annuler ce code ? Il ne pourra plus servir à créer un compte. Cela ne retire pas les droits d’un compte déjà créé.'))return;
          run('create',async()=>{await cancelAdminEnrollmentCode(api,issued.code);setIssued(null);return 'Code annulé. Il ne peut plus être utilisé.';});
        }}>Annuler ce code</button>
        {message('create')}
      </div>}
    </section>
    <section className="admin-account-section" aria-labelledby="admin-password-title">
      <div className="admin-section-heading"><div><h3 id="admin-password-title">Modifier mon mot de passe</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run('password',async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});return 'Votre mot de passe a été mis à jour.';
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
