import React, {useEffect,useRef,useState} from 'react';
import {VisibleFeedback,useFeedbackState} from './VisibleFeedback';
import {CalendarDays,ChevronDown,Info,Plus,Trash2} from 'lucide-react';
import {api,uid,dateLabel,timeLabel} from './api';
import {sellerDepartmentId} from './departments.js';
import {MAX_SALE_CORRECTION,SALE_CORRECTION_CONFIRMATION,SALE_ADDITION_CONFIRMATION,saleHistoryRange,validAdditionDate} from './sale-history.js';

const dateText=value=>dateLabel(value,{day:'numeric',month:'long',year:'numeric'});
const emptyAddition=()=>({serviceId:'',quantity:'1'});
function hour(value) {try{return value&&Number.isFinite(Date.parse(value))?timeLabel(value):'Heure inconnue';}catch{return 'Heure inconnue';}}
function recordedAt(value) {
  try {return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'';}
  catch{return '';}
}
function rowLabel(row,services,departments) {
  const service=services.find(s=>Number(s.id)===Number(row.serviceId))?.name||`Service n° ${row.serviceId}`;
  const department=departments.find(d=>d.id===row.departmentId)?.name||'Département inconnu';
  return {...row,serviceName:service,departmentName:department};
}
function query({storeId,sellerId,anchor},cursor=null) {
  const params=new URLSearchParams({storeId,sellerId:String(sellerId),period:'day',anchor});
  if(cursor){params.set('afterDate',cursor.date);params.set('afterId',cursor.id);}
  return `/api/admin/sales/history?${params}`;
}

export function SalesHistoryPanel({storeId,storeName,sellers,services,additionServices=services,departments,today,token,disabled=false,onBusy,onUpdate,onReload}) {
  const [sellerId,setSellerId]=useState(''),[anchor,setAnchor]=useState(today),[mode,setMode]=useState('remove');
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[selected,setSelected]=useState([]),[pending,setPending]=useState(null),[uncertain,setUncertain]=useState(false);
  const [addition,setAddition]=useState(emptyAddition),[serviceFilter,setServiceFilter]=useState('');
  const [loading,setLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError,errorRevision]=useFeedbackState(''),[notice,setNotice,noticeRevision]=useFeedbackState('');
  const [canReload,setCanReload]=useState(false),[refresh,setRefresh]=useState(0),sequence=useRef(0);
  const eligible=sellers.filter(s=>!s.deletingJob),seller=eligible.find(s=>String(s.id)===sellerId);
  const range=saleHistoryRange('day',anchor,today),selection={storeId,sellerId,anchor};
  function report(message,reload=false){setError(message);setCanReload(reload);}
  useEffect(()=>{
    const request=++sequence.current,controller=new AbortController();
    setRows([]);setNext(null);setSelected([]);setPending(null);setUncertain(false);setError('');setCanReload(false);setLoadingMore(false);
    if(!sellerId||!range){setLoading(false);return ()=>controller.abort();}
    setLoading(true);
    api(query(selection),{token,signal:controller.signal}).then(result=>{
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Ventes indisponibles. Réessayez.');
      setRows(result.sales);setNext(result.next||null);
    }).catch(e=>{if(sequence.current===request&&!controller.signal.aborted)report(e.message||'Impossible de charger les ventes.',true);})
      .finally(()=>{if(sequence.current===request)setLoading(false);});
    return ()=>{controller.abort();sequence.current++;};
  },[storeId,sellerId,anchor,today,token,refresh]);
  function clearSelection(){setAddition(emptyAddition());setServiceFilter('');setSelected([]);setNotice('');report('');}
  function changeMode(value){if(value===mode)return;setMode(value);setSelected([]);setNotice('');report('');}
  async function more() {
    if(!next||loadingMore)return;
    const request=sequence.current;setLoadingMore(true);report('');
    try {
      const result=await api(query(selection,next),{token});
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Ventes indisponibles. Réessayez.');
      setRows(old=>{const seen=new Set(old.map(row=>row.id));return [...old,...result.sales.filter(row=>!seen.has(row.id))];});setNext(result.next||null);
    } catch(e){if(sequence.current===request)report(e.message||'Impossible de charger la suite.',true);}
    finally{if(sequence.current===request)setLoadingMore(false);}
  }
  function select(id) {setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length<MAX_SALE_CORRECTION?[...old,id]:old);setNotice('');}
  function prepareDelete() {
    if(!seller||!selected.length||!range)return;
    const items=rows.filter(row=>selected.includes(row.id)).map(row=>rowLabel(row,services,departments));
    if(items.length!==selected.length)return;
    report('');setUncertain(false);setPending({kind:'delete',body:{storeId,sellerId:Number(sellerId),period:'day',anchor,saleIds:items.map(row=>row.id),requestId:uid(),
      confirmation:SALE_CORRECTION_CONFIRMATION,expectedSellerName:seller.name,expectedStoreName:storeName},items});
  }
  function prepareAdd(event) {
    event.preventDefault();
    if(!seller||!range||disabled||saving||pending)return;
    const service=additionServices.find(s=>String(s.id)===addition.serviceId),department=departments.find(d=>d.id===sellerDepartmentId(seller));
    const quantity=Number(addition.quantity);
    if(!service){report('Choisissez le service à ajouter.');return;}
    if(!department){report('Le département actuel du vendeur est indisponible. Rechargez la sélection.');return;}
    if(!validAdditionDate('day',anchor,anchor,today)){report('Choisissez une journée valide, aujourd’hui ou dans le passé.');return;}
    if(!Number.isInteger(quantity)||quantity<1||quantity>MAX_SALE_CORRECTION){report(`Choisissez de 1 à ${MAX_SALE_CORRECTION} ventes maximum.`);return;}
    report('');setNotice('');setUncertain(false);
    setPending({kind:'add',body:{storeId,sellerId:Number(sellerId),period:'day',anchor,saleDate:anchor,serviceId:Number(service.id),departmentId:department.id,
      quantity,requestId:uid(),confirmation:SALE_ADDITION_CONFIRMATION,expectedSellerName:seller.name,expectedStoreName:storeName,
      expectedServiceName:service.name,expectedDepartmentName:department.name}});
  }
  function cancelConfirmation(){
    setPending(null);report('');
    if(uncertain){setSelected([]);setRefresh(value=>value+1);setNotice('Résultat non confirmé. Vérifiez les ventes avant de recommencer.');}
    setUncertain(false);
  }
  async function confirm() {
    if(!pending||saving)return;
    setSaving(true);onBusy?.(true);report('');
    const {kind,body}=pending;
    try {
      const result=await api(kind==='add'?'/api/admin/sales/add-correction':'/api/admin/sales/correct',{method:'POST',token,body});
      if(kind==='add') {
        const count=Number(result.added)||body.quantity;
        setAddition(emptyAddition());setMode('remove');setNotice(result.duplicate?`Cet ajout avait déjà été pris en compte pour le ${dateText(body.saleDate)}. Vérifiez les ventes affichées.`:`${count} ${count>1?'ventes ajoutées':'vente ajoutée'} pour le ${dateText(body.saleDate)}.`);
      } else {
        setSelected([]);setRows(old=>old.filter(row=>!body.saleIds.includes(row.id)));
        setNotice(`${result.deleted} ${result.deleted>1?'ventes retirées':'vente retirée'}.`);
      }
      setPending(null);setUncertain(false);setRefresh(value=>value+1);onUpdate?.();
    } catch(e) {
      if(e.status&&e.status>=400&&e.status<500&&e.status!==408&&e.status!==429) {
        setPending(null);setUncertain(false);report(e.message||'La sélection a changé. Rechargez la liste.',true);
      } else {setUncertain(true);report('Résultat incertain : la correction a peut-être été appliquée. Réessayez ou vérifiez les ventes avant de recommencer.');}
    } finally {setSaving(false);onBusy?.(false);}
  }
  const locked=disabled||saving||!!pending,displayRows=rows.filter(row=>!serviceFilter||String(row.serviceId)===serviceFilter)
    .map(row=>rowLabel(row,services,departments))
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')||b.id.localeCompare(a.id));
  return <section className="sales-history" aria-labelledby="sales-history-title">
    <VisibleFeedback message={notice} tone={notice.startsWith('Résultat non confirmé')?'error':'success'} revision={noticeRevision}/>
    <VisibleFeedback message={error} tone="error" revision={errorRevision} actionLabel={uncertain&&pending&&!saving&&!disabled?'Réessayer':canReload&&!pending?'Recharger':''} onAction={()=>{if(uncertain&&pending)confirm();else {onReload?.();setRefresh(value=>value+1);}}}/>
    <div className="admin-section-heading"><div><h3 id="sales-history-title">Correction des ventes</h3><p>Choisissez un vendeur et une journée, puis ajoutez ou retirez des ventes.</p></div></div>
    <div className="history-filters">
      <label><span className="form-label">VENDEUR</span><select className="text-input" aria-label="Vendeur pour l’historique" value={sellerId} disabled={locked||!eligible.length} onChange={event=>{clearSelection();setSellerId(event.target.value);}}><option value="">Choisir un vendeur</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.name}{s.active?'':' · archivé'}</option>)}</select></label>
      <label><span className="form-label">JOURNÉE À CORRIGER</span><input className="text-input history-date-input" type="date" aria-label="Date de référence des ventes" max={today} value={anchor||''} disabled={locked} onChange={event=>{clearSelection();setAnchor(event.target.value);}}/></label>
    </div>
    {!range&&<p className="history-warning" role="alert">Choisissez une journée valide, aujourd’hui ou dans le passé.</p>}
    {notice&&<div className="goal-saved history-notice" role="status">{notice}</div>}
    {error&&!pending&&<div className="form-error history-error" role="alert">{error}{canReload&&<button type="button" onClick={()=>{onReload?.();setRefresh(value=>value+1);}}> Recharger</button>}</div>}
    {!seller?<div className="history-empty">Sélectionnez un vendeur pour corriger ses ventes.</div>:range&&<>
      <div className="history-range"><CalendarDays size={14} aria-hidden="true"/><span>{seller.name} · {dateText(anchor)}</span></div>
      <div className="history-modes" role="group" aria-label="Action sur les ventes">
        <button type="button" aria-pressed={mode==='remove'} className={mode==='remove'?'active':''} disabled={locked} onClick={()=>changeMode('remove')}><Trash2 size={15}/> Retirer</button>
        <button type="button" aria-pressed={mode==='add'} className={mode==='add'?'active':''} disabled={locked} onClick={()=>changeMode('add')}><Plus size={16}/> Ajouter</button>
      </div>
      {mode==='add'?<div className="history-add-panel">
        <div className="history-subheading"><div><h4>Ajouter des ventes</h4><p>La vente sera rattachée au département actuel du vendeur, même pour une date passée.</p></div></div>
        <form className="history-add-form" onSubmit={prepareAdd}>
          <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service à ajouter" value={addition.serviceId} disabled={locked||!additionServices.length} required onChange={e=>{setAddition(v=>({...v,serviceId:e.target.value}));report('');}}><option value="">Choisir un service</option>{additionServices.map(s=><option key={s.id} value={s.id}>{s.name}{s.active===false||s.active===0?' · inactif':''}</option>)}</select></label>
          <p className="history-current-department">Département actuel : <strong>{departments.find(d=>d.id===sellerDepartmentId(seller))?.name||'indisponible'}</strong></p>
          <label><span className="form-label">NOMBRE DE VENTES · {MAX_SALE_CORRECTION} MAXIMUM</span><input className="text-input" type="number" inputMode="numeric" aria-label="Nombre de ventes à ajouter" min="1" max={MAX_SALE_CORRECTION} step="1" value={addition.quantity} disabled={locked} required onChange={e=>{setAddition(v=>({...v,quantity:e.target.value}));report('');}}/></label>
          <button type="submit" className="history-add-button" disabled={locked||!additionServices.length||!departments.some(d=>d.id===sellerDepartmentId(seller))}><Plus size={15}/> Vérifier l’ajout</button>
        </form>
        {pending?.kind==='add'&&<div className="history-confirm history-confirm-add" role="group" aria-label="Confirmer l’ajout des ventes">
          <strong>Ajouter {pending.body.quantity} {pending.body.quantity>1?'ventes':'vente'} ?</strong>
          <p>{pending.body.expectedSellerName} · {pending.body.expectedStoreName}</p>
          <p><b>{pending.body.expectedServiceName}</b> · Département actuel : <b>{pending.body.expectedDepartmentName}</b><br/>Jour de la vente : <b>{dateText(pending.body.saleDate)}</b></p>
          <p>Les bilans seront recalculés, sans modifier les objectifs. Aucune notification ne sera envoyée.</p>
          {error&&<div className="form-error history-error" role="alert">{error}</div>}
          <div><button type="button" className="outline-button" disabled={saving} onClick={cancelConfirmation}>{uncertain?'Vérifier les ventes':'Annuler'}</button><button type="button" className="history-confirm-add-button" disabled={disabled||saving} onClick={confirm}>{saving?'Ajout…':uncertain?'Réessayer':'Confirmer l’ajout'}</button></div>
        </div>}
      </div>:<div className="history-remove-panel">
        <div className="history-list-heading"><div><h4>Retirer des ventes</h4><p>Sélectionnez les ventes à retirer pour cette journée.</p></div></div>
        <label className="history-service-filter"><span className="form-label">SERVICE</span><select className="text-input" aria-label="Filtrer les ventes par service" value={serviceFilter} disabled={locked} onChange={e=>{setServiceFilter(e.target.value);setSelected([]);setNotice('');}}><option value="">Tous les services</option>{additionServices.map(s=><option key={s.id} value={s.id}>{s.name}{s.active===false||s.active===0?' · inactif':''}</option>)}</select></label>
        {loading?<div className="history-empty">Chargement des ventes…</div>:<>
          {displayRows.length?<div className="history-list">{displayRows.map(row=><label className={`history-row ${selected.includes(row.id)?'is-selected':''}`} key={row.id}>
            <input type="checkbox" checked={selected.includes(row.id)} disabled={locked||(!selected.includes(row.id)&&selected.length>=MAX_SALE_CORRECTION)} onChange={()=>select(row.id)}/>
            <span className="history-row-copy"><strong>{row.serviceName}</strong><small>{row.departmentName}</small><small>{row.source==='adjustment'?`Correction administrative${recordedAt(row.createdAt)?` · saisie le ${recordedAt(row.createdAt)}`:''}`:`Vente · ${hour(row.createdAt)}`} · réf. {row.id.slice(-6).toUpperCase()}</small></span>
          </label>)}</div>:!error&&<div className="history-empty">{next?'Aucune vente correspondante dans cette partie de la liste.':'Aucune vente correspondante pour cette journée.'}</div>}
          {next&&<button type="button" className="history-more" onClick={more} disabled={locked||loadingMore}>{loadingMore?'Chargement…':'Charger la suite'} <ChevronDown size={14}/></button>}
          {displayRows.length>0&&<div className="history-actions"><span>{selected.length} sélectionnée{selected.length>1?'s':''} · {MAX_SALE_CORRECTION} maximum</span><button type="button" className="history-delete" disabled={locked||!selected.length} onClick={prepareDelete}><Trash2 size={14}/> Retirer la sélection</button></div>}
        </>}
        {pending?.kind==='delete'&&<div className="history-confirm" role="group" aria-label="Confirmer la suppression des ventes sélectionnées">
          <strong>Retirer {pending.items.length} {pending.items.length>1?'ventes':'vente'} ?</strong><p>{pending.body.expectedSellerName} · {pending.body.expectedStoreName} · {dateText(anchor)}</p>
          <ul>{pending.items.map(row=><li key={row.id}>{row.serviceName} · {row.departmentName} · {row.source==='adjustment'?'Correction administrative':hour(row.createdAt)} · réf. {row.id.slice(-6).toUpperCase()}</li>)}</ul>
          <p>Les bilans seront recalculés, sans modifier les objectifs ni le catalogue.</p>
          {error&&<div className="form-error history-error" role="alert">{error}</div>}
          <div><button type="button" className="outline-button" disabled={saving} onClick={cancelConfirmation}>{uncertain?'Vérifier les ventes':'Annuler'}</button><button type="button" className="history-confirm-delete" disabled={disabled||saving} onClick={confirm}>{saving?'Suppression…':uncertain?'Réessayer':'Confirmer le retrait'}</button></div>
        </div>}
      </div>}
      <div className="admin-note"><Info size={15}/> Les corrections ne déclenchent pas de notification de vente.</div>
    </>}
  </section>;
}
