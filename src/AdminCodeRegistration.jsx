import React, {useRef,useState} from 'react';
import {ArrowRight, Info, ShieldCheck} from 'lucide-react';
import {api} from './api';
import {registerAdminWithCode} from './cloud';

const initial=()=>({code:'',email:'',password:'',confirm:'',accepted:false});
const short=value=>Array.from(value).slice(0,6).join('');
export function AdminCodeRegistration({onRegistered,onCancel,onBusy}) {
  const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[visible,setVisible]=useState(false);
  const running=useRef(false);
  async function submit(e){
    e.preventDefault();if(running.current)return;
    if(!form.accepted){setError('Confirmez que vous contrôlez cette adresse et acceptez les droits.');return;}
    if(!form.password||Array.from(form.password).length>6){setError('Choisissez un mot de passe provisoire de 6 caractères maximum.');return;}
    if(form.password!==form.confirm){setError('Les mots de passe provisoires ne correspondent pas.');return;}
    running.current=true;setBusy(true);onBusy?.(true);setError('');
    try {
      await registerAdminWithCode(api,{code:form.code,email:form.email,password:form.password});
      await onRegistered(form.email.trim().toLowerCase());
      setForm(initial());
    } catch(err){setError(err.message||'Création non confirmée. Reprenez avec les mêmes informations.');}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  return <div className="admin-code-registration">
    <div className="admin-account-current"><ShieldCheck size={18}/><div><strong>Votre accès administrateur</strong><p>Utilisez le code transmis en privé par un administrateur.</p></div></div>
    <p className="admin-first-intro">Créez votre compte sur cet appareil. Après cette étape, vous choisirez un mot de passe personnel d’au moins 12 caractères avant tout accès.</p>
    <form className="store-form" onSubmit={submit}>
      <label><span className="form-label">Code administrateur reçu</span><input className="text-input" type="text" autoComplete="off" autoCapitalize="characters" spellCheck="false" required maxLength={80} placeholder="XXXX-XXXX-XXXX-XXXX" value={form.code} disabled={busy} onChange={e=>setForm(v=>({...v,code:e.target.value}))}/></label>
      <label><span className="form-label">Votre nouvelle adresse e-mail</span><input className="text-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck="false" required maxLength={254} value={form.email} disabled={busy} onChange={e=>setForm(v=>({...v,email:e.target.value}))}/></label>
      <label><span className="form-label">Votre mot de passe provisoire · 6 caractères maximum</span><input className="text-input" type={visible?'text':'password'} autoComplete="off" autoCapitalize="none" spellCheck="false" required maxLength={12} value={form.password} disabled={busy} onChange={e=>setForm(v=>({...v,password:short(e.target.value)}))}/></label>
      <label><span className="form-label">Confirmer le mot de passe provisoire</span><input className="text-input" type={visible?'text':'password'} autoComplete="off" autoCapitalize="none" spellCheck="false" required maxLength={12} value={form.confirm} disabled={busy} onChange={e=>setForm(v=>({...v,confirm:short(e.target.value)}))}/></label>
      <button type="button" className="text-button admin-password-visibility" disabled={busy} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?'Masquer':'Afficher'} le mot de passe provisoire</button>
      <div className="admin-direct-note"><Info size={16}/><div><strong>Aucun e-mail ne sera envoyé.</strong><p>Utilisez une nouvelle adresse dont vous contrôlez la messagerie : Firebase ne vérifiera pas que vous la possédez. Ce mot de passe provisoire est celui de Fnac Pulse, pas celui de votre messagerie.</p></div></div>
      <label className="admin-direct-check"><input type="checkbox" required checked={form.accepted} disabled={busy} onChange={e=>setForm(v=>({...v,accepted:e.target.checked}))}/><span>Je contrôle cette adresse et j’accepte les droits sur <strong>tous les magasins</strong>, y compris la possibilité d’ajouter d’autres administrateurs.</span></label>
      {error&&<div className="admin-alert error" role="alert">{error}</div>}
      <button className="primary-button full-button" disabled={busy}>{busy?'Création…':'Continuer'} <ArrowRight size={16}/></button>
    </form>
    <p className="admin-account-help">Si la création est interrompue, reprenez avec le même code, la même adresse et le même mot de passe provisoire. Pour changer d’adresse après une tentative, demandez un nouveau code.</p>
    <button type="button" className="text-button admin-first-retry" disabled={busy} onClick={onCancel}>Retour à la connexion</button>
  </div>;
}
