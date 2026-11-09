import React, { useEffect, useRef, useState } from 'react';
import { VisibleFeedback, useFeedbackState } from './VisibleFeedback';
import { useTrackedJobFeedback } from './TrackedJobFeedback';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { api, uid } from './api';
import { GOALS_RESET_CONFIRMATION } from './goals-reset.js';

const pendingKey=storeId=>`fnac-pulse-goals-reset:${storeId}`;
function readPending(storeId) {
  try {
    const value=JSON.parse(sessionStorage.getItem(pendingKey(storeId))||'null');
    return value&&typeof value.jobId==='string'&&typeof value.departmentId==='string'?value:null;
  } catch{return null;}
}
function rememberPending(storeId,value) {
  try {if(value)sessionStorage.setItem(pendingKey(storeId),JSON.stringify(value));else sessionStorage.removeItem(pendingKey(storeId));}catch{}
}

// Une confirmation explicite lance un seul travail durable. Si la réponse se
// perd, la même demande est reprise avec ses magasin/département et identifiant.
export function GoalsResetPanel({storeId,storeName,departments,token,disabled,onUpdate}) {
  const [departmentId,setDepartmentId]=useState('');
  const [status,setStatus]=useState(null),[statusError,setStatusError]=useState('');
  const [pending,setPending]=useState(()=>readPending(storeId));
  const [open,setOpen]=useState(false),[phrase,setPhrase]=useState('');
  const [busy,setBusy]=useState(false),[actionError,setActionError,actionRevision]=useFeedbackState(''),[refresh,setRefresh]=useState(0);
  const jobFeedback=useTrackedJobFeedback('goals-reset',storeId,pending?.jobId,job=>({message:job.status==='running'?`Reset des objectifs en cours pour ${job.departmentName||'le département sélectionné'}. Vous pouvez fermer cette fenêtre.`:`Reset des objectifs terminé pour ${job.departmentName||'le département sélectionné'} : ${job.processedSellers} vendeur${job.processedSellers>1?'s':''} traité${job.processedSellers>1?'s':''}.`}));
  const notify=useRef(onUpdate),alive=useRef(false),observed=useRef(null),resolvedRequest=useRef('');
  notify.current=onUpdate;
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let stopped=false,timer,last=status;
    const poll=async()=>{
      try {
        const next=await api(`/api/admin/goals/reset?storeId=${encodeURIComponent(storeId)}`,{token});
        if(stopped)return;
        last=next;setStatus(next);setStatusError('');jobFeedback.observe(next);
        if(pending&&next.jobId===pending.jobId&&(next.status==='running'||next.status==='done')) {
          resolvedRequest.current=pending.jobId;rememberPending(storeId,null);setPending(null);setActionError('');setOpen(false);setPhrase('');notify.current?.();
        }
        const signature=next.jobId?`${next.jobId}:${next.status}:${next.processedSellers}`:'';
        if(observed.current!==null&&signature!==observed.current&&next.jobId)notify.current?.();
        observed.current=signature;
      } catch(e) {if(!stopped)setStatusError('Impossible de vérifier l’état du reset. Vérifiez la connexion.');}
      if(!stopped)timer=setTimeout(poll,last?.status==='running'||pending?3000:15000);
    };
    poll();return ()=>{stopped=true;clearTimeout(timer);};
  },[storeId,token,refresh,pending?.jobId]);

  async function submit(previous) {
    const request=previous||{jobId:uid(),departmentId};
    jobFeedback.begin(request.jobId);setBusy(true);setActionError('');setPending(request);rememberPending(storeId,request);
    try {
      const result=await api('/api/admin/goals/reset',{method:'POST',token,body:{storeId,...request,confirmation:GOALS_RESET_CONFIRMATION}});
      if(!alive.current)return;
      if(!['running','done','superseded'].includes(result.status)||result.jobId!==request.jobId||result.departmentId!==request.departmentId)throw new Error('État du reset invalide.');
      rememberPending(storeId,null);setPending(null);setOpen(false);setPhrase('');
      if(result.status==='superseded'){jobFeedback.cancel(request.jobId);setActionError('Cette demande a déjà été traitée ou remplacée. Aucun nouveau reset n’a été lancé.');}
      else {jobFeedback.observe(result);setStatus(result);notify.current?.();}
      setRefresh(value=>value+1);
    } catch(e) {
      if(alive.current){
        setOpen(false);setPhrase('');
        if(resolvedRequest.current===request.jobId)setActionError('');
        else if(e.status>=400&&e.status<500){jobFeedback.cancel(request.jobId);rememberPending(storeId,null);setPending(null);setActionError(e.message||'La demande a été refusée.');}
        else setActionError('Le lancement n’a pas pu être confirmé. Vérifiez ou reprenez cette même demande avant tout nouveau reset.');
        setRefresh(value=>value+1);
      }
    } finally {if(alive.current)setBusy(false);}
  }
  const department=departments.find(item=>item.id===departmentId);
  const running=status?.status==='running';
  const unavailable=disabled||busy||!storeName||!department||!['idle','done'].includes(status?.status)||!!statusError||!!pending;
  const pendingName=departments.find(item=>item.id===pending?.departmentId)?.name||pending?.departmentId;
  return <section className="sales-reset goals-reset" aria-labelledby="goals-reset-title">
    <VisibleFeedback message={jobFeedback.notice?.message} tone={jobFeedback.notice?.tone} revision={jobFeedback.revision}/>
    <VisibleFeedback message={statusError} tone="error" actionLabel="Vérifier" onAction={()=>{setStatusError('');setRefresh(value=>value+1);}}/>
    <VisibleFeedback message={actionError} tone="error" revision={actionRevision} actionLabel={pending&&!open&&!busy&&!disabled?'Reprendre':''} onAction={()=>submit(pending)}/>
    <div className="sales-reset-heading"><div><h4 id="goals-reset-title">Reset global des objectifs</h4><p>Tous les vendeurs et services d’un département du magasin sélectionné.</p></div></div>
    <label className="goals-reset-select"><span className="form-label">Département à réinitialiser</span><select className="text-input" aria-label="Département à réinitialiser" value={departmentId} onChange={event=>setDepartmentId(event.target.value)} disabled={disabled||busy||open||!!pending||running}>
      <option value="">Choisir un département</option>{departments.map(item=><option key={item.id} value={item.id}>{item.name}{item.active===false||item.active===0?' · archivé':''}</option>)}
    </select></label>
    {!open&&<button type="button" className="sales-reset-button" disabled={unavailable} onClick={()=>{setActionError('');setOpen(true);}}><RotateCcw size={15} aria-hidden="true"/> Reset global</button>}
    {running&&<p className="sales-reset-progress" role="status">Reset en cours pour {status.departmentName} : {status.processedSellers} / {status.totalSellers} vendeurs traités. Les objectifs des vendeurs en attente ne sont pas modifiables. Vous pouvez fermer cette fenêtre.</p>}
    {status?.status==='done'&&!pending&&!open&&<p className="sales-reset-progress" role="status">Dernier reset terminé pour {status.departmentName} : {status.processedSellers} vendeur{status.processedSellers>1?'s':''} traité{status.processedSellers>1?'s':''}.</p>}
    {statusError&&<div className="sales-reset-error" role="alert">{statusError} <button type="button" onClick={()=>{setStatusError('');setRefresh(value=>value+1);}}>Vérifier</button></div>}
    {actionError&&<p className="sales-reset-error" role="alert">{actionError}</p>}
    {pending&&!open&&<div className="sales-reset-recovery"><p>Une demande pour {pendingName} attend confirmation. Reprenez la même demande pour éviter un second reset.</p><button type="button" className="outline-button" disabled={busy||disabled} onClick={()=>submit(pending)}>Vérifier ou reprendre</button></div>}
    {open&&<div className="sales-reset-confirm" role="group" aria-labelledby="goals-reset-confirm-title">
      <div className="sales-reset-warning"><AlertTriangle size={19} aria-hidden="true"/><div>
        <strong id="goals-reset-confirm-title">Supprimer les objectifs de {department?.name} à {storeName} ?</strong>
        <p>Les cibles de tous les services et de tous les vendeurs rattachés à ce département, y compris les vendeurs archivés, deviendront non renseignées pour le jour, la semaine et le mois. Cette action est irréversible et ne crée pas de sauvegarde.</p>
        <p>Les ventes, services, vendeurs, plannings, PIN, autres départements et autres magasins sont conservés. Les vendeurs concernés sont ceux rattachés au département au moment de la confirmation.</p>
        <p>Le traitement peut prendre du temps. Les appareils doivent être en ligne pour voir les objectifs à jour.</p>
      </div></div>
      <form onSubmit={event=>{event.preventDefault();if(phrase===GOALS_RESET_CONFIRMATION&&!unavailable)submit(null);}}>
        <label><span className="form-label">Tapez {GOALS_RESET_CONFIRMATION} pour confirmer</span><input className="text-input" aria-label="Confirmation du reset des objectifs" value={phrase} onChange={event=>setPhrase(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy||disabled} autoFocus/></label>
        <div className="sales-reset-actions"><button type="button" className="outline-button" disabled={busy} onClick={()=>{setOpen(false);setPhrase('');}}>Annuler</button><button type="submit" className="sales-reset-danger" disabled={unavailable||phrase!==GOALS_RESET_CONFIRMATION}>{busy?'Démarrage…':'Supprimer les objectifs'}</button></div>
      </form>
    </div>}
  </section>;
}
