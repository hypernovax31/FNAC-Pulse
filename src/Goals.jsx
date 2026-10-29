import React, { useState } from 'react';
import { ArrowRight, Pencil, Target, RotateCw } from 'lucide-react';
import { GOAL_LABELS, GOAL_LIMIT, GOAL_PERIODS, WORKDAY_NAMES, WORKDAY_ORDER, goalReference, goalTargets, hasGoal, parseGoalInputs, progressFor, normalizeWorkdays, validWorkdays, workdaysLabel } from './goals';
import { parisToday } from './cloud-stats';

const REFERENCE_SUFFIX = {day:'jour travaillé',week:'semaine',month:'mois'};
const PERSONAL_PERIOD_LABELS = {day:'Jour',week:'Semaine',month:'Mois'};
const referenceInputs = (period,amount) => Object.fromEntries(GOAL_PERIODS.map(p=>[p,p===period?amount:'']));
function formReference(entry) {
  const reference=goalReference(entry);
  return reference?{period:reference.period,amount:String(reference.amount)}:{period:'month',amount:''};
}

// Utilisé par le vendeur et par l'administration pour garder les mêmes règles.
export function GoalForm({services,goals,workdays,initialServiceId,onSave,onCancel,disabled=false,date=parisToday()}) {
  const initial=services.find(s=>String(s.id)===String(initialServiceId))?.id||services[0]?.id||'';
  const entry=goals?.[`s${initial}`],initialReference=formReference(entry);
  const [service,setService]=useState(String(initial));
  const [basis,setBasis]=useState(initialReference.period);
  const [amount,setAmount]=useState(initialReference.amount);
  const [revision,setRevision]=useState(entry?.revision||null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const current=goals?.[`s${service}`];
  const stale=!!service && (current?.revision||null)!==revision;
  const numeric=/^\d+$/.test(amount)?Number(amount):null;
  const preview=numeric!==null&&numeric>=0&&numeric<=GOAL_LIMIT?goalTargets({[basis]:numeric},date,workdays):null;
  function loadService(id) {
    const next=goals?.[`s${id}`],reference=formReference(next);
    setService(String(id));setBasis(reference.period);setAmount(reference.amount);setRevision(next?.revision||null);setError('');setNotice('');
  }
  function changeBasis(period) {
    const suggested=preview?.[period];
    setBasis(period);setAmount(Number.isInteger(suggested)&&suggested>=0&&suggested<=GOAL_LIMIT?String(suggested):'');setError('');setNotice('');
  }
  async function save(values,removed=false) {
    setBusy(true);
    try {
      const result=await onSave({serviceId:Number(service),values,revision});
      const next=result?.goals?.[`s${service}`];
      if(next){const reference=formReference(next);setRevision(next.revision);setBasis(reference.period);setAmount(reference.amount);}
      setNotice(removed?'Objectif supprimé.':'Objectifs enregistrés.');
    } catch(e){setError(e.message||'Impossible d’enregistrer les objectifs.');}
    finally{setBusy(false);}
  }
  async function submit(event) {
    event.preventDefault();setError('');setNotice('');
    if(!service||stale)return;
    let values;try{values=parseGoalInputs(referenceInputs(basis,amount));}catch(e){setError(e.message);return;}
    if(!hasGoal(values)){setError('Indiquez une cible de référence pour ce service.');return;}
    await save(values);
  }
  function remove() {
    if(!service||stale||busy||disabled)return;
    const name=services.find(s=>String(s.id)===service)?.name||'ce service';
    if(!window.confirm(`Supprimer les objectifs de ${name} pour les trois périodes ?`))return;
    setError('');setNotice('');save({day:null,week:null,month:null},true);
  }
  return <form className="goal-form" onSubmit={submit}>
    <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service pour les objectifs" value={service} onChange={e=>loadService(e.target.value)} disabled={busy||disabled||!services.length}>
      {!services.length&&<option value="">Aucun service disponible</option>}{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <p className="goal-form-intro">Choisissez une période et une seule cible : les deux autres sont calculées automatiquement.</p>
    <div className="goal-base-fields">
      <label><span className="form-label">PÉRIODE DE RÉFÉRENCE</span><select className="text-input" aria-label="Période de référence" value={basis} onChange={e=>changeBasis(e.target.value)} disabled={busy||disabled||!service}>
        <option value="day">Par jour travaillé</option><option value="week">Par semaine</option><option value="month">Par mois</option>
      </select></label>
      <label><span className="form-label">CIBLE À ATTEINDRE</span><input className="text-input" aria-label="Cible de référence" inputMode="numeric" type="number" min="0" max={GOAL_LIMIT} step="1" placeholder="Ex. 10" value={amount} disabled={busy||disabled||!service} onChange={e=>{setAmount(e.target.value);setNotice('');}} required/></label>
    </div>
    <div className="goal-preview" aria-live="polite"><span className="form-label">RÉPARTITION ACTUELLE</span><div className="goal-preview-grid">{GOAL_PERIODS.map(period=><div key={period}><span>{GOAL_LABELS[period]}</span><strong>{preview?preview[period]:'—'}</strong></div>)}</div></div>
    <p className="goal-form-hint">Jours travaillés : {workdaysLabel(workdays)}. Jours fériés inclus ; l’administrateur peut modifier ces jours. La répartition est entière et certains jours peuvent être à 0.</p>
    {stale&&<div className="goal-conflict" role="alert"><span>Cet objectif a été modifié ailleurs.</span><button type="button" onClick={()=>loadService(service)}><RotateCw size={13}/> Recharger les valeurs</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {notice&&<div className="goal-saved" role="status">{notice}</div>}
    {hasGoal(current)&&<button type="button" className="goal-remove" onClick={remove} disabled={busy||disabled||stale}>Supprimer l’objectif de ce service</button>}
    <div className="goal-form-actions">{onCancel&&<button type="button" className="outline-button" onClick={onCancel} disabled={busy}>Fermer</button>}<button className="primary-button" type="submit" disabled={busy||disabled||stale||!service||!amount}>{busy?'Enregistrement…':'Enregistrer'} <ArrowRight size={15}/></button></div>
  </form>;
}

// Jours habituels par vendeur, du lundi au dimanche ; formulaire réservé à l'administration.
export function WorkdaysForm({workdays,revision,onSave,disabled=false}) {
  const [selected,setSelected]=useState(()=>normalizeWorkdays(workdays));
  const [editRevision,setEditRevision]=useState(revision||null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const stale=(revision||null)!==editRevision;
  const changed=selected.join(',')!==normalizeWorkdays(workdays).join(',');
  function reload() {setSelected(normalizeWorkdays(workdays));setEditRevision(revision||null);setError('');setNotice('');}
  function toggle(day) {
    setSelected(days=>{const next=days.includes(day)?days.filter(x=>x!==day):[...days,day];return WORKDAY_ORDER.filter(x=>next.includes(x));});
    setError('');setNotice('');
  }
  async function submit(event) {
    event.preventDefault();setError('');setNotice('');
    if(stale||!validWorkdays(selected))return;
    setBusy(true);
    try {
      const result=await onSave({workdays:selected,revision:editRevision});
      setSelected(normalizeWorkdays(result.workdays));setEditRevision(result.workdaysRevision||null);setNotice('Jours travaillés enregistrés.');
    } catch(e){setError(e.message||'Impossible d’enregistrer les jours travaillés.');}
    finally{setBusy(false);}
  }
  return <form className="workdays-form" aria-labelledby="admin-workdays-title" onSubmit={submit}>
    <div className="workdays-heading"><div><h4 id="admin-workdays-title">Jours travaillés</h4><p>Choisissez les jours habituels de ce vendeur, du lundi au dimanche. Sélectionnez au moins un jour.</p></div>{!revision&&<span>Par défaut · à vérifier</span>}</div>
    <fieldset className="workdays-list" disabled={busy||disabled}><legend className="sr-only">Jours travaillés de ce vendeur</legend>
      {WORKDAY_ORDER.map(id=><label className={`workday-option ${selected.includes(id)?'is-selected':''}`} key={id}>
        <input type="checkbox" checked={selected.includes(id)} onChange={()=>toggle(id)}/><span>{WORKDAY_NAMES[id][0].toUpperCase()+WORKDAY_NAMES[id].slice(1)}</span>
      </label>)}
    </fieldset>
    <div className="workdays-actions"><span aria-live="polite">{selected.length} {selected.length>1?'jours sélectionnés':'jour sélectionné'}</span><button type="submit" className="outline-button" disabled={busy||disabled||stale||!validWorkdays(selected)||(!changed&&!!editRevision)}>{busy?'Enregistrement…':'Enregistrer les jours'}</button></div>
    <p className="goal-form-hint">Jours fériés inclus. Le planning se répète chaque semaine et ne gère pas les absences ponctuelles ; toutes les ventes restent comptées.</p>
    {stale&&<div className="goal-conflict" role="alert"><span>Ces jours ont été modifiés ailleurs.</span><button type="button" onClick={reload}><RotateCw size={13}/> Recharger les jours</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="goal-saved" role="status">{notice}</div>}
  </form>;
}

function GoalMetric({service,period,target,stats}) {
  const rows=stats?.[period]?.mineByService;
  const available=Array.isArray(rows);
  const count=available?(rows.find(item=>Number(item.serviceId)===Number(service.id))?.count||0):null;
  const progress=available&&target>0?progressFor(count,target):null;
  return <div className="goal-metric">
    <div className="goal-metric-label"><span>{PERSONAL_PERIOD_LABELS[period]}</span>{target!==null?<strong>{available?count:'—'} <span>/ {target}</span></strong>:<span className="goal-unset">Indisponible</span>}</div>
    {target>0?<div className={`goal-track ${progress?.reached?'is-reached':''}`} role={available?'progressbar':undefined}
      aria-label={available?`${service.name}, ${GOAL_LABELS[period]}`:undefined} aria-valuemin={available?0:undefined} aria-valuemax={available?target:undefined}
      aria-valuenow={available?Math.min(count,target):undefined} aria-valuetext={available?`${count} sur ${target}${progress.reached?', objectif atteint':''}`:undefined}>
      <span style={{width:`${progress?.percent||0}%`}}/>
    </div>:<><div className="goal-track is-unset" aria-hidden="true"/>{target===0&&<span className="goal-zero-note">Aucune vente prévue</span>}</>}
  </div>;
}

export function GoalsPanel({seller,services,goals,workdays,workdaysDefault=false,stats,loading,error,offline,onEdit,onRetry,date=parisToday()}) {
  const configured=services.filter(service=>hasGoal(goals?.[`s${service.id}`]));
  return <section className="panel goals-panel" aria-labelledby="personal-goals-title">
    <div className="goals-heading"><div><div className="section-kicker"><span className="kicker-line"/> VOTRE PROGRESSION</div><h2 id="personal-goals-title">Mes objectifs</h2><p>Vos ventes font avancer vos objectifs par service.</p></div>
      <button className="goal-manage" onClick={()=>onEdit(null)} disabled={!goals||offline||!services.length}><Pencil size={14}/> <span>Gérer</span></button>
    </div>
    {offline&&<p className="goal-offline">Lecture hors ligne · les modifications seront possibles au retour de la connexion.</p>}
    {!goals ? <div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{loading?'Chargement de vos objectifs…':'Vos objectifs sont indisponibles.'}</strong><p>{error||'Ils apparaîtront ici dès que votre espace sera prêt.'}</p>{!loading&&!offline&&<button type="button" onClick={onRetry}>Réessayer</button>}</div></div>
    :configured.length===0?<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>Aucun objectif défini pour le moment.</strong><p>Choisissez un service pour définir vos objectifs, ou demandez à votre responsable.</p><button type="button" onClick={()=>onEdit(null)} disabled={offline||!services.length}>Définir un objectif <ArrowRight size={13}/></button></div></div>
    :<div className="goals-grid">{configured.map(service=>{
      const entry=goals?.[`s${service.id}`],reference=goalReference(entry),targets=goalTargets(entry,date,workdays);
      return <article className="goal-card" key={service.id}>
        <div className="goal-card-heading"><div><span className="goal-card-icon"><Target size={16}/></span><div className="goal-card-name"><strong>{service.name}</strong>{reference&&<span>Référence : {reference.amount} / {REFERENCE_SUFFIX[reference.period]}</span>}</div></div><button className="icon-button goal-card-edit" aria-label={`Modifier les objectifs ${service.name}`} onClick={()=>onEdit(service.id)} disabled={offline}><Pencil size={15}/></button></div>
        <div className="goal-metrics">{GOAL_PERIODS.map(period=><GoalMetric key={period} service={service} period={period} target={targets?.[period]??null} stats={stats}/>)}</div>
      </article>;
    })}</div>}
    {error&&goals&&!offline&&<p className="goal-sync-warning">Dernières valeurs affichées · {error} <button type="button" onClick={onRetry}>Réessayer</button></p>}
    {configured.length>0&&<p className="goal-caption">Jours travaillés de {seller?.name||'votre profil'}{workdaysDefault?' (par défaut, à vérifier)':''} : {workdaysLabel(workdays)}. Jours fériés inclus ; toutes les ventes restent comptées dans les bilans.</p>}
  </section>;
}
