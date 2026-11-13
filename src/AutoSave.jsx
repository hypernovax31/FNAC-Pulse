import React, {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {RotateCw} from 'lucide-react';
import {VisibleFeedback} from './VisibleFeedback';

// Each open editor registers its pending work. Internal navigation waits for it;
// a browser/tab close is warned about because a network request cannot be
// guaranteed to finish after a page is terminated.
const AutoSaveContext=createContext(null);
const noRegistry={pending:false,register:()=>()=>{},changed:()=>{},flush:async()=>true};

export function AutoSaveProvider({children}) {
  const editors=useRef(new Set());
  const [pending,setPending]=useState(false);
  const registry=useMemo(()=>{
    const changed=()=>setPending([...editors.current].some(editor=>editor.pending()));
    return {
      changed,
      register(editor){editors.current.add(editor);changed();return ()=>{editors.current.delete(editor);changed();};},
      async flush(){
        // Serial execution avoids two catalog edits racing one another.
        for(const editor of [...editors.current])if(!(await editor.flush()))return false;
        return true;
      },
      hasPending:()=>[...editors.current].some(editor=>editor.pending()),
    };
  },[]);
  useEffect(()=>{
    if(typeof window==='undefined'||!window.addEventListener)return;
    const beforeUnload=event=>{
      if(!registry.hasPending())return;
      event.preventDefault();event.returnValue='';return '';
    };
    const onHidden=()=>{if(typeof document!=='undefined'&&document.visibilityState==='hidden')void registry.flush();};
    const onPageHide=()=>{void registry.flush();};
    window.addEventListener('beforeunload',beforeUnload);
    window.addEventListener('pagehide',onPageHide);
    if(typeof document!=='undefined')document.addEventListener?.('visibilitychange',onHidden);
    return ()=>{window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('pagehide',onPageHide);if(typeof document!=='undefined')document.removeEventListener?.('visibilitychange',onHidden);};
  },[registry]);
  const value=useMemo(()=>({...registry,pending}),[registry,pending]);
  return <AutoSaveContext.Provider value={value}>{children}</AutoSaveContext.Provider>;
}
export function useAutoSaveRegistry(){return useContext(AutoSaveContext)||noRegistry;}

// A single editor has at most one request in flight. Later input is retained
// and sent with the revision returned by that request, never with the old one.
export function useAutomaticSave({remoteValue,remoteVersion,onSave,validate,equals=(a,b)=>a===b,disabled=false,delay=1100}) {
  const registry=useAutoSaveRegistry();
  const [draft,setDraft]=useState(remoteValue);
  const draftRef=useRef(remoteValue),base=useRef(remoteValue),version=useRef(remoteVersion),remote=useRef(null),latest=useRef(null),previousOwnVersion=useRef(undefined);
  remote.current={value:remoteValue,version:remoteVersion};
  latest.current={onSave,validate,equals,disabled,delay};
  const [view,setView]=useState({phase:'idle',error:'',saved:'',sequence:0});
  const viewRef=useRef(view),timer=useRef(null),inFlight=useRef(null),alive=useRef(true),unresolved=useRef(false);
  const dirty=()=>!latest.current.equals(draftRef.current,base.current);
  // Une réponse perdue peut cacher une écriture réussie, même si l'utilisateur
  // a entre-temps ressaisi l'ancienne valeur.
  const needsSave=()=>dirty()||unresolved.current;
  const stale=()=>!inFlight.current&&!Object.is(remote.current.version,version.current)&&!Object.is(remote.current.version,previousOwnVersion.current);
  function report(phase,error='',saved='') {
    const next={phase,error,saved,sequence:viewRef.current.sequence+1};viewRef.current=next;
    if(alive.current)setView(next);
  }
  function notify(){registry.changed();}
  function cancelTimer(){if(timer.current){clearTimeout(timer.current);timer.current=null;}}
  function schedule() {
    cancelTimer();
    if(needsSave()&&!inFlight.current)timer.current=setTimeout(()=>{timer.current=null;void flush();},latest.current.delay);
  }
  function change(value) {
    draftRef.current=value;setDraft(value);cancelTimer();
    report(inFlight.current?'saving':needsSave()?'waiting':'idle');notify();schedule();
  }
  function reset(value,nextVersion) {
    cancelTimer();draftRef.current=value;base.current=value;version.current=nextVersion;previousOwnVersion.current=undefined;unresolved.current=false;
    if(alive.current)setDraft(value);report('idle');notify();
  }
  function discard() {
    if(inFlight.current)return false;
    const warning=unresolved.current?'La dernière tentative a peut-être été enregistrée. Abandonner votre saisie et revenir aux dernières valeurs affichées ?':'Abandonner la saisie non enregistrée et revenir aux dernières valeurs ?';
    if(needsSave()&&typeof window!=='undefined'&&window.confirm&&!window.confirm(warning))return false;
    reset(remote.current.value,remote.current.version);return true;
  }
  async function flush(retry=false) {
    cancelTimer();
    if(inFlight.current) {
      const ok=await inFlight.current;
      return ok&&needsSave()?flush(retry):ok;
    }
    if(!needsSave())return true;
    if(viewRef.current.phase==='error'&&!retry)return false;
    if(stale()) {report('error','Cette donnée a changé ailleurs. Votre saisie n’a pas été enregistrée.');notify();return false;}
    if(latest.current.disabled) {report('error','Enregistrement indisponible. Vérifiez la connexion puis réessayez.');notify();return false;}
    const snapshot=draftRef.current,expected=version.current;
    const invalid=latest.current.validate?.(snapshot);
    if(invalid) {report('error',invalid);notify();return false;}
    report('saving');
    const promise=(async()=>{
      try {
        const result=await latest.current.onSave(snapshot,expected);
        if(!result||!Object.hasOwn(result,'value')||!Object.hasOwn(result,'version'))throw new Error('Enregistrement non confirmé. Vérifiez les dernières valeurs avant de réessayer.');
        base.current=result.value;previousOwnVersion.current=expected;version.current=result.version;unresolved.current=false;
        if(result.replaceDraft!==false&&latest.current.equals(draftRef.current,snapshot)) {draftRef.current=result.value;if(alive.current)setDraft(result.value);}
        report(dirty()?'waiting':'saved','',result.notice||'');return true;
      } catch(error) {
        unresolved.current=true;
        const uncertain=error instanceof TypeError||error?.status>=500;
        report('error',uncertain?'Enregistrement non confirmé. La modification a peut-être été enregistrée.':error?.message||'Enregistrement non confirmé. Vérifiez votre connexion puis réessayez.');return false;
      }
    })();
    inFlight.current=promise;notify();
    const ok=await promise;
    if(inFlight.current===promise)inFlight.current=null;
    // Une lecture de conflit peut avoir changé la révision pendant la requête.
    // Recalculer l'état même si l'indicateur global « en attente » est inchangé.
    if(alive.current)setView({...viewRef.current});
    notify();
    if(ok&&needsSave())return flush();
    return ok;
  }
  // The callbacks read refs, so the registered editor always sees the latest
  // input even when navigation occurs before React's next render.
  const bridge=useRef(null);bridge.current={pending:()=>!!inFlight.current||needsSave(),flush:()=>flush()};
  useEffect(()=>registry.register({pending:()=>bridge.current.pending(),flush:()=>bridge.current.flush()}),[registry.register]);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;cancelTimer();};},[]);
  // Refresh an untouched editor automatically. Never replace an unsaved draft.
  useEffect(()=>{
    if(Object.is(remote.current.version,version.current)){previousOwnVersion.current=undefined;return;}
    if(!inFlight.current&&!needsSave()&&!Object.is(remote.current.version,previousOwnVersion.current))reset(remote.current.value,remote.current.version);
  },[remoteVersion]);
  return {draft,change,flush,discard,reset,phase:view.phase,error:view.error,saved:view.saved,sequence:view.sequence,
    busy:!!inFlight.current||view.phase==='saving',dirty:dirty(),pending:needsSave(),stale:stale(),current:()=>draftRef.current,version:()=>version.current,lastPhase:()=>viewRef.current.phase};
}

export function AutoSaveStatus({editor,saved='Modifications enregistrées automatiquement.',label='Enregistrement automatique.',conflict='Cette donnée a changé ailleurs. Votre saisie n’a pas été enregistrée.',showRecovery=true}) {
  const {phase,error,sequence,stale,pending,busy}=editor;
  const message=stale?conflict:phase==='error'?error:'',success=editor.saved||saved;
  return <div className="autosave-status">
    <VisibleFeedback message={message} tone="error" revision={sequence} variant="autosave" actionLabel={showRecovery?(stale?'Recharger':'Réessayer'):''} onAction={stale?editor.discard:()=>editor.flush(true)}/>
    <VisibleFeedback message={!message&&phase==='saved'?success:''} revision={sequence}/>
    {message?<div className="goal-conflict" role="alert"><span>{message}</span>
      {showRecovery&&(stale?<button type="button" onClick={editor.discard}><RotateCw size={13}/> Recharger les valeurs</button>:<button type="button" onClick={()=>editor.flush(true)}><RotateCw size={13}/> Réessayer</button>)}
      {showRecovery&&pending&&!busy&&!stale&&<button type="button" onClick={editor.discard}>Annuler la saisie non enregistrée</button>}
    </div>:<span className={phase==='saved'?'goal-saved':'autosave-hint'} role="status" aria-live="polite">{phase==='waiting'?'Modification en attente…':phase==='saving'?'Enregistrement automatique…':phase==='saved'?success:label}</span>}
  </div>;
}
