import React, {useEffect,useRef,useState} from 'react';
import {CalendarDays,ChevronDown,Info,Trash2} from 'lucide-react';
import {api,uid,dateLabel,timeLabel} from './api';
import {MAX_SALE_CORRECTION,SALE_CORRECTION_CONFIRMATION,saleHistoryRange} from './sale-history.js';

const periods=[['day','Jour'],['week','Semaine'],['month','Mois']];
const dateText=value=>dateLabel(value,{day:'numeric',month:'long',year:'numeric'});
function hour(value) {try{return value&&Number.isFinite(Date.parse(value))?timeLabel(value):'Heure inconnue';}catch{return 'Heure inconnue';}}
function rowLabel(row,services,departments) {
  const service=services.find(s=>Number(s.id)===Number(row.serviceId))?.name||`Service n° ${row.serviceId}`;
  const department=departments.find(d=>d.id===row.departmentId)?.name||'Département inconnu';
  return {...row,serviceName:service,departmentName:department};
}
function query({storeId,sellerId,period,anchor},cursor=null) {
  const params=new URLSearchParams({storeId,sellerId:String(sellerId),period,anchor});
  if(cursor){params.set('afterDate',cursor.date);params.set('afterId',cursor.id);}
  return `/api/admin/sales/history?${params}`;
}

export function SalesHistoryPanel({storeId,storeName,sellers,services,departments,today,token,disabled=false,onBusy,onUpdate,onReload}) {
  const [sellerId,setSellerId]=useState(''),[period,setPeriod]=useState('day'),[anchor,setAnchor]=useState(today);
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[selected,setSelected]=useState([]),[pending,setPending]=useState(null);
  const [loading,setLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),sequence=useRef(0);
  const eligible=sellers.filter(s=>!s.deletingJob),seller=eligible.find(s=>String(s.id)===sellerId);
  const range=saleHistoryRange(period,anchor,today),selection={storeId,sellerId,period,anchor};
  useEffect(()=>{
    const request=++sequence.current,controller=new AbortController();
    setRows([]);setNext(null);setSelected([]);setPending(null);setError('');setLoadingMore(false);
    if(!sellerId||!range){setLoading(false);return ()=>controller.abort();}
    setLoading(true);
    api(query({storeId,sellerId,period,anchor}),{token,signal:controller.signal}).then(result=>{
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Historique indisponible. Réessayez.');
      setRows(result.sales);setNext(result.next||null);
    }).catch(e=>{if(sequence.current===request&&!controller.signal.aborted)setError(e.message||'Impossible de charger les ventes.');})
      .finally(()=>{if(sequence.current===request)setLoading(false);});
    return ()=>{controller.abort();sequence.current++;};
  },[storeId,sellerId,period,anchor,today,token,refresh]);
  async function more() {
    if(!next||loadingMore)return;
    const request=sequence.current;setLoadingMore(true);setError('');
    try {
      const result=await api(query(selection,next),{token});
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Historique indisponible. Réessayez.');
      setRows(old=>{const seen=new Set(old.map(row=>row.id));return [...old,...result.sales.filter(row=>!seen.has(row.id))];});setNext(result.next||null);
    } catch(e){if(sequence.current===request)setError(e.message||'Impossible de charger la suite.');}
    finally{if(sequence.current===request)setLoadingMore(false);}
  }
  function select(id) {setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length<MAX_SALE_CORRECTION?[...old,id]:old);setNotice('');}
  function prepare() {
    if(!seller||!selected.length||!range)return;
    const items=rows.filter(row=>selected.includes(row.id)).map(row=>rowLabel(row,services,departments));
    if(items.length!==selected.length)return;
    setError('');setPending({storeId,sellerId:Number(sellerId),period,anchor,saleIds:items.map(row=>row.id),requestId:uid(),
      confirmation:SALE_CORRECTION_CONFIRMATION,expectedSellerName:seller.name,expectedStoreName:storeName,items});
  }
  async function confirm() {
    if(!pending||saving)return;
    setSaving(true);onBusy(true);setError('');
    const {items,...body}=pending;
    try {
      const result=await api('/api/admin/sales/correct',{method:'POST',token,body});
      setPending(null);setSelected([]);setRows(old=>old.filter(row=>!body.saleIds.includes(row.id)));setRefresh(value=>value+1);
      setNotice(`${result.deleted} ${result.deleted>1?'ventes retirées':'vente retirée'}. Les bilans sont mis à jour.`);onUpdate();
    } catch(e) {
      if(e.status&&e.status>=400&&e.status<500&&e.status!==408&&e.status!==429) {
        setPending(null);setError(e.message||'La sélection a changé. Rechargez la liste.');
      } else setError('La réponse est incertaine : la correction a peut-être été appliquée. Réessayez sans modifier la sélection ou rechargez la liste.');
    } finally {setSaving(false);onBusy(false);}
  }
  const locked=disabled||saving||!!pending,displayRows=rows.map(row=>rowLabel(row,services,departments))
    .sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||(b.createdAt||'').localeCompare(a.createdAt||'')||b.id.localeCompare(a.id));
  const label=range?(range.start===range.end?dateText(range.start):`${dateText(range.start)} — ${dateText(range.end)}`):'';
  return <section className="sales-history" aria-labelledby="sales-history-title">
    <div className="admin-section-heading"><div><h3 id="sales-history-title">Corriger des ventes</h3><p>Choisissez un vendeur et une période, puis cochez uniquement les ventes enregistrées par erreur.</p></div></div>
    <div className="history-filters">
      <label><span className="form-label">VENDEUR</span><select className="text-input" aria-label="Vendeur pour l’historique" value={sellerId} disabled={locked||!eligible.length} onChange={event=>{setSellerId(event.target.value);setNotice('');}}><option value="">Choisir un vendeur</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.name}{s.active?'':' · archivé'}</option>)}</select></label>
      <fieldset className="history-periods" disabled={locked}><legend className="form-label">PÉRIODE</legend><div>{periods.map(([value,name])=><button key={value} type="button" aria-pressed={period===value} className={period===value?'active':''} onClick={()=>{setPeriod(value);setNotice('');}}>{name}</button>)}</div></fieldset>
      <label><span className="form-label">DATE DE RÉFÉRENCE</span><input className="text-input" type="date" aria-label="Date de référence des ventes" max={today} value={anchor||''} disabled={locked} onChange={event=>{setAnchor(event.target.value);setNotice('');}}/></label>
    </div>
    {range&&seller&&<div className="history-range"><CalendarDays size={14} aria-hidden="true"/> {label}</div>}
    {!range&&<p className="history-warning" role="alert">Choisissez une date valide, aujourd’hui ou dans le passé.</p>}
    {notice&&<div className="goal-saved history-notice" role="status">{notice}</div>}
    {error&&<div className="form-error history-error" role="alert">{error}{!pending&&<button type="button" onClick={()=>{onReload?.();setRefresh(value=>value+1);}}> Recharger</button>}</div>}
    {!sellerId?<div className="history-empty">Sélectionnez un vendeur pour afficher ses ventes.</div>:loading?<div className="history-empty">Chargement des ventes…</div>:range&&<>
      {displayRows.length?<div className="history-list">{displayRows.map(row=><label className={`history-row ${selected.includes(row.id)?'is-selected':''}`} key={row.id}>
        <input type="checkbox" checked={selected.includes(row.id)} disabled={locked||(!selected.includes(row.id)&&selected.length>=MAX_SALE_CORRECTION)} onChange={()=>select(row.id)}/>
        <span className="history-row-copy"><strong>{row.serviceName}</strong><small>{dateText(row.businessDate)} · {hour(row.createdAt)} · {row.departmentName}</small><small>{row.source==='adjustment'?'Correction administrative':'Vente'} · réf. {row.id.slice(-6).toUpperCase()}</small></span>
      </label>)}</div>:!error&&<div className="history-empty">{next?'Aucune vente de ce vendeur dans cette partie de la période.':'Aucune vente enregistrée pour cette période.'}</div>}
      {next&&<button type="button" className="history-more" onClick={more} disabled={locked||loadingMore}>{loadingMore?'Chargement…':'Charger la suite'} <ChevronDown size={14}/></button>}
      {displayRows.length>0&&<div className="history-actions"><span>{selected.length} sélectionnée{selected.length>1?'s':''} · {MAX_SALE_CORRECTION} maximum</span><button type="button" className="history-delete" disabled={locked||!selected.length} onClick={prepare}><Trash2 size={14}/> Supprimer la sélection</button></div>}
    </>}
    {pending&&<div className="history-confirm" role="group" aria-label="Confirmer la suppression des ventes sélectionnées">
      <strong>Retirer {pending.items.length} {pending.items.length>1?'ventes':'vente'} ?</strong><p>{pending.expectedSellerName} · {pending.expectedStoreName}</p>
      <ul>{pending.items.map(row=><li key={row.id}>{row.serviceName} · {dateText(row.businessDate)} · {hour(row.createdAt)} · réf. {row.id.slice(-6).toUpperCase()}</li>)}</ul>
      <p>Seules ces ventes seront retirées. Les bilans historiques et la progression des objectifs seront modifiés.</p>
      <div><button type="button" className="outline-button" disabled={saving} onClick={()=>{setPending(null);setError('');}}>Annuler</button><button type="button" className="history-confirm-delete" disabled={disabled||saving} onClick={confirm}>{saving?'Suppression…':'Confirmer la suppression'}</button></div>
    </div>}
    <div className="admin-note"><Info size={15}/> La correction ne déclenche pas de notification de vente.</div>
  </section>;
}
