import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight, Check, Info, LogOut, Plus, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {adminAccountEmail, changeAdminPassword, createAdministrator, requestAdminEmailChange} from './cloud';

export function AdminAccounts({onLogout,onBusy}) {
  const [email,setEmail]=useState('');
  const [add,setAdd]=useState({email:'',password:'',confirm:'',current:'',existing:false});
  const [password,setPassword]=useState({current:'',next:'',confirm:''});
  const [address,setAddress]=useState({current:'',next:''});
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
  async function run(work) {
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setError('');setNotice('');
    try {const message=await work();setNotice(message);}
    catch(e){setError(e.message||'Opération impossible. Réessayez.');}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  return <div className="admin-accounts">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre compte administrateur</strong><p>{email||'Chargement de votre adresse…'}</p></div></div>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
    <section className="admin-account-section" aria-labelledby="admin-create-title">
      <div className="admin-section-heading"><div><h3 id="admin-create-title">Ajouter un administrateur</h3><p>Il aura les mêmes droits sur tous les magasins et pourra ajouter d’autres administrateurs.</p></div></div>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        if(add.password!==add.confirm)throw new Error('Les mots de passe du nouveau compte ne correspondent pas.');
        const result=await createAdministrator(api,{email:add.email,password:add.password,currentPassword:add.current,existing:add.existing});
        setAdd({email:'',password:'',confirm:'',current:'',existing:false});
        if(result.verificationRequired)return 'Un lien de confirmation a été envoyé. Les droits seront actifs après validation de l’e-mail et connexion avec le mot de passe choisi.';
        return result.already?'Ce compte est déjà administrateur.':'Administrateur ajouté. Il peut se connecter avec son e-mail et son mot de passe.';
      });}}>
        <label><span className="form-label">E-mail du nouvel administrateur</span><input className="text-input" type="email" autoComplete="off" required maxLength={254} value={add.email} onChange={e=>setAdd(v=>({...v,email:e.target.value}))}/></label>
        <label><span className="form-label">Mot de passe {add.existing?'du compte existant':'initial'} · 12 caractères minimum</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={add.password} onChange={e=>setAdd(v=>({...v,password:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer ce mot de passe</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={add.confirm} onChange={e=>setAdd(v=>({...v,confirm:e.target.value}))}/></label>
        <label className="admin-account-checkbox"><input type="checkbox" checked={add.existing} onChange={e=>setAdd(v=>({...v,existing:e.target.checked}))}/><span>Compte existant : j’ai l’accord de son titulaire et son mot de passe.</span></label>
        <p className="admin-account-help"><Info size={14}/><span>Le titulaire reçoit un lien si son e-mail n’est pas encore confirmé. Communiquez-lui le mot de passe initial de manière sécurisée ; il pourra ensuite le modifier.</span></p>
        <label><span className="form-label">Votre mot de passe administrateur actuel</span><input className="text-input" type="password" autoComplete="current-password" required value={add.current} onChange={e=>setAdd(v=>({...v,current:e.target.value}))}/></label>
        <button className="primary-button" disabled={busy}><Plus size={16}/> Ajouter l’administrateur</button>
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
    </section>
    <button type="button" className="logout-button" disabled={busy} onClick={onLogout}><LogOut size={15}/> Déconnexion administrateur</button>
  </div>;
}
