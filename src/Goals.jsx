import React, { useState } from 'react';
import { ArrowRight, Pencil, Target, RotateCw } from 'lucide-react';
import { GOAL_LABELS, GOAL_LIMIT, GOAL_PERIODS, hasGoal, parseGoalInputs, progressFor } from './goals';

const INPUT_LABELS = {day:'Quotidien',week:'Hebdomadaire',month:'Mensuel'};
const valueFields = entry => Object.fromEntries(GOAL_PERIODS.map(period=>[period,entry?.[period]??'']));

// Utilisé par le vendeur et par l'administration pour garder les mêmes règles.
export function GoalForm({services,goals,initialServiceId,onSave,onCancel,disabled=false}) {
  const initial=services.find(s=>String(s.id)===String(initialServiceId))?.id||services[0]?.id||'';
  const entry=goals?.[`s${initial}`];
  const [service,setService]=useState(String(initial));
  const [inputs,setInputs]=useState(()=>valueFields(entry));
  const [revision,setRevision]=useState(entry?.revision||null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const current=goals?.[`s${service}`];
  const stale=!!service && (current?.revision||null)!==revision;
  function loadService(id) {
    const next=goals?.[`s${id}`];setService(String(id));setInputs(valueFields(next));setRevision(next?.revision||null);setError('');setNotice('');
  }
  async function submit(event) {
    event.preventDefault();setError('');setNotice('');
    if(!service||stale)return;
    let values;try{values=parseGoalInputs(inputs);}catch(e){setError(e.message);return;}
    setBusy(true);
    try {
      const result=await onSave({serviceId:Number(service),values,revision});
      const next=result?.goals?.[`s${service}`];
      if(next){setRevision(next.revision);setInputs(valueFields(next));}
      setNotice('Objectifs enregistrés.');
    } catch(e){setError(e.message||'Impossible d’enregistrer les objectifs.');}
    finally{setBusy(false);}
  }
  return <form className="goal-form" onSubmit={submit}>
    <label><span className="form-label">SERVICE</span><select className="text-input" aria-label="Service pour les objectifs" value={service} onChange={e=>loadService(e.target.value)} disabled={busy||disabled||!services.length}>
      {!services.length&&<option value="">Aucun service disponible</option>}{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <div className="goal-inputs">{GOAL_PERIODS.map(period=><label key={period}><span className="form-label">{INPUT_LABELS[period]}</span><input className="text-input" aria-label={`Objectif ${INPUT_LABELS[period].toLowerCase()}`} inputMode="numeric" type="number" min="1" max={GOAL_LIMIT} step="1" placeholder="—" value={inputs[period]} disabled={busy||disabled||!service} onChange={e=>setInputs(v=>({...v,[period]:e.target.value}))}/></label>)}</div>
    <p className="goal-form-hint">Ces objectifs s’appliquent dès maintenant et se répètent. Laissez un champ vide pour ne pas fixer d’objectif.</p>
    {stale&&<div className="goal-conflict" role="alert"><span>Cet objectif a été modifié ailleurs.</span><button type="button" onClick={()=>loadService(service)}><RotateCw size={13}/> Recharger les valeurs</button></div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {notice&&<div className="goal-saved" role="status">{notice}</div>}
    <div className="goal-form-actions">{onCancel&&<button type="button" className="outline-button" onClick={onCancel} disabled={busy}>Fermer</button>}<button className="primary-button" type="submit" disabled={busy||disabled||stale||!service}>{busy?'Enregistrement…':'Enregistrer'} <ArrowRight size={15}/></button></div>
  </form>;
}

function GoalMetric({service,period,target,stats}) {
  const rows=stats?.[period]?.mineByService;
  const available=Array.isArray(rows);
  const count=available?(rows.find(item=>Number(item.serviceId)===Number(service.id))?.count||0):null;
  const progress=available?progressFor(count,target):null;
  return <div className="goal-metric">
    <div className="goal-metric-label"><span>{GOAL_LABELS[period]}</span>{target?<strong>{available?count:'—'} <span>/ {target}</span></strong>:<span className="goal-unset">Non défini</span>}</div>
    {target?<div className={`goal-track ${progress?.reached?'is-reached':''}`} role={available?'progressbar':undefined}
      aria-label={available?`${service.name}, ${GOAL_LABELS[period]}`:undefined} aria-valuemin={available?0:undefined} aria-valuemax={available?target:undefined}
      aria-valuenow={available?Math.min(count,target):undefined} aria-valuetext={available?`${count} sur ${target}${progress.reached?', objectif atteint':''}`:undefined}>
      <span style={{width:`${progress?.percent||0}%`}}/>
    </div>:<div className="goal-track is-unset" aria-hidden="true"/>}
  </div>;
}

export function GoalsPanel({seller,services,goals,stats,loading,error,offline,onEdit,onRetry}) {
  const configured=services.filter(service=>hasGoal(goals?.[`s${service.id}`]));
  return <section className="panel goals-panel" aria-labelledby="personal-goals-title">
    <div className="goals-heading"><div><div className="section-kicker"><span className="kicker-line"/> VOTRE PROGRESSION</div><h2 id="personal-goals-title">Mes objectifs</h2><p>Vos ventes font avancer vos objectifs par service.</p></div>
      <button className="goal-manage" onClick={()=>onEdit(null)} disabled={!goals||offline||!services.length}><Pencil size={14}/> <span>Gérer</span></button>
    </div>
    {offline&&<p className="goal-offline">Lecture hors ligne · les modifications seront possibles au retour de la connexion.</p>}
    {!goals ? <div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>{loading?'Chargement de vos objectifs…':'Vos objectifs sont indisponibles.'}</strong><p>{error||'Ils apparaîtront ici dès que votre espace sera prêt.'}</p>{!loading&&!offline&&<button type="button" onClick={onRetry}>Réessayer</button>}</div></div>
    :configured.length===0?<div className="goals-empty"><span className="goals-empty-icon"><Target size={20}/></span><div><strong>Aucun objectif défini pour le moment.</strong><p>Choisissez un service pour définir vos objectifs, ou demandez à votre responsable.</p><button type="button" onClick={()=>onEdit(null)} disabled={offline||!services.length}>Définir un objectif <ArrowRight size={13}/></button></div></div>
    :<div className="goals-grid">{configured.map(service=><article className="goal-card" key={service.id}>
      <div className="goal-card-heading"><div><span className="goal-card-icon"><Target size={16}/></span><strong>{service.name}</strong></div><button className="icon-button goal-card-edit" aria-label={`Modifier les objectifs ${service.name}`} onClick={()=>onEdit(service.id)} disabled={offline}><Pencil size={15}/></button></div>
      <div className="goal-metrics">{GOAL_PERIODS.map(period=><GoalMetric key={period} service={service} period={period} target={goals?.[`s${service.id}`]?.[period]} stats={stats}/>)}</div>
    </article>)}</div>}
    {error&&goals&&!offline&&<p className="goal-sync-warning">Dernières valeurs affichées · {error} <button type="button" onClick={onRetry}>Réessayer</button></p>}
    {configured.length>0&&<p className="goal-caption">Objectifs personnels de {seller?.name||'votre profil'} · semaine du lundi au dimanche.</p>}
  </section>;
}
