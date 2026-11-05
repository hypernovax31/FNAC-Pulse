import React, {useRef,useState} from 'react';
import {ArrowRight, ShieldCheck} from 'lucide-react';
import {changeAdminPassword, changeFirstCodeAdminPassword} from './cloud';

// Le serveur ne lève le blocage qu'après avoir vérifié auprès de Firebase que
// le mot de passe du compte a changé depuis sa création. Ce formulaire ne
// suffit donc jamais à lui seul pour obtenir des droits.
export function AdminFirstPassword({email,onFinish,onCancel,onBusy,method='direct',temporaryPassword=null}) {
  const codeMethod=method==='code',knownTemporary=!codeMethod&&typeof temporaryPassword==='string'&&!!temporaryPassword;
  const [form,setForm]=useState({current:'',next:'',confirm:''}),[changed,setChanged]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false);
  async function run(work){
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setError('');
    try{await work();}catch(e){setError(e.message||'Connexion impossible. Réessayez.');}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  async function finish(newPassword){await onFinish(newPassword);}
  return <div className="admin-first-password">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre accès administrateur</strong><p>{email}</p></div></div>
    {!changed?<>
      <p className="admin-first-intro">Remplacez le mot de passe provisoire par un mot de passe personnel avant d’accéder à l’administration. Ne le communiquez pas.</p>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        if(form.next.length<12||form.next.length>128)throw new Error('Le nouveau mot de passe doit comporter de 12 à 128 caractères.');
        if(form.next!==form.confirm)throw new Error('Les nouveaux mots de passe ne correspondent pas.');
        const current=knownTemporary?temporaryPassword:form.current;
        if(!codeMethod&&form.next===current)throw new Error('Choisissez un mot de passe différent du mot de passe provisoire.');
        const nextPassword=form.next;
        if(codeMethod)await changeFirstCodeAdminPassword(nextPassword);
        else await changeAdminPassword(current,nextPassword);
        setForm({current:'',next:'',confirm:''});setChanged(true);
        try{await finish(nextPassword);}catch{throw new Error('Mot de passe modifié, mais l’accès n’est pas encore confirmé. Appuyez sur « Terminer » ou reconnectez-vous avec votre nouveau mot de passe.');}
      });}}>
        {!codeMethod&&!knownTemporary&&<label><span className="form-label">Mot de passe provisoire</span><input className="text-input" type="password" autoComplete="current-password" required disabled={busy} value={form.current} onChange={e=>setForm(v=>({...v,current:e.target.value}))}/></label>}
        <label><span className="form-label">Votre nouveau mot de passe · 12 caractères minimum</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={form.next} onChange={e=>setForm(v=>({...v,next:e.target.value}))}/></label>
        <label><span className="form-label">Confirmer votre nouveau mot de passe</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={form.confirm} onChange={e=>setForm(v=>({...v,confirm:e.target.value}))}/></label>
        {error&&<div className="admin-alert error" role="alert">{error}</div>}
        <button className="primary-button full-button" disabled={busy}>{busy?'Enregistrement…':'Enregistrer mon mot de passe'} <ArrowRight size={16}/></button>
      </form>
      <button type="button" className="text-button admin-first-retry" disabled={busy} onClick={()=>run(finish)}>J’ai déjà modifié mon mot de passe</button>
    </>:<>
      <p className="admin-first-intro">Votre mot de passe a été modifié. Terminez la connexion pour accéder à l’administration.</p>
      {error&&<div className="admin-alert error" role="alert">{error}</div>}
      <button type="button" className="primary-button full-button" disabled={busy} onClick={()=>run(finish)}>Terminer <ArrowRight size={16}/></button>
    </>}
    <button type="button" className="text-button admin-first-retry" disabled={busy} onClick={onCancel}>Se déconnecter</button>
  </div>;
}
