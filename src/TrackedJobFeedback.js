import {useCallback,useEffect,useRef} from 'react';
import {useFeedbackState} from './VisibleFeedback';

function read(key) {try{return sessionStorage.getItem(key)||'';}catch{return '';}}
function remember(key,id) {try{if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);}catch{}}

// Un état historique observé en ouvrant un panneau n'est pas une confirmation.
// On ne signale que le travail lancé ou repris dans cet onglet, identifié par
// le même jobId que celui envoyé au serveur ; son état est vérifié réellement.
export function useTrackedJobFeedback(kind,storeId,pendingId,describe) {
  const key=`fnac-pulse-feedback-job:${kind}:${storeId}`;
  const tracker=useRef(null),formatter=useRef(describe);
  formatter.current=describe;
  if(!tracker.current||tracker.current.key!==key)tracker.current={key,id:read(key)||pendingId||'',last:''};
  const [notice,setNotice,revision]=useFeedbackState(null);
  useEffect(()=>{if(tracker.current.key===key&&tracker.current.id)remember(key,tracker.current.id);},[key]);
  const begin=useCallback(id=>{tracker.current={key,id,last:''};remember(key,id);setNotice(null);},[key,setNotice]);
  const cancel=useCallback(id=>{if(tracker.current.key===key&&tracker.current.id===id){tracker.current.id='';remember(key,'');}},[key]);
  const observe=useCallback(job=>{
    const current=tracker.current;
    if(current.key!==key||!current.id||job?.jobId!==current.id||!['running','done','needs-review'].includes(job.status)||current.last===job.status)return;
    current.last=job.status;
    const next=formatter.current(job);
    if(next?.message)setNotice(next);
    if(job.status==='done'||job.status==='needs-review'){current.id='';remember(key,'');}
  },[key,setNotice]);
  return {notice,revision,begin,cancel,observe};
}
