import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api, uid } from './api';
import { SERVICE_DELETE_CONFIRMATION } from './service-delete.js';

const pendingKey=storeId=>`fnac-pulse-service-delete:${storeId}`;
function readPending(storeId) {
  try {
    const value=JSON.parse(sessionStorage.getItem(pendingKey(storeId))||'null');
    return value&&typeof value.jobId==='string'&&Number.isSafeInteger(value.serviceId)?value:null;
  } catch{return null;}
}
function rememberPending(storeId,value) {
  try {if(value)sessionStorage.setItem(pendingKey(storeId),JSON.stringify(value));else sessionStorage.removeItem(pendingKey(storeId));}catch{}
}

// Le job confirmé est mémorisé jusqu'à une réponse fiable : une coupure réseau
// ne doit jamais lancer un second effacement avec un autre identifiant.
export function ServiceDeletePanel({storeId,storeName,token,disabled,requested,onRequestHandled,onAvailabilityChange,onUpdate}) {
  const [status,setStatus]=useState(null),[statusError,setStatusError]=useState('');
  const [pending,setPending]=useState(()=>readPending(storeId));
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState(''),[target,setTarget]=useState(null);
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[refresh,setRefresh]=useState(0);
  const notify=useRef(onUpdate),available=useRef(onAvailabilityChange),handled=useRef(onRequestHandled),alive=useRef(false),observed=useRef(null),resolved=useRef(''),confirmation=useRef(null);
  notify.current=onUpdate;available.current=onAvailabilityChange;handled.current=onRequestHandled;
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;available.current?.(false);};},[]);
  useEffect(()=>{
    let stopped=false,timer,last=status;
    const poll=async()=>{
      try {
        const next=await api(`/api/admin/services/delete?storeId=${encodeURIComponent(storeId)}`,{token});
        if(stopped)return;
        last=next;setStatus(next);setStatusError('');
        if(pending&&next.jobId===pending.jobId&&['running','done','needs-review'].includes(next.status)) {
          resolved.current=pending.jobId;rememberPending(storeId,null);setPending(null);setActionError('');setOpen(false);setPhrase('');notify.current?.();
        }
        const signature=next.jobId?`${next.jobId}:${next.status}`:'';
        if(observed.current!==null&&signature!==observed.current&&next.jobId)notify.current?.();
        observed.current=signature;
      } catch {if(!stopped)setStatusError('Impossible de vérifier l’état de la suppression. Vérifiez la connexion.');}
      if(!stopped)timer=setTimeout(poll,last?.status==='running'||pending?3000:15000);
    };
    poll();return ()=>{stopped=true;clearTimeout(timer);};
  },[storeId,token,refresh,pending?.jobId]);
  const running=status?.status==='running';
  const ready=!disabled&&!busy&&!!storeName&&!pending&&!statusError&&['idle','done'].includes(status?.status);
  useEffect(()=>{available.current?.(ready&&!open);},[ready,open]);
  useEffect(()=>{
    if(!requested)return;
    if(ready) {setTarget(requested);setPhrase('');setActionError('');setOpen(true);}
    else setActionError('Attendez que l’état de suppression soit disponible avant de choisir un service.');
    handled.current?.();
  },[requested]);
  useEffect(()=>{if(open)confirmation.current?.scrollIntoView?.({block:'nearest'});},[open]);

  async function submit(previous) {
    const request=previous||{jobId:uid(),serviceId:target.id,serviceName:target.name,storeName:target.storeName};
    setBusy(true);setActionError('');setPending(request);rememberPending(storeId,request);
    try {
      const result=await api('/api/admin/services/delete',{method:'POST',token,body:{storeId,jobId:request.jobId,serviceId:request.serviceId,expectedName:request.serviceName,expectedStoreName:request.storeName,confirmation:SERVICE_DELETE_CONFIRMATION}});
      if(!alive.current)return;
      if(!['running','done','needs-review','superseded'].includes(result.status)||result.jobId!==request.jobId)throw new Error('État de suppression invalide.');
      rememberPending(storeId,null);setPending(null);setOpen(false);setPhrase('');
      if(result.status==='superseded')setActionError('Cette demande a déjà été traitée ou remplacée. Aucune nouvelle suppression n’a été lancée.');
      else {setStatus(result);notify.current?.();}
      setRefresh(value=>value+1);
    } catch(e) {
      if(alive.current) {
        setOpen(false);setPhrase('');
        if(resolved.current===request.jobId)setActionError('');
        // Un délai HTTP ou une limitation intermédiaire ne prouve pas que le
        // Worker n’a pas reçu la demande : conserver son identifiant pour le rejeu.
        else if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){rememberPending(storeId,null);setPending(null);setActionError(e.message||'La demande a été refusée.');if(e.status===409)notify.current?.();}
        else setActionError('Le lancement n’a pas pu être confirmé. Vérifiez ou reprenez cette même demande avant toute nouvelle suppression.');
        setRefresh(value=>value+1);
      }
    } finally {if(alive.current)setBusy(false);}
  }
  const unavailable=disabled||busy||!ready||!target;
  return <section className="sales-reset service-delete" aria-labelledby="service-delete-title">
    <div className="sales-reset-heading"><div><h4 id="service-delete-title">Suppression d’un service</h4><p>Utilisez la corbeille à côté d’un service pour le retirer de ce magasin et effacer ses données.</p></div></div>
    {running&&<p className="sales-reset-progress" role="status">Suppression de {status.serviceName} en cours : {status.deletedSales} opération{status.deletedSales>1?'s':''} de vente et {status.deletedGoals} objectif{status.deletedGoals>1?'s':''} effacé{status.deletedGoals>1?'s':''}. Vous pouvez fermer cette fenêtre.</p>}
    {status?.status==='done'&&!pending&&!open&&<p className="sales-reset-progress" role="status">Dernière suppression terminée : {status.serviceName} · {status.deletedSales} opération{status.deletedSales>1?'s':''} de vente et {status.deletedGoals} objectif{status.deletedGoals>1?'s':''} effacé{status.deletedGoals>1?'s':''}.</p>}
    {status?.status==='needs-review'&&<p className="sales-reset-error" role="alert">La suppression de {status.serviceName} nécessite une vérification technique : certaines données incohérentes n’ont pas été effacées. La réactivation et toute nouvelle suppression de service sont bloquées.</p>}
    {statusError&&<div className="sales-reset-error" role="alert">{statusError} <button type="button" onClick={()=>setRefresh(value=>value+1)}>Vérifier</button></div>}
    {actionError&&<p className="sales-reset-error" role="alert">{actionError}</p>}
    {pending&&!open&&<div className="sales-reset-recovery"><p>Une demande pour {pending.serviceName||'ce service'} attend confirmation. Reprenez la même demande pour éviter un nouvel effacement.</p><button type="button" className="outline-button" disabled={busy||disabled} onClick={()=>submit(pending)}>Vérifier ou reprendre</button></div>}
    {open&&<div ref={confirmation} className="sales-reset-confirm" role="group" aria-labelledby="service-delete-confirm-title">
      <div className="sales-reset-warning"><AlertTriangle size={19} aria-hidden="true"/><div>
        <strong id="service-delete-confirm-title">Supprimer {target?.name} de {target?.storeName} ?</strong>
        <p>Toutes les ventes de ce service, à toutes les dates et pour tous les vendeurs et départements de ce magasin, ainsi que leurs objectifs pour ce service, seront définitivement effacés. Les bilans historiques seront modifiés.</p>
        <p>Les autres services, les vendeurs, leurs plannings et les autres magasins sont conservés. Le service reste disponible dans les autres magasins. Même en le réactivant plus tard, les données effacées ne reviendront pas.</p>
        <p>Le traitement peut prendre du temps ; les notifications déjà reçues ou en cours d’envoi ne peuvent pas être retirées.</p>
      </div></div>
      <form onSubmit={event=>{event.preventDefault();if(phrase===SERVICE_DELETE_CONFIRMATION&&!unavailable)submit(null);}}>
        <label><span className="form-label">Tapez {SERVICE_DELETE_CONFIRMATION} pour confirmer</span><input className="text-input" aria-label="Confirmation de suppression du service" value={phrase} onChange={event=>setPhrase(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy||disabled} autoFocus/></label>
        <div className="sales-reset-actions"><button type="button" className="outline-button" disabled={busy} onClick={()=>{setOpen(false);setPhrase('');}}>Annuler</button><button type="submit" className="sales-reset-danger" disabled={unavailable||phrase!==SERVICE_DELETE_CONFIRMATION}>{busy?'Démarrage…':<><Trash2 size={14} aria-hidden="true"/> Supprimer définitivement</>}</button></div>
      </form>
    </div>}
  </section>;
}
