import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Info, LogOut, Plus, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, changeAdminPassword, createDirectAdministrator} from './cloud';

const emptyDirect=()=>({email:'',password:'',confirm:'',current:'',verified:false});

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState('');
  const [direct,setDirect]=useState(emptyDirect),[confirmDirect,setConfirmDirect]=useState(false),[showPassword,setShowPassword]=useState(false);
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
  function reviseDirect(){setConfirmDirect(false);setDirect(v=>({...v,current:''}));setFeedback(null);}
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Ajouter un administrateur</h3><p>Créez un nouvel accès avec une adresse et un mot de passe provisoire.</p></div></div>
      <form className="store-form" onSubmit={e=>{
        e.preventDefault();
        if(!confirmDirect){
          if(!direct.verified){setFeedback({section:'create',kind:'error',message:'Confirmez que vous avez vérifié l’adresse et les droits accordés.'});return;}
          if(direct.password.length<12||direct.password.length>128){setFeedback({section:'create',kind:'error',message:'Le mot de passe provisoire doit comporter de 12 à 128 caractères.'});return;}
          if(direct.password!==direct.confirm){setFeedback({section:'create',kind:'error',message:'Les mots de passe provisoires ne correspondent pas.'});return;}
          setFeedback(null);setConfirmDirect(true);return;
        }
        run('create',async()=>{
          try {
            const result=await createDirectAdministrator(api,{email:direct.email,password:direct.password,currentPassword:direct.current,confirmed:direct.verified});
            setDirect(emptyDirect());setConfirmDirect(false);setShowPassword(false);
            return `${result.already?'Cet accès administrateur avait déjà été créé.':'Accès administrateur créé.'} Transmettez l’adresse et le mot de passe provisoire en privé. La personne devra choisir son propre mot de passe à sa première connexion. Aucun e-mail n’a été envoyé.`;
          } finally {setDirect(v=>({...v,current:''}));}
        });
      }}>
        <label><span className="form-label">Adresse e-mail du nouvel administrateur</span><input className="text-input" type="email" autoComplete="off" autoCapitalize="none" required maxLength={254} value={direct.email} readOnly={confirmDirect} disabled={busy} onChange={e=>{setDirect(v=>({...v,email:e.target.value}));setFeedback(null);}}/></label>
        <label><span className="form-label">Mot de passe provisoire · 12 caractères minimum</span><input className="text-input" type={showPassword?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={direct.password} readOnly={confirmDirect} disabled={busy} onChange={e=>{setDirect(v=>({...v,password:e.target.value}));setFeedback(null);}}/></label>
        <label><span className="form-label">Confirmer le mot de passe provisoire</span><input className="text-input" type={showPassword?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={direct.confirm} readOnly={confirmDirect} disabled={busy} onChange={e=>{setDirect(v=>({...v,confirm:e.target.value}));setFeedback(null);}}/></label>
        <button className="text-button admin-password-visibility" type="button" disabled={busy} onClick={()=>setShowPassword(v=>!v)} aria-pressed={showPassword}>{showPassword?'Masquer':'Afficher'} le mot de passe provisoire</button>
        <div className="admin-direct-note"><Info size={16}/><div><strong>Aucun e-mail ne sera envoyé.</strong><p>Vérifiez que l’adresse est bien celle de la personne : une personne contrôlant cette boîte pourrait récupérer le compte. Transmettez les identifiants par un moyen privé. Ce mot de passe est celui de Fnac Pulse, pas celui de sa messagerie.</p></div></div>
        <label className="admin-direct-check"><input type="checkbox" required checked={direct.verified} disabled={busy||confirmDirect} onChange={e=>{setDirect(v=>({...v,verified:e.target.checked}));setFeedback(null);}}/><span>J’ai vérifié l’adresse. J’accorde à cette personne les droits sur <strong>tous les magasins</strong> et la possibilité d’ajouter d’autres administrateurs.</span></label>
        {!confirmDirect&&<>{message('create')}<button className="primary-button" type="submit" disabled={busy}><Plus size={16}/> Continuer</button></>}
        {confirmDirect&&<div className="admin-invite-confirm">
          <div><strong>Confirmer la création</strong><p>Pour sécuriser l’ajout, confirmez avec votre mot de passe administrateur actuel.</p></div>
          <label><span className="form-label">Votre mot de passe actuel</span><input className="text-input" type="password" autoComplete="current-password" required autoFocus disabled={busy} value={direct.current} onChange={e=>setDirect(v=>({...v,current:e.target.value}))}/></label>
          {message('create')}
          <div className="admin-invite-actions"><button className="primary-button" type="submit" disabled={busy}>{busy?'Création…':'Créer l’accès'} <ArrowRight size={16}/></button><button className="text-button" type="button" disabled={busy} onClick={reviseDirect}>Modifier les informations</button></div>
        </div>}
      </form>
    </section>
    <section className="admin-account-section" aria-labelledby="admin-password-title">
      <div className="admin-section-heading"><div><h3 id="admin-password-title">Modifier mon mot de passe</h3><p>Choisissez un mot de passe unique d’au moins 12 caractères.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run('password',async()=>{
        if(password.next!==password.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        await changeAdminPassword(password.current,password.next);setPassword({current:'',next:'',confirm:''});setDirect(v=>({...v,current:''}));return 'Votre mot de passe a été mis à jour.';
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
