import React, { useState } from 'react';
import { ArrowRight, Pencil, Target, RotateCw } from 'lucide-react';
import { GOAL_LABELS, GOAL_LIMIT, GOAL_PERIODS, goalReference, goalTargets, hasGoal, parseGoalInputs, progressFor } from './goals';
import { parisToday } from './cloud-stats';

const REFERENCE_SUFFIX = {day:'jour travaillé',week:'semaine',month:'mois'};
const referenceInputs = (period,amount) => Object.fromEntries(GOAL_PERIODS.map(p=>[p,p===period?amount:'']));
function formReference(entry) {
  const reference=goalReference(entry);
  return reference?{period:reference.period,amount:String(reference.amount)}:{period:'month',amount:''};
}

// Utilisé par le vendeur et par l'administration pour garder les mêmes règles.
export function GoalForm({services,goals,initialServiceId,onSave,onCancel,disabled=false,date=parisToday()}) {
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
  const numeric=/^\d+$/.test(amount)?Number(amount):0;
  const preview=numeric>=1&&numeric<=GOAL_LIMIT?goalTargets({[basis]:numeric},date):null;
  function loadService(id) {
    const next=goals?.[`s${id}`],reference=formReference(next);
    setService(String(id));setBasis(reference.period);setAmount(reference.amount);setRevision(next?.revision||null);setError('');setNotice('');
  }
  function changeBasis(period) {
    const suggested=preview?.[period];
    setBasis(period);setAmount(Number.isInteger(suggested)&&suggested>=1&&suggested<=GOAL_LIMIT?String(suggested):'');setError('');setNotice('');
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
      <label><span className="form-label">CIBLE À ATTEINDRE</span><input className="text-input" aria-label="Cible de référence" inputMode="numeric" type="number" min="1" max={GOAL_LIMIT} step="1" placeholder="Ex. 10" value={amount} disabled={busy||disabled||!service} onChange={e=>{setAmount(e.target.value);setNotice('');}} required/></label>
    </div>
    <div className="goal-preview" aria-live="polite"><span className="form-label">RÉPARTITION ACTUELLE</span><div className="goal-preview-grid">{GOAL_PERIODS.map(period=><div key={period}><span>{GOAL_LABELS[period]}</span><strong>{preview?preview[period]:'—'}</strong></div>)}</div></div>
    <p className="goal-form-hint">Répartition en nombres entiers du lundi au samedi, jours fériés inclus. Certains jours peuvent être à 0. La cible choisie se répète ; les autres s’adaptent au calendrier.</p>
    {stale&&<div className="goal-conflict" role="alert"><span>Cet objectif a été modifié ailleurs.</span><button type="button" onClick={()=>loadService(service)}><RotateCw size={13}/> Recharger les valeurs</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {notice&&<div className="goal-saved" role="status">{notice}</div>}
    {hasGoal(current)&&<button type="button" className="goal-remove" onClick={remove} disabled={busy||disabled||stale}>Supprimer l’objectif de ce service</button>}
    <div className="goal-form-actions">{onCancel&&<button type="button" className="outline-button" onClick={onCancel} disabled={busy}>Fermer</button>}<button className="primary-button" type="submit" disabled={busy||disabled||stale||!service||!amount}>{busy?'Enregistrement…':'Enregistrer'} <ArrowRight size={15}/></button></div>
  </form>;
}

function GoalMetric({service,period,target,stats}) {
  const rows=stats?.[period]?.mineByService;
  const available=Array.isArray(rows);
  const count=available?(rows.find(item=>Number(item.serviceId)===Number(service.id))?.count||0):null;
  const progress=available&&target>0?progressFor(count,target):null;
  return <div className="goal-metric">
    <div className="goal-metric-label"><span>{GOAL_LABELS[period]}</span>{target!==null?<strong>{available?count:'—'} <span>/ {target}</span></strong>:<span className="goal-unset">Indisponible</span>}</div>
    {target>0?<div className={`goal-track ${progress?.reached?'is-reached':''}`} role={available?'progressbar':undefined}
      aria-label={available?`${service.name}, ${GOAL_LABELS[period]}`:undefined} aria-valuemin={available?0:undefined} aria-valuemax={available?target:undefined}
      aria-valuenow={available?Math.min(count,target):undefined} aria-valuetext={available?`${count} sur ${target}${progress.reached?', objectif atteint':''}`:undefined}>
      <span style={{width:`${progress?.percent||0}%`}}/>
    </div>:<><div className="goal-track is-unset" aria-hidden="true"/>{target===0&&<span className="goal-zero-note">Aucune vente prévue</span>}</>}
  </div>;
}

export function GoalsPanel({seller,services,goals,stats,loading,error,offline,onEdit,onRetry,date=parisToday()}) {
  const configured=services.filter(service=>hasGoal(goals?.[`s${service.id}`]));
  return <section className="panel goals-panel" aria-labelledby="personal-goals-title">
    <div className="goals-heading"><div><div className="section-kicker"><span className="kicker-line"/> VOTRE PROGRESSION</div><h2 id="personal-goals-title">Mes objectifs</h2><p>Vos ventes font avancer vos objectifs par service.</p></div>
      <button className="goal-manage" onClick={()=>onEdit(null)} disabled={!goals||offline||!services.length}><Pencil size={14}/> <span>Gérer</span></button>
    </div>
    {offline&&<p className="goal-offline">Lecture hors ligne · les modifications seront possibles au retour de la connexion.</p>}
    {!goals ? <div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{loading?'Chargement de vos objectifs…':'Vos objectifs sont indisponibles.'}</strong><p>{error||'Ils apparaîtront ici dès que votre espace sera prêt.'}</p>{!loading&&!offline&&<button type="button" onClick={onRetry}>Réessayer</button>}</div></div>
    :configured.length===0?<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>Aucun objectif défini pour le moment.</strong><p>Choisissez un service pour définir vos objectifs, ou demandez à votre responsable.</p><button type="button" onClick={()=>onEdit(null)} disabled={offline||!services.length}>Définir un objectif <ArrowRight size={13}/></button></div></div>
    :<div className="goals-grid">{configured.map(service=>{
      const entry=goals?.[`s${service.id}`],reference=goalReference(entry),targets=goalTargets(entry,date);
      return <article className="goal-card" key={service.id}>
        <div className="goal-card-heading"><div><span className="goal-card-icon"><Target size={16}/></span><div className="goal-card-name"><strong>{service.name}</strong>{reference&&<span>Référence : {reference.amount} / {REFERENCE_SUFFIX[reference.period]}</span>}</div></div><button className="icon-button goal-card-edit" aria-label={`Modifier les objectifs ${service.name}`} onClick={()=>onEdit(service.id)} disabled={offline}><Pencil size={15}/></button></div>
        <div className="goal-metrics">{GOAL_PERIODS.map(period=><GoalMetric key={period} service={service} period={period} target={targets?.[period]??null} stats={stats}/>)}</div>
      </article>;
    })}</div>}
    {error&&goals&&!offline&&<p className="goal-sync-warning">Dernières valeurs affichées · {error} <button type="button" onClick={onRetry}>Réessayer</button></p>}
    {configured.length>0&&<p className="goal-caption">Objectifs de {seller?.name||'votre profil'} répartis du lundi au samedi, jours fériés inclus. Les ventes du dimanche comptent dans les bilans.</p>}
  </section>;
}
