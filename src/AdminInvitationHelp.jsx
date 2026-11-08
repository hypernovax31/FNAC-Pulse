import React,{useRef,useState} from 'react';
import {Check,Info} from 'lucide-react';
import {requestAdminPasswordReset,inspectAdminPasswordReset,confirmAdminPasswordReset,inspectAdminVerification,confirmAdminVerification} from './cloud';

// Le lien et le mot de passe restent dans ce composant et sont envoyés
// uniquement à Firebase Auth ; ils ne sont jamais transmis au Worker.
export function AdminInvitationHelp({email,busy,onBusy,onCompleted,onVerified}) {
  const [link,setLink]=useState(''),[proof,setProof]=useState(null),[next,setNext]=useState(''),[confirm,setConfirm]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const running=useRef(false);
  function clear(){setLink('');setProof(null);setNext('');setConfirm('');setError('');setNotice('');}
  async function run(work) {
    if(running.current)return;
    running.current=true;onBusy(true);setError('');setNotice('');
    try {setNotice(await work()||'');}
    catch(e){setError(e.message||'Opération impossible. Réessayez.');}
    finally {running.current=false;onBusy(false);}
  }
  return <details className="admin-email-fallback admin-invitation-help" onToggle={e=>{if(!e.currentTarget.open)clear();}}>
    <summary>Mot de passe oublié ou lien bloqué ?</summary>
    <p>Pour un compte existant, vous pouvez demander un lien de réinitialisation de mot de passe.</p>
    <p>Pour une nouvelle invitation bloquée, demandez un nouvel envoi à votre administrateur ou ouvrez la <a href="?aide-invitation=1" target="_blank" rel="noopener noreferrer">page de secours</a> pour y coller le lien de connexion.</p>
    <button type="button" className="outline-button" disabled={busy||!email.trim()} onClick={()=>run(async()=>{
      await requestAdminPasswordReset(email);
      return 'Si cette adresse possède un compte compatible, Firebase envoie un nouveau lien. Vérifiez aussi les courriers indésirables.';
    })}>Demander un nouveau lien</button>
    <p>Si la page du lien reste bloquée, copiez le lien complet de réinitialisation ou de confirmation d’adresse depuis votre messagerie et collez-le ici. Ne le partagez avec personne.</p>
    <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
      let mode='';try{mode=new URL(link.trim()).searchParams.get('mode');}catch{}
      const kind=mode==='verifyEmail'?'verification':'password';
      const found=kind==='verification'?await inspectAdminVerification(link):await inspectAdminPasswordReset(link);
      setProof({...found,kind});setLink('');
      return kind==='verification'?'Lien vérifié. Contrôlez l’adresse avant de confirmer.':'Lien vérifié. Contrôlez l’adresse avant de choisir votre mot de passe.';
    });}}>
      <label><span className="form-label">Lien reçu par e-mail</span><input aria-label="Lien de réinitialisation ou de confirmation" className="text-input" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={8192} disabled={busy} value={link} onChange={e=>{setLink(e.target.value);setProof(null);setNext('');setConfirm('');setError('');setNotice('');}} required/></label>
      <button className="outline-button" disabled={busy||!link.trim()}>Vérifier le lien</button>
    </form>
    {proof?.kind==='password'&&<form className="store-form admin-reset-proof" onSubmit={e=>{e.preventDefault();run(async()=>{
      if(next!==confirm)throw new Error('Les deux mots de passe ne correspondent pas.');
      const {code,email:verifiedEmail}=proof;setProof(null);setNext('');setConfirm('');
      const result=await confirmAdminPasswordReset({code,email:verifiedEmail},next);onCompleted(result.email);
      return 'Mot de passe enregistré. Connectez-vous avec votre e-mail et votre nouveau mot de passe.';
    });}}>
      <p><Info size={14}/> Compte concerné : <strong>{proof.email}</strong></p>
      <label><span className="form-label">Votre nouveau mot de passe · 12 caractères minimum</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={next} onChange={e=>setNext(e.target.value)} disabled={busy} required/></label>
      <label><span className="form-label">Confirmer votre mot de passe</span><input className="text-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy} required/></label>
      <button className="primary-button" disabled={busy}>Enregistrer mon mot de passe</button>
    </form>}
    {proof?.kind==='verification'&&<div className="store-form admin-reset-proof">
      <p><Info size={14}/> Adresse à confirmer : <strong>{proof.email}</strong></p>
      <button type="button" className="primary-button" disabled={busy} onClick={()=>run(async()=>{
        const {code,email:verifiedEmail}=proof;setProof(null);
        const result=await confirmAdminVerification({code,email:verifiedEmail});onVerified?.(result.email);
        return 'Adresse confirmée. Connectez-vous ou acceptez votre invitation avec votre mot de passe.';
      })}>Confirmer mon adresse</button>
    </div>}
    {busy&&<p className="admin-email-working" role="status">Échange avec Firebase en cours…</p>}
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status"><Check size={15}/>{notice}</div>}
  </details>;
}
