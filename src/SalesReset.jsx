import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { api, uid } from './api';
import { SALES_RESET_CONFIRMATION } from './sales-reset.js';

const pendingKey=storeId=>`fnac-pulse-sales-reset:${storeId}`;
function readPending(storeId) {try{return sessionStorage.getItem(pendingKey(storeId))||'';}catch{return '';}}
function rememberPending(storeId,jobId) {try{if(jobId)sessionStorage.setItem(pendingKey(storeId),jobId);else sessionStorage.removeItem(pendingKey(storeId));}catch{}}

// La suppression est déclenchée uniquement après une confirmation explicite.
// Le même identifiant est conservé en cas de réponse perdue : le serveur ne
// relancera jamais un deuxième reset pour cette même demande.
export function SalesResetPanel({storeId,storeName,token,disabled,onUpdate}) {
  const [status,setStatus]=useState(null),[statusError,setStatusError]=useState('');
  const [pending,setPending]=useState(()=>readPending(storeId));
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState('');
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const notify=useRef(onUpdate),alive=useRef(false),observedRunning=useRef(''),observedJob=useRef(null),resolvedRequest=useRef('');
  notify.current=onUpdate;
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let stopped=false,timer,last=status;
    const poll=async()=>{
      try {
        const next=await api(`/api/admin/sales/reset?storeId=${encodeURIComponent(storeId)}`,{token});
        if(stopped)return;
        last=next;setStatus(next);setStatusError('');
        if(pending&&next.jobId===pending&&(next.status==='running'||next.status==='done')) {
          resolvedRequest.current=pending;rememberPending(storeId,'');setPending('');setActionError('');notify.current?.();
        }
        if(observedJob.current!==null&&next.jobId&&next.jobId!==observedJob.current)notify.current?.();
        observedJob.current=next.jobId||'';
        if(next.status==='running')observedRunning.current=next.jobId;
        else if(next.status==='done'&&observedRunning.current===next.jobId) {
          observedRunning.current='';notify.current?.();
        }
      } catch(e) {if(!stopped)setStatusError('Impossible de vérifier l’état du reset. Vérifiez la connexion.');}
      if(!stopped)timer=setTimeout(poll,last?.status==='running'||pending?3000:15000);
    };
    poll();return ()=>{stopped=true;clearTimeout(timer);};
  },[storeId,token,refresh,pending]);

  async function submit(jobId) {
    const id=jobId||uid();setBusy(true);setActionError('');setPending(id);rememberPending(storeId,id);
    try {
      const result=await api('/api/admin/sales/reset',{method:'POST',token,body:{storeId,jobId:id,confirmation:SALES_RESET_CONFIRMATION}});
      if(!alive.current)return;
      if(!['running','done','superseded'].includes(result.status)||result.jobId!==id)throw new Error('État du reset invalide.');
      rememberPending(storeId,'');setPending('');setOpen(false);setPhrase('');
      if(result.status==='superseded')setActionError('Cette demande a déjà été traitée ou remplacée. Aucune nouvelle suppression n’a été lancée.');
      else {setStatus(result);if(result.status==='running')observedRunning.current=id;notify.current?.();}
      setRefresh(value=>value+1);
    } catch(e) {
      if(alive.current){
        setOpen(false);setPhrase('');
        if(resolvedRequest.current===id)setActionError('');
        else if(e.status>=400&&e.status<500){rememberPending(storeId,'');setPending('');setActionError(e.message||'La demande a été refusée.');}
        else setActionError('Le lancement n’a pas pu être confirmé. Vérifiez ou reprenez cette même demande avant tout nouveau reset.');
        setRefresh(value=>value+1);
      }
    } finally {if(alive.current)setBusy(false);}
  }
  const running=status?.status==='running';
  const unavailable=disabled||busy||!storeName||!['idle','done'].includes(status?.status)||!!statusError||!!pending;
  return <section className="sales-reset" aria-labelledby="sales-reset-title">
    <div className="sales-reset-heading"><div><h4 id="sales-reset-title">Reset global des ventes</h4><p>Tous les services, vendeurs et départements du magasin sélectionné.</p></div>
      {!open&&<button type="button" className="sales-reset-button" disabled={unavailable} onClick={()=>{setActionError('');setOpen(true);}}> <RotateCcw size={15} aria-hidden="true"/> Reset global</button>}
    </div>
    {running&&<p className="sales-reset-progress" role="status">Suppression en cours : {status.deletedSales} vente{status.deletedSales>1?'s':''} supprimée{status.deletedSales>1?'s':''}. Les nouvelles ventes restent possibles. Vous pouvez fermer cette fenêtre.</p>}
    {status?.status==='done'&&!pending&&!open&&<p className="sales-reset-progress" role="status">Dernier reset terminé : {status.deletedSales} vente{status.deletedSales>1?'s':''} supprimée{status.deletedSales>1?'s':''}.</p>}
    {statusError&&<div className="sales-reset-error" role="alert">{statusError} <button type="button" onClick={()=>setRefresh(value=>value+1)}>Vérifier</button></div>}
    {actionError&&<p className="sales-reset-error" role="alert">{actionError}</p>}
    {pending&&!open&&<div className="sales-reset-recovery"><p>Une demande attend confirmation. Réessayez avec le même identifiant pour éviter un second reset.</p><button type="button" className="outline-button" disabled={busy||disabled} onClick={()=>submit(pending)}>Vérifier ou reprendre</button></div>}
    {open&&<div className="sales-reset-confirm" role="group" aria-labelledby="sales-reset-confirm-title">
      <div className="sales-reset-warning"><AlertTriangle size={19} aria-hidden="true"/><div><strong id="sales-reset-confirm-title">Supprimer toutes les ventes de {storeName} ?</strong><p>L’historique complet, à toutes les dates et pour tous les vendeurs et départements de ce magasin, sera définitivement supprimé. Cette action est irréversible.</p><p>Les objectifs, services, vendeurs, PIN et autres magasins sont conservés. Les nouvelles ventes pourront être enregistrées après le démarrage du reset.</p><p>Pour voir les chiffres à jour, les appareils doivent être en ligne et utiliser la dernière version.</p></div></div>
      <form onSubmit={event=>{event.preventDefault();if(phrase===SALES_RESET_CONFIRMATION&&!unavailable)submit('');}}>
        <label><span className="form-label">Tapez {SALES_RESET_CONFIRMATION} pour confirmer</span><input className="text-input" aria-label="Confirmation du reset" value={phrase} onChange={event=>setPhrase(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy||disabled} autoFocus/></label>
        <div className="sales-reset-actions"><button type="button" className="outline-button" disabled={busy} onClick={()=>{setOpen(false);setPhrase('');}}>Annuler</button><button type="submit" className="sales-reset-danger" disabled={unavailable||phrase!==SALES_RESET_CONFIRMATION}>{busy?'Démarrage…':'Supprimer toutes les ventes'}</button></div>
      </form>
    </div>}
  </section>;
}
