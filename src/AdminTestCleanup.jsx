import React,{useRef,useState} from 'react';
import {api} from './api';
import {ADMIN_SESSION,deleteTestFirebaseAccount} from './cloud';
import {invitationAddress} from './admin-invitation.js';

// Outil volontairement séparé de l'ajout : seul le compte de test dont
// l'adresse est saisie et confirmée dans l'application peut être ciblé.
export function AdminTestCleanup({disabled,onBusy}) {
  const [address,setAddress]=useState(''),[item,setItem]=useState(null),[confirmed,setConfirmed]=useState(false),[password,setPassword]=useState('');
  const [revoked,setRevoked]=useState(false),[deleted,setDeleted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(null);
  const running=useRef(false);
  async function run(work) {
    if(running.current)return;
    running.current=true;setBusy(true);onBusy?.(true);setMessage(null);
    try {await work();}catch(e){setMessage({error:true,text:e.message||'Opération non confirmée. Vérifiez avant de réessayer.'});}
    finally{running.current=false;setBusy(false);onBusy?.(false);}
  }
  return <details className="admin-test-cleanup">
    <summary>Supprimer le compte de test précédent</summary>
    <div className="admin-cleanup-body">
      <p>Saisissez uniquement l’adresse utilisée pour ce test. Elle reste dans l’application, sans être communiquée dans la conversation.</p>
      <form className="store-form" onSubmit={e=>{e.preventDefault();run(async()=>{
        const email=invitationAddress(address),result=await api('/api/admin/old-test/inspect',{method:'POST',token:ADMIN_SESSION,body:{email}});
        setItem(result);setConfirmed(false);setRevoked(false);setDeleted(false);setPassword('');
      });}}>
        <label><span className="form-label">Adresse exacte du compte de test</span><input className="text-input" type="email" value={address} disabled={disabled||busy} required autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e=>{setAddress(e.target.value);setItem(null);setRevoked(false);setDeleted(false);setConfirmed(false);setMessage(null);}}/></label>
        <button type="submit" className="outline-button" disabled={disabled||busy}>Rechercher ce compte</button>
      </form>
      {item&&!item.found&&<p className="admin-account-help">Aucun droit de l’ancien parcours ni ancienne demande n’a été trouvé pour cette adresse. Si un compte Firebase existe, vérifiez-le dans Firebase Console → Authentication → Users : sa suppression n’est pas confirmée ici.</p>}
      {item?.found&&!deleted&&<div className="admin-cleanup-result">
        <strong>{item.email}</strong>
        {item.uid&&<small>Identifiant Firebase : {item.uid}</small>}
        {!revoked?<>
          <p>{item.grantActive?'Un droit de l’ancien parcours a été trouvé.':'Aucun droit actif de l’ancien parcours n’a été trouvé.'} {item.createdAt?`Création du droit : ${new Date(item.createdAt).toLocaleDateString('fr-FR')}.`:''}</p>
          <label className="admin-direct-check"><input type="checkbox" checked={confirmed} disabled={disabled||busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Je confirme que cette adresse est celle du compte de test précédent.</span></label>
          <button type="button" className="history-delete" disabled={disabled||busy||!confirmed} onClick={()=>run(async()=>{
            const body={email:item.email,uid:item.uid||'',confirmed:true};let result;
            try {result=await api('/api/admin/old-test/revoke',{method:'POST',token:ADMIN_SESSION,body});}
            catch(error){if(error?.status&&error.status<500&&error.status!==408&&error.status!==429)throw error;result=await api('/api/admin/old-test/revoke',{method:'POST',token:ADMIN_SESSION,body});}
            if(!result?.ok||result.uid!==(item.uid||''))throw new Error('État non confirmé. Recherchez le compte à nouveau.');
            setRevoked(true);setMessage({error:false,text:'Droits retirés et ancienne demande fermée. Le compte Firebase existe peut-être encore.'});
          })}>Retirer les droits de ce test</button>
        </>:<>
          {item.uid&&<form className="store-form" onSubmit={e=>{e.preventDefault();
            if(!window.confirm(`Supprimer définitivement le compte Firebase ${item.email} (${item.uid}) ? Les autres comptes seront conservés.`))return;
            run(async()=>{await deleteTestFirebaseAccount(api,{email:item.email,uid:item.uid,password});setPassword('');setDeleted(true);setMessage({error:false,text:'Ce compte Firebase a été supprimé et ses droits ont été retirés.'});});
          }}>
            <label><span className="form-label">Mot de passe du compte de test</span><input className="text-input" type="password" autoComplete="off" value={password} disabled={disabled||busy} required onChange={e=>setPassword(e.target.value)}/></label>
            <button type="submit" className="history-delete" disabled={disabled||busy}>Supprimer ce compte Firebase</button>
          </form>}
          <p className="admin-account-help">{item.uid?'Si vous ne connaissez pas son mot de passe,':'L’identifiant du compte n’a pas pu être établi automatiquement ;'} ouvrez Firebase Console → Authentication → Users, recherchez cette adresse{item.uid?' et vérifiez l’identifiant ci-dessus':''}, puis supprimez uniquement ce compte. L’application ne peut pas confirmer cette suppression manuelle.</p>
        </>}
      </div>}
      {message&&<div className={`admin-alert ${message.error?'error':'success'}`} role={message.error?'alert':'status'}>{message.text}</div>}
    </div>
  </details>;
}
