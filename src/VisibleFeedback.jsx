import React, {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Check, Info, X} from 'lucide-react';

const FeedbackContext=createContext(null);

// Si un bouton du rappel disparaît pendant qu'il a le focus, garder le
// clavier dans le dialogue plutôt que de le renvoyer derrière la modale.
export function restoreDialogFocus(event) {
  const target=event?.currentTarget;
  if(!target||typeof document==='undefined'||document.activeElement!==target)return;
  target.closest?.('[role="dialog"]')?.querySelector('.close-button')?.focus({preventScroll:true});
}

// Chaque dialogue possède sa propre zone visible, indépendante de son contenu
// défilant. Sur la page, la même zone reste fixe pendant le défilement.
export function VisibleFeedbackProvider({children,placement='dialog',header=null}) {
  const [entries,setEntries]=useState([]),[rail,setRail]=useState(null);
  const show=useCallback((owner,entry)=>setEntries(previous=>[...previous.filter(item=>item.owner!==owner),{owner,...entry}]),[]);
  const remove=useCallback(owner=>setEntries(previous=>previous.filter(item=>item.owner!==owner)),[]);
  const current=entries[entries.length-1],container=useRef(null);
  useLayoutEffect(()=>{if(!current)return;const node=container.current;return ()=>{if(typeof document!=='undefined'&&node?.contains(document.activeElement))restoreDialogFocus({currentTarget:document.activeElement});};},[!!current]);
  const context=useMemo(()=>({show,remove,rail:placement==='page'?rail:null}),[show,remove,rail,placement]);
  const Icon=current?.tone==='error'?Info:Check;
  const feedback=current&&<aside ref={container} className={`visible-feedback visible-feedback-${placement} ${current.tone==='error'?'is-error':'is-success'}${current.variant==='autosave'?' is-autosave':''}`} aria-label="Message" aria-live="off">
    <span className="visible-feedback-icon" aria-hidden="true"><Icon size={19}/></span>
    <div className="visible-feedback-text">{current.message}</div>
    {current.actionLabel&&<button type="button" className="visible-feedback-action" onClick={event=>{restoreDialogFocus(event);current.onAction?.();remove(current.owner);}}>{current.actionLabel}</button>}
    <button type="button" className="visible-feedback-close" aria-label="Fermer ce message" onClick={event=>{restoreDialogFocus(event);remove(current.owner);}}><X size={18} aria-hidden="true"/></button>
  </aside>;
  return <FeedbackContext.Provider value={context}>
    {placement==='page'?<>{children}<div className="feedback-rail"><div ref={setRail} className="feedback-toast-slot"/>{feedback}</div></>:<>{header}{feedback}{children}</>}
  </FeedbackContext.Provider>;
}

// Les toasts et les rappels de la page partagent une même colonne : leur
// hauteur réelle détermine leur position, sans masquer les actions voisines.
export function usePageFeedbackRail() {return useContext(FeedbackContext)?.rail||null;}

// Conserver le message initial à proximité de son formulaire, notamment ses
// éventuelles actions, et le rappeler dans la zone visible du dialogue. Le
// message initial porte déjà role=status/alert : le rappel ne l'annonce pas deux fois.
export function VisibleFeedback({message,tone='success',revision=0,actionLabel='',onAction,variant=''}) {
  const context=useContext(FeedbackContext),owner=useRef(Symbol('feedback')),action=useRef(onAction);
  action.current=onAction;
  useEffect(()=>{
    if(!context||!message)return;
    const id=owner.current;
    context.show(id,{message,tone,actionLabel,variant,...(actionLabel?{onAction:()=>action.current?.()}: {})});
    const timer=setTimeout(()=>context.remove(id),5000);
    return ()=>{clearTimeout(timer);context.remove(id);};
  },[context,message,tone,revision,actionLabel,variant]);
  return null;
}

// Réafficher même une erreur identique après une nouvelle tentative.
export function useFeedbackState(initial='') {
  const [value,setValue]=useState(initial),[revision,setRevision]=useState(0);
  const update=useCallback(next=>{setValue(next);if(next)setRevision(value=>value+1);},[]);
  return [value,update,revision];
}

// Pour les chargements de données, ne montrer un rappel que pour une
// vérification demandée par l'utilisateur, pas à chaque rafraîchissement de fond.
export function useRetryFeedback(onRetry,successMessage) {
  const [feedback,setFeedback,revision]=useFeedbackState(null),sequence=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;sequence.current++;};},[]);
  const retry=useCallback(async()=>{
    const id=++sequence.current;setFeedback(null);
    try {
      const result=await onRetry?.();
      if(!alive.current||id!==sequence.current||!result)return;
      if(result.ok===true)setFeedback({message:successMessage,tone:'success'});
      else if(result.ok===false)setFeedback({message:result.message||'Actualisation impossible.',tone:'error'});
    } catch(error){if(alive.current&&id===sequence.current)setFeedback({message:error.message||'Actualisation impossible.',tone:'error'});}
  },[onRetry,successMessage,setFeedback]);
  const clear=useCallback(()=>{sequence.current++;setFeedback(null);},[setFeedback]);
  return {feedback,revision,retry,clear};
}
