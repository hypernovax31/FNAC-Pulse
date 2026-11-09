import React, {useEffect,useState} from 'react';
import {VisibleFeedback} from './VisibleFeedback';
import {ChevronDown} from 'lucide-react';
import {api} from './api';
import {WorkdaysForm} from './Goals';
import {normalizeWorkdays} from './goals.js';

// Chargement à la demande : ouvrir une fiche ne lit pas les objectifs des
// autres vendeurs et les plannings restent dans leur document privé existant.
export function SellerWorkdays({seller,storeId,token,open,onToggle,disabled,onBusy,onChanged}) {
  const [planning,setPlanning]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const url=`/api/admin/goals?storeId=${encodeURIComponent(storeId)}&sellerId=${encodeURIComponent(seller.id)}`;
  useEffect(()=>{
    if(!open||!seller.active)return;
    let cancelled=false;const controller=new AbortController();setPlanning(null);setError('');setLoading(true);
    api(url,{token,signal:controller.signal}).then(result=>{
      if(!cancelled)setPlanning({workdays:normalizeWorkdays(result.workdays),revision:result.workdaysRevision||null});
    }).catch(e=>{if(!cancelled)setError(e.message||'Impossible de charger les jours travaillés.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;controller.abort();};
  },[open,seller.active,url,token,retry]);
  async function save(body) {
    onBusy(true);setError('');
    try {
      const result=await api('/api/admin/workdays',{method:'POST',token,body:{...body,storeId,sellerId:Number(seller.id)}});
      setPlanning({workdays:normalizeWorkdays(result.workdays),revision:result.workdaysRevision||null});onChanged();return result;
    } catch(e) {
      if(e.status===409)try {
        const latest=await api(url,{token});setPlanning({workdays:normalizeWorkdays(latest.workdays),revision:latest.workdaysRevision||null});
      } catch { /* La fiche peut être rechargée sans écraser d'autres données. */ }
      throw e;
    } finally {onBusy(false);}
  }
  return <div className="seller-workdays">
    {open&&<VisibleFeedback message={error} tone="error" actionLabel="Réessayer" onAction={()=>setRetry(value=>value+1)}/>}
    <button type="button" className="seller-workdays-toggle" aria-expanded={!!open} disabled={disabled||!seller.active||!!seller.deletingJob} onClick={onToggle}>
      <span>Jours travaillés</span><span>{!seller.active?'Réactiver le vendeur':open?'Masquer':'Afficher'} <ChevronDown size={15} className={open?'is-open':''}/></span>
    </button>
    {open&&seller.active&&<div className="seller-workdays-content">
      {loading?<p className="seller-workdays-status">Chargement des jours travaillés…</p>:error?<div className="seller-workdays-error" role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Réessayer</button></div>:planning&&<WorkdaysForm key={`${storeId}:${seller.id}`} workdays={planning.workdays} revision={planning.revision} onSave={save} disabled={disabled}/>}
    </div>}
  </div>;
}
