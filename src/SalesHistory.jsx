import React, {useEffect,useRef,useState} from 'react';
import {CalendarDays,ChevronDown,Info,Plus,Trash2} from 'lucide-react';
import {api,uid,dateLabel,timeLabel} from './api';
import {sellerDepartmentId} from './departments.js';
import {MAX_SALE_CORRECTION,SALE_CORRECTION_CONFIRMATION,SALE_ADDITION_CONFIRMATION,saleHistoryRange,validAdditionDate} from './sale-history.js';

const periods=[['day','Jour'],['week','Semaine'],['month','Mois']];
const dateText=value=>dateLabel(value,{day:'numeric',month:'long',year:'numeric'});
const emptyAddition=()=>({serviceId:'',departmentId:'',saleDate:'',quantity:'1'});
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
function query({storeId,sellerId,period,anchor},cursor=null) {
  const params=new URLSearchParams({storeId,sellerId:String(sellerId),period,anchor});
  if(cursor){params.set('afterDate',cursor.date);params.set('afterId',cursor.id);}
  return `/api/admin/sales/history?${params}`;
}

export function SalesHistoryPanel({storeId,storeName,sellers,services,additionServices=services,departments,today,token,disabled=false,onBusy,onUpdate,onReload}) {
  const [sellerId,setSellerId]=useState(''),[period,setPeriod]=useState('day'),[anchor,setAnchor]=useState(today);
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[selected,setSelected]=useState([]),[pending,setPending]=useState(null);
  const [addition,setAddition]=useState(emptyAddition),[serviceFilter,setServiceFilter]=useState('');
  const [loading,setLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[canReload,setCanReload]=useState(false),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),sequence=useRef(0);
  const eligible=sellers.filter(s=>!s.deletingJob),seller=eligible.find(s=>String(s.id)===sellerId);
  const range=saleHistoryRange(period,anchor,today),selection={storeId,sellerId,period,anchor};
  function report(message,reload=false){setError(message);setCanReload(reload);}
  useEffect(()=>{
    const request=++sequence.current,controller=new AbortController();
    setRows([]);setNext(null);setSelected([]);setPending(null);setError('');setCanReload(false);setLoadingMore(false);
    if(!sellerId||!range){setLoading(false);return ()=>controller.abort();}
    setLoading(true);
    api(query({storeId,sellerId,period,anchor}),{token,signal:controller.signal}).then(result=>{
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Historique indisponible. Réessayez.');
      setRows(result.sales);setNext(result.next||null);
    }).catch(e=>{if(sequence.current===request&&!controller.signal.aborted)report(e.message||'Impossible de charger les ventes.',true);})
      .finally(()=>{if(sequence.current===request)setLoading(false);});
    return ()=>{controller.abort();sequence.current++;};
  },[storeId,sellerId,period,anchor,today,token,refresh]);
  function clearAddition(){setAddition(emptyAddition());setServiceFilter('');setSelected([]);setNotice('');report('');}
  async function more() {
    if(!next||loadingMore)return;
    const request=sequence.current;setLoadingMore(true);report('');
    try {
      const result=await api(query(selection,next),{token});
      if(sequence.current!==request)return;
      if(!Array.isArray(result.sales))throw new Error('Historique indisponible. Réessayez.');
      setRows(old=>{const seen=new Set(old.map(row=>row.id));return [...old,...result.sales.filter(row=>!seen.has(row.id))];});setNext(result.next||null);
    } catch(e){if(sequence.current===request)report(e.message||'Impossible de charger la suite.',true);}
    finally{if(sequence.current===request)setLoadingMore(false);}
  }
  function select(id) {setSelected(old=>old.includes(id)?old.filter(x=>x!==id):old.length<MAX_SALE_CORRECTION?[...old,id]:old);setNotice('');}
  function prepareDelete() {
    if(!seller||!selected.length||!range)return;
    const items=rows.filter(row=>selected.includes(row.id)).map(row=>rowLabel(row,services,departments));
    if(items.length!==selected.length)return;
    report('');setPending({kind:'delete',body:{storeId,sellerId:Number(sellerId),period,anchor,saleIds:items.map(row=>row.id),requestId:uid(),
      confirmation:SALE_CORRECTION_CONFIRMATION,expectedSellerName:seller.name,expectedStoreName:storeName},items});
  }
  function prepareAdd(event) {
    event.preventDefault();
    if(!seller||!range||disabled||saving||pending)return;
    const service=additionServices.find(s=>String(s.id)===addition.serviceId),department=departments.find(d=>d.id===addition.departmentId);
    const saleDate=period==='day'?anchor:addition.saleDate,quantity=Number(addition.quantity);
    if(!service||!department){report('Choisissez le service et le département de la vente.');return;}
    if(!validAdditionDate(period,anchor,saleDate,today)){report('Choisissez le jour exact de la vente dans la période, sans date future.');return;}
    if(!Number.isInteger(quantity)||quantity<1||quantity>MAX_SALE_CORRECTION){report(`Choisissez de 1 à ${MAX_SALE_CORRECTION} ventes maximum.`);return;}
    report('');setNotice('');
    setPending({kind:'add',body:{storeId,sellerId:Number(sellerId),period,anchor,saleDate,serviceId:Number(service.id),departmentId:department.id,
      quantity,requestId:uid(),confirmation:SALE_ADDITION_CONFIRMATION,expectedSellerName:seller.name,expectedStoreName:storeName,
      expectedServiceName:service.name,expectedDepartmentName:department.name}});
  }
  async function confirm() {
    if(!pending||saving)return;
    setSaving(true);onBusy?.(true);report('');
    const {kind,body}=pending;
    try {
      const result=await api(kind==='add'?'/api/admin/sales/add-correction':'/api/admin/sales/correct',{method:'POST',token,body});
      if(kind==='add') {
        const count=Number(result.added)||body.quantity;
        setAddition(emptyAddition());setNotice(result.duplicate?`Cette demande avait déjà été prise en compte pour le ${dateText(body.saleDate)}. Vérifiez les ventes affichées.`:`${count} ${count>1?'ventes ajoutées':'vente ajoutée'} pour le ${dateText(body.saleDate)}. Les bilans sont mis à jour.`);
      } else {
        setSelected([]);setRows(old=>old.filter(row=>!body.saleIds.includes(row.id)));
        setNotice(`${result.deleted} ${result.deleted>1?'ventes retirées':'vente retirée'}. Les bilans sont mis à jour.`);
      }
      setPending(null);setRefresh(value=>value+1);onUpdate?.();
    } catch(e) {
      if(e.status&&e.status>=400&&e.status<500&&e.status!==408&&e.status!==429) {
        setPending(null);report(e.message||'La sélection a changé. Rechargez la liste.',true);
      } else report('La réponse est incertaine : la correction a peut-être été appliquée. Réessayez sans modifier la sélection ou rechargez la liste.');
    } finally {setSaving(false);onBusy?.(false);}
  }
  const locked=disabled||saving||!!pending,displayRows=rows.filter(row=>!serviceFilter||String(row.serviceId)===serviceFilter)
    .map(row=>rowLabel(row,services,departments))
    .sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||(b.createdAt||'').localeCompare(a.createdAt||'')||b.id.localeCompare(a.id));
  const label=range?(range.start===range.end?dateText(range.start):`${dateText(range.start)} — ${dateText(range.end)}`):'';
  const lastDate=range&&range.end<today?range.end:today;
  return <section className="sales-history" aria-labelledby="sales-history-title">
    <div className="admin-section-heading"><div><h3 id="sales-history-title">Correction des ventes</h3><p>Choisissez un vendeur et une période. Ajoutez des ventes à leur jour exact ou sélectionnez celles à retirer.</p></div></div>
    <div className="history-filters">
      <label><span className="form-label">VENDEUR</span><select className="text-input" aria-label="Vendeur pour l’historique" value={sellerId} disabled={locked||!eligible.length} onChange={event=>{clearAddition();setSellerId(event.target.value);}}><option value="">Choisir un vendeur</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.name}{s.active?'':' · archivé'}</option>)}</select></label>
      <fieldset className="history-periods" disabled={locked}><legend className="form-label">PÉRIODE</legend><div>{periods.map(([value,name])=><button key={value} type="button" aria-pressed={period===value} className={period===value?'active':''} onClick={()=>{if(period!==value)clearAddition();setPeriod(value);}}>{name}</button>)}</div></fieldset>
      <label><span className="form-label">DATE DE RÉFÉRENCE</span><input className="text-input" type="date" aria-label="Date de référence des ventes" max={today} value={anchor||''} disabled={locked} onChange={event=>{clearAddition();setAnchor(event.target.value);}}/></label>
    </div>
    {range&&seller&&<div className="history-range"><CalendarDays size={14} aria-hidden="true"/><span>{label}</span></div>}
    {!range&&<p className="history-warning" role="alert">Choisissez une date valide, aujourd’hui ou dans le passé.</p>}
    {notice&&<div className="goal-saved history-notice" role="status">{notice}</div>}
    {error&&!pending&&<div className="form-error history-error" role="alert">{error}{canReload&&<button type="button" onClick={()=>{onReload?.();setRefresh(value=>value+1);}}> Recharger</button>}</div>}
    {!sellerId?<div className="history-empty">Sélectionnez un vendeur pour corriger ses ventes.</div>:range&&<>
      <div className="history-add-panel">
        <div className="history-subheading"><div><h4>Ajouter des ventes</h4><p>Choisissez le département où la vente a été réalisée, même si le vendeur en a changé.</p></div><span aria-hidden="true"><Plus size={16}/></span></div>
        <form className="history-add-form" onSubmit={prepareAdd}>
          <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service à ajouter" value={addition.serviceId} disabled={locked||!additionServices.length} required onChange={e=>{setAddition(v=>({...v,serviceId:e.target.value}));report('');}}><option value="">Choisir un service</option>{additionServices.map(s=><option key={s.id} value={s.id}>{s.name}{s.active===false||s.active===0?' · inactif':''}</option>)}</select></label>
          <label><span className="form-label">DÉPARTEMENT DE LA VENTE</span><select className="text-input" aria-label="Département de la vente" value={addition.departmentId} disabled={locked||!departments.length} required onChange={e=>{setAddition(v=>({...v,departmentId:e.target.value}));report('');}}><option value="">Choisir le département</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}{d.active===false||d.active===0?' · archivé':d.id===sellerDepartmentId(seller)?' · actuel':''}</option>)}</select></label>
          {period==='day'?<div className="history-add-date"><span className="form-label">JOUR DE LA VENTE</span><strong>{dateText(anchor)}</strong></div>:<label><span className="form-label">JOUR EXACT DE LA VENTE</span><input className="text-input" type="date" aria-label="Jour exact de la vente à ajouter" min={range.start} max={lastDate} value={addition.saleDate} disabled={locked} required onChange={e=>{setAddition(v=>({...v,saleDate:e.target.value}));report('');}}/></label>}
          <label><span className="form-label">NOMBRE DE VENTES · {MAX_SALE_CORRECTION} MAXIMUM</span><input className="text-input" type="number" inputMode="numeric" aria-label="Nombre de ventes à ajouter" min="1" max={MAX_SALE_CORRECTION} step="1" value={addition.quantity} disabled={locked} required onChange={e=>{setAddition(v=>({...v,quantity:e.target.value}));report('');}}/></label>
          <button type="submit" className="history-add-button" disabled={locked||!additionServices.length||!departments.length}><Plus size={15}/> Vérifier l’ajout</button>
        </form>
        {pending?.kind==='add'&&<div className="history-confirm history-confirm-add" role="group" aria-label="Confirmer l’ajout des ventes">
          <strong>Ajouter {pending.body.quantity} {pending.body.quantity>1?'ventes':'vente'} ?</strong>
          <p>{pending.body.expectedSellerName} · {pending.body.expectedStoreName}</p>
          <p><b>{pending.body.expectedServiceName}</b> · {pending.body.expectedDepartmentName}<br/>Jour de la vente : <b>{dateText(pending.body.saleDate)}</b></p>
          <p>Les bilans et la progression seront recalculés, sans modifier les objectifs. Aucune notification ne sera envoyée.</p>
          {error&&<div className="form-error history-error" role="alert">{error}</div>}
          <div><button type="button" className="outline-button" disabled={saving} onClick={()=>{setPending(null);report('');}}>Annuler</button><button type="button" className="history-confirm-add-button" disabled={disabled||saving} onClick={confirm}>{saving?'Ajout…':'Confirmer l’ajout'}</button></div>
        </div>}
      </div>
      <div className="history-list-heading"><div><h4>Supprimer des ventes</h4><p>Cochez seulement les ventes à retirer, puis confirmez la sélection.</p></div></div>
      <label className="history-service-filter"><span className="form-label">FILTRER PAR SERVICE</span><select className="text-input" aria-label="Filtrer les ventes par service" value={serviceFilter} disabled={locked} onChange={e=>{setServiceFilter(e.target.value);setSelected([]);setNotice('');}}><option value="">Tous les services</option>{additionServices.map(s=><option key={s.id} value={s.id}>{s.name}{s.active===false||s.active===0?' · inactif':''}</option>)}</select></label>
      {loading?<div className="history-empty">Chargement des ventes…</div>:<>
        {displayRows.length?<div className="history-list">{displayRows.map(row=><label className={`history-row ${selected.includes(row.id)?'is-selected':''}`} key={row.id}>
          <input type="checkbox" checked={selected.includes(row.id)} disabled={locked||(!selected.includes(row.id)&&selected.length>=MAX_SALE_CORRECTION)} onChange={()=>select(row.id)}/>
          <span className="history-row-copy"><strong>{row.serviceName}</strong><small>{dateText(row.businessDate)} · {row.departmentName}</small><small>{row.source==='adjustment'?`Correction administrative${recordedAt(row.createdAt)?` · saisie le ${recordedAt(row.createdAt)}`:''}`:`Vente · ${hour(row.createdAt)}`} · réf. {row.id.slice(-6).toUpperCase()}</small></span>
        </label>)}</div>:!error&&<div className="history-empty">{next?'Aucune vente correspondante dans cette partie de la période.':'Aucune vente correspondante pour cette période.'}</div>}
        {next&&<button type="button" className="history-more" onClick={more} disabled={locked||loadingMore}>{loadingMore?'Chargement…':'Charger la suite'} <ChevronDown size={14}/></button>}
        {displayRows.length>0&&<div className="history-actions"><span>{selected.length} sélectionnée{selected.length>1?'s':''} · {MAX_SALE_CORRECTION} maximum</span><button type="button" className="history-delete" disabled={locked||!selected.length} onClick={prepareDelete}><Trash2 size={14}/> Supprimer la sélection</button></div>}
      </>}
    </>}
    {pending?.kind==='delete'&&<div className="history-confirm" role="group" aria-label="Confirmer la suppression des ventes sélectionnées">
      <strong>Retirer {pending.items.length} {pending.items.length>1?'ventes':'vente'} ?</strong><p>{pending.body.expectedSellerName} · {pending.body.expectedStoreName}</p>
      <ul>{pending.items.map(row=><li key={row.id}>{row.serviceName} · {dateText(row.businessDate)} · {row.departmentName} · {row.source==='adjustment'?'Correction administrative':hour(row.createdAt)} · réf. {row.id.slice(-6).toUpperCase()}</li>)}</ul>
      <p>Seules ces ventes seront retirées. Les bilans et la progression seront recalculés, sans modifier les objectifs ni le catalogue.</p>
      {error&&<div className="form-error history-error" role="alert">{error}</div>}
      <div><button type="button" className="outline-button" disabled={saving} onClick={()=>{setPending(null);report('');}}>Annuler</button><button type="button" className="history-confirm-delete" disabled={disabled||saving} onClick={confirm}>{saving?'Suppression…':'Confirmer la suppression'}</button></div>
    </div>}
    <div className="admin-note"><Info size={15}/> Les corrections ne déclenchent pas de notification de vente.</div>
  </section>;
}
