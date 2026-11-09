import React, { useEffect, useRef, useState } from 'react';
import { VisibleFeedback, useFeedbackState } from './VisibleFeedback';
import { useTrackedJobFeedback } from './TrackedJobFeedback';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api, uid } from './api';
import { SELLER_DELETE_CONFIRMATION } from './seller-delete.js';
import { sellerDepartmentId } from './departments.js';

const pendingKey=storeId=>`fnac-pulse-seller-delete:${storeId}`;
function readPending(storeId) {
  try {
    const value=JSON.parse(sessionStorage.getItem(pendingKey(storeId))||'null');
    return value&&typeof value.jobId==='string'&&Number.isSafeInteger(value.sellerId)?value:null;
  } catch{return null;}
}
function rememberPending(storeId,value) {
  try {if(value)sessionStorage.setItem(pendingKey(storeId),JSON.stringify(value));else sessionStorage.removeItem(pendingKey(storeId));}catch{}
}

// Une demande confirmée est conservée tant qu'on ne sait pas si le serveur l'a
// reçue. En cas de réponse perdue, reprendre avec le même identifiant.
export function SellerDeletePanel({storeId,storeName,sellers,departments=[],token,disabled,onUpdate}) {
  const [sellerId,setSellerId]=useState('');
  const [status,setStatus]=useState(null),[statusError,setStatusError]=useState('');
  const [pending,setPending]=useState(()=>readPending(storeId));
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState(''),[target,setTarget]=useState(null);
  const [busy,setBusy]=useState(false),[actionError,setActionError,actionRevision]=useFeedbackState(''),[refresh,setRefresh]=useState(0);
  const jobFeedback=useTrackedJobFeedback('seller-delete',storeId,pending?.jobId,job=>({message:job.status==='running'?`Suppression de ${job.sellerName||'ce vendeur'} en cours. Vous pouvez fermer cette fenêtre.`:`Suppression du vendeur terminée : ${job.deletedSales} opération${job.deletedSales>1?'s':''} de vente effacée${job.deletedSales>1?'s':''}.`}));
  const notify=useRef(onUpdate),alive=useRef(false),observed=useRef(null),resolvedRequest=useRef('');
  notify.current=onUpdate;
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let stopped=false,timer,last=status;
    const poll=async()=>{
      try {
        const next=await api(`/api/admin/sellers/delete?storeId=${encodeURIComponent(storeId)}`,{token});
        if(stopped)return;
        last=next;setStatus(next);setStatusError('');jobFeedback.observe(next);
        if(pending&&next.jobId===pending.jobId&&(next.status==='running'||next.status==='done')) {
          resolvedRequest.current=pending.jobId;rememberPending(storeId,null);setPending(null);setActionError('');setOpen(false);setPhrase('');notify.current?.();
        }
        const signature=next.jobId?`${next.jobId}:${next.status}`:'';
        if(observed.current!==null&&signature!==observed.current&&next.jobId)notify.current?.();
        observed.current=signature;
      } catch {if(!stopped)setStatusError('Impossible de vérifier l’état de la suppression. Vérifiez la connexion.');}
      if(!stopped)timer=setTimeout(poll,last?.status==='running'||pending?3000:15000);
    };
    poll();return ()=>{stopped=true;clearTimeout(timer);};
  },[storeId,token,refresh,pending?.jobId]);

  async function submit(previous) {
    const request=previous||{jobId:uid(),sellerId:target.id,sellerName:target.name,departmentId:target.departmentId,storeName:target.storeName};
    jobFeedback.begin(request.jobId);setBusy(true);setActionError('');setPending(request);rememberPending(storeId,request);
    try {
      const result=await api('/api/admin/sellers/delete',{method:'POST',token,body:{storeId,jobId:request.jobId,sellerId:request.sellerId,expectedName:request.sellerName,expectedDepartmentId:request.departmentId,expectedStoreName:request.storeName,confirmation:SELLER_DELETE_CONFIRMATION}});
      if(!alive.current)return;
      if(!['running','done','superseded'].includes(result.status)||result.jobId!==request.jobId)throw new Error('État de suppression invalide.');
      rememberPending(storeId,null);setPending(null);setOpen(false);setPhrase('');setSellerId('');
      if(result.status==='superseded'){jobFeedback.cancel(request.jobId);setActionError('Cette demande a déjà été traitée ou remplacée. Aucune nouvelle suppression n’a été lancée.');}
      else {jobFeedback.observe(result);setStatus(result);notify.current?.();}
      setRefresh(value=>value+1);
    } catch(e) {
      if(alive.current) {
        setOpen(false);setPhrase('');
        if(resolvedRequest.current===request.jobId)setActionError('');
        else if(e.status>=400&&e.status<500){jobFeedback.cancel(request.jobId);rememberPending(storeId,null);setPending(null);setActionError(e.message||'La demande a été refusée.');if(e.status===409)notify.current?.();}
        else setActionError('Le lancement n’a pas pu être confirmé. Vérifiez ou reprenez cette même demande avant toute nouvelle suppression.');
        setRefresh(value=>value+1);
      }
    } finally {if(alive.current)setBusy(false);}
  }
  const person=sellers.find(item=>String(item.id)===sellerId&&!item.deletingJob);
  const departmentName=item=>departments.find(department=>department.id===sellerDepartmentId(item))?.name||'';
  const running=status?.status==='running';
  const unavailable=disabled||busy||!storeName||!person||!['idle','done'].includes(status?.status)||!!statusError||!!pending;
  return <section className="sales-reset seller-delete" aria-labelledby="seller-delete-title">
    <VisibleFeedback message={jobFeedback.notice?.message} tone={jobFeedback.notice?.tone} revision={jobFeedback.revision}/>
    <VisibleFeedback message={statusError} tone="error" actionLabel="Vérifier" onAction={()=>{setStatusError('');setRefresh(value=>value+1);}}/>
    <VisibleFeedback message={actionError} tone="error" revision={actionRevision} actionLabel={pending&&!open&&!busy&&!disabled?'Reprendre':''} onAction={()=>submit(pending)}/>
    <div className="sales-reset-heading"><div><h4 id="seller-delete-title">Supprimer définitivement un vendeur</h4><p>À distinguer de l’archivage : cette action efface aussi ses données.</p></div></div>
    <label className="goals-reset-select"><span className="form-label">Vendeur à supprimer</span><select className="text-input" aria-label="Vendeur à supprimer" value={sellerId} onChange={event=>{setSellerId(event.target.value);setActionError('');}} disabled={disabled||busy||open||!!pending||running}>
      <option value="">Choisir un vendeur</option>{sellers.filter(item=>!item.deletingJob).map(item=><option key={item.id} value={item.id}>{item.name}{departmentName(item)?` · ${departmentName(item)}`:''}{item.active===false||item.active===0?' · archivé':''}</option>)}
    </select></label>
    {!open&&<button type="button" className="sales-reset-button" disabled={unavailable} onClick={()=>{setActionError('');setTarget({id:Number(person.id),name:person.name,storeName,departmentId:sellerDepartmentId(person),departmentName:departmentName(person),archived:person.active===false||person.active===0});setOpen(true);}}><Trash2 size={15} aria-hidden="true"/> Supprimer ce vendeur</button>}
    {running&&<p className="sales-reset-progress" role="status">Suppression de {status.sellerName} en cours : {status.deletedSales} opération{status.deletedSales>1?'s':''} de vente effacée{status.deletedSales>1?'s':''}. Son accès est désactivé. Vous pouvez fermer cette fenêtre.</p>}
    {status?.status==='done'&&!pending&&!open&&<p className="sales-reset-progress" role="status">Dernière suppression terminée : {status.deletedSales} opération{status.deletedSales>1?'s':''} de vente effacée{status.deletedSales>1?'s':''}.</p>}
    {statusError&&<div className="sales-reset-error" role="alert">{statusError} <button type="button" onClick={()=>{setStatusError('');setRefresh(value=>value+1);}}>Vérifier</button></div>}
    {actionError&&<p className="sales-reset-error" role="alert">{actionError}</p>}
    {pending&&!open&&<div className="sales-reset-recovery"><p>Une demande pour {pending.sellerName||'ce vendeur'} attend confirmation. Reprenez la même demande pour éviter une nouvelle suppression.</p><button type="button" className="outline-button" disabled={busy||disabled} onClick={()=>submit(pending)}>Vérifier ou reprendre</button></div>}
    {open&&<div className="sales-reset-confirm" role="group" aria-labelledby="seller-delete-confirm-title">
      <div className="sales-reset-warning"><AlertTriangle size={19} aria-hidden="true"/><div>
        <strong id="seller-delete-confirm-title">Supprimer {target?.name} de {target?.storeName} ?</strong>
        {target?.departmentName&&<p>Département : {target.departmentName}{target.archived?' · profil archivé':''}.</p>}
        <p>Son profil, son accès et son PIN, toutes ses ventes à toutes les dates, ses objectifs et ses jours travaillés seront définitivement supprimés. Ses sessions seront désactivées. Cette action est irréversible.</p>
        <p>Les bilans historiques seront modifiés. Les autres vendeurs, leurs ventes et leurs objectifs, ainsi que les services et les autres magasins, sont conservés.</p>
        <p>Le traitement peut prendre du temps. Les notifications déjà reçues sur d’autres appareils ne peuvent pas être retirées ; les appareils doivent être en ligne pour voir les bilans à jour.</p>
      </div></div>
      <form onSubmit={event=>{event.preventDefault();if(phrase===SELLER_DELETE_CONFIRMATION&&!unavailable)submit(null);}}>
        <label><span className="form-label">Tapez {SELLER_DELETE_CONFIRMATION} pour confirmer</span><input className="text-input" aria-label="Confirmation de suppression du vendeur" value={phrase} onChange={event=>setPhrase(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy||disabled} autoFocus/></label>
        <div className="sales-reset-actions"><button type="button" className="outline-button" disabled={busy} onClick={()=>{setOpen(false);setPhrase('');}}>Annuler</button><button type="submit" className="sales-reset-danger" disabled={unavailable||phrase!==SELLER_DELETE_CONFIRMATION}>{busy?'Démarrage…':'Supprimer définitivement'}</button></div>
      </form>
    </div>}
  </section>;
}
