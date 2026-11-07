import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api} from './api';
import {ADMIN_SESSION} from './cloud';

// Les demandes sans e-mail créées avant la mise à jour restent traitables.
// Elles ne sont jamais transformées automatiquement en invitations e-mail.
export function LegacyAdminRequests({disabled,onBusy}) {
  const [items,setItems]=useState([]),[next,setNext]=useState(''),[loading,setLoading]=useState(true),[more,setMore]=useState(false);
  const [review,setReview]=useState(null),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(true),sequence=useRef(0),running=useRef(false),browsingPages=useRef(false);
  async function load(after='',silent=false) {
    if(silent&&browsingPages.current)return;
    if(after){browsingPages.current=true;setMore(true);}else if(!silent)browsingPages.current=false;
    const current=++sequence.current;
    try {
      const value=await api(`/api/admin/access-requests${after?`?after=${encodeURIComponent(after)}`:''}`,{token:ADMIN_SESSION});
      if(alive.current&&current===sequence.current) {
        const page=Array.isArray(value.requests)?value.requests:[];
        setItems(old=>after?[...old,...page.filter(item=>!old.some(previous=>previous.requestId===item.requestId))]:page);
        setNext(typeof value.next==='string'?value.next:'');setError('');
      }
    } catch(e){if(alive.current&&current===sequence.current)setError(e.message||'Impossible de charger les demandes.');}
    finally{if(alive.current&&current===sequence.current){setLoading(false);setMore(false);}}
  }
  useEffect(()=>{alive.current=true;load();const refresh=()=>{if(document.visibilityState==='visible')load('',true);};document.addEventListener('visibilitychange',refresh);const timer=setInterval(refresh,15000);return()=>{alive.current=false;document.removeEventListener('visibilitychange',refresh);clearInterval(timer);};},[]);
  async function decide(item,approve) {
    if(running.current)return;
    if(approve&&!verified){setError('Confirmez la vérification de l’identité.');return;}
    if(!approve&&!window.confirm(`Annuler la demande pour ${item.email} ? Aucun compte Firebase ne sera supprimé.`))return;
    running.current=true;setBusy(true);onBusy?.(true);setError('');setNotice('');
    const body={email:item.email,requestId:item.requestId,claimantUid:item.claimantUid||'',confirmed:true,...(approve?{identityVerified:true}:{})};
    const path=approve?'/api/admin/access-requests/approve':'/api/admin/access-requests/cancel';
    try {
      try{await api(path,{method:'POST',token:ADMIN_SESSION,body});}
      catch(e){if(e?.status&&e.status<500&&e.status!==408&&e.status!==429)throw e;await api(path,{method:'POST',token:ADMIN_SESSION,body});}
      if(alive.current){setReview(null);setVerified(false);await load();if(alive.current)setNotice(approve?'Accès validé. La personne peut maintenant se connecter.':'Demande annulée. Aucun compte Firebase n’a été supprimé.');}
    } catch(e){if(alive.current)setError(e.message||'Opération non confirmée. Réessayez.');}
    finally {running.current=false;if(alive.current)setBusy(false);onBusy?.(false);}
  }
  const locked=disabled||busy;
  return <div className="admin-legacy-body">
    <div className="admin-requests-heading"><div><h4>Demandes précédentes</h4><p>La vérification manuelle reste nécessaire pour ces demandes.</p></div><button type="button" className="admin-requests-refresh" aria-label="Actualiser les anciennes demandes" disabled={locked} onClick={()=>load()}><RefreshCw size={15}/></button></div>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}
    {notice&&<div className="admin-alert success" role="status">{notice}</div>}
    {loading?<p className="admin-account-help">Chargement…</p>:items.length===0?<div className="admin-request-empty">Aucune demande sur cette page.</div>:<div className="admin-request-list">{items.map(item=><div className="admin-request" key={item.requestId}>
      <div className="admin-request-copy"><strong>{item.email}</strong><span>{item.status==='pending'?'Identité à vérifier':'En attente de la première connexion'}</span></div>
      <div className="admin-request-actions">{item.status==='pending'&&item.claimantUid&&<button type="button" className="admin-request-review" disabled={locked} onClick={()=>{setReview(item);setVerified(false);setError('');}}>Vérifier</button>}
        <button type="button" className="admin-request-cancel" disabled={locked} onClick={()=>decide(item,false)}>Annuler</button></div>
      {review?.requestId===item.requestId&&<div className="admin-approval" role="group" aria-label={`Vérifier ${item.email}`}>
        <strong>Vérifiez la personne avant de valider</strong>
        <p>Vérifiez son identité par un autre moyen et demandez-lui de montrer son écran « Demande en attente ». L’adresse n’est pas vérifiée automatiquement.</p>
        <label className="admin-direct-check"><input type="checkbox" checked={verified} disabled={locked} onChange={e=>setVerified(e.target.checked)}/><span>J’ai vérifié son identité et vu son écran. Je lui accorde les droits sur <b>tous les magasins</b>, y compris l’invitation d’autres administrateurs.</span></label>
        <div><button type="button" className="outline-button" disabled={locked} onClick={()=>{setReview(null);setVerified(false);}}>Retour</button><button type="button" className="primary-button" disabled={locked||!verified} onClick={()=>decide(item,true)}>Valider l’accès</button></div>
      </div>}
    </div>)}</div>}
    {next&&<button type="button" className="outline-button admin-requests-more" disabled={locked||more} onClick={()=>load(next)}>{more?'Chargement…':'Charger la suite'}</button>}
  </div>;
}
