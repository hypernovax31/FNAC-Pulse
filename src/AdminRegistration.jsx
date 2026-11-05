import React,{useRef,useState} from 'react';
import {ArrowRight,ShieldCheck} from 'lucide-react';
import {api} from './api';
import {registerAdminForApproval} from './cloud';

export function AdminRegistration({initialEmail='',onRegistered,onCancel,onBusy}) {
  const [form,setForm]=useState({email:initialEmail,password:'',confirm:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false);
  async function submit(event) {
    event.preventDefault();if(running.current)return;
    if(form.password.length<12||form.password.length>128){setError('Choisissez un mot de passe de 12 à 128 caractères.');return;}
    if(form.password!==form.confirm){setError('Les mots de passe ne correspondent pas.');return;}
    running.current=true;setBusy(true);onBusy?.(true);setError('');
    try {
      const address=form.email.trim().toLowerCase(),result=await registerAdminForApproval(api,{email:address,password:form.password});
      setForm({email:address,password:'',confirm:''});await onRegistered(address,result.status);
    } catch(e){setError(e.message||'La demande n’est pas confirmée. Réessayez avec les mêmes informations.');}
    finally {running.current=false;setBusy(false);onBusy?.(false);}
  }
  return <div className="admin-registration">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Première connexion</strong><p>Votre adresse doit d’abord avoir été ajoutée par un administrateur.</p></div></div>
    <form className="store-form" onSubmit={submit}>
      <label><span className="form-label">Votre adresse e-mail</span><input className="text-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={form.email} disabled={busy} onChange={e=>setForm(v=>({...v,email:e.target.value}))}/></label>
      <label><span className="form-label">Votre mot de passe · 12 caractères minimum</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} disabled={busy} onChange={e=>setForm(v=>({...v,password:e.target.value}))}/></label>
      <label><span className="form-label">Confirmer votre mot de passe</span><input className="text-input" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.confirm} disabled={busy} onChange={e=>setForm(v=>({...v,confirm:e.target.value}))}/></label>
      <p className="admin-account-help">Aucun e-mail n’est envoyé. Après création, un administrateur vérifiera votre identité et validera votre accès à tous les magasins.</p>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <button className="primary-button full-button" disabled={busy}>{busy?'Création…':'Créer mon compte'} <ArrowRight size={16}/></button>
    </form>
    <button type="button" className="text-button admin-first-retry" disabled={busy} onClick={onCancel}>J’ai déjà un compte · Se connecter</button>
  </div>;
}
